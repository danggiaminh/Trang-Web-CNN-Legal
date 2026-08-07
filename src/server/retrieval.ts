import { allDocs, getDoc, type Doc, type Section } from "./knowledge";

// Khi người đọc đang mở một bài, gửi NGUYÊN bài thay vì cắt khúc theo BM25.
// Hai lý do, cùng một thay đổi:
//  - Bám sát nội dung: cắt còn 5.000 ký tự làm mất phần lớn 6 bài viết trên
//    site (10.920–32.203 ký tự), nên trợ lý trả lời trớt quớt.
//  - Trúng cache: BM25 đổi kết quả theo từng câu hỏi nên tiền tố prompt đổi
//    theo, không bao giờ cache được. Nguyên bài thì cố định theo trang.
// Mốc đặt trên bài dài nhất (32.203) để mọi trang đều đi nhánh này; bài dài
// hơn mốc vẫn rơi về dàn ý như cũ.
const WHOLE_DOC_CHARS = 40000;
const RETRIEVED_MAX_CHARS = 5000;
const OUTLINE_SECTION_CHARS = 450;
const OUTLINE_MAX_CHARS = 6000;
const TOP_K = 4;

const WHOLE_DOC_HINTS = [
  "tóm tắt",
  "tóm lược",
  "tóm gọn",
  "khái quát",
  "nội dung chính",
  "ý chính",
  "điểm chính",
  "nói về gì",
  "viết về gì",
  "đại ý",
];

export interface Passage {
  readonly slug: string;
  readonly title: string;
  readonly url: string;
  readonly headingPath: string;
  readonly content: string;
  readonly ord: number;
}

export interface Context {
  readonly passages: readonly Passage[];
  readonly currentTitle: string | null;
}

function normalizedWords(text: string): string {
  const spaced = text.replace(/[^\p{L}\p{N}]+/gu, " ");
  return ` ${spaced.toLowerCase().split(/\s+/).filter(Boolean).join(" ")} `;
}

function wantsWholeDoc(question: string): boolean {
  const q = normalizedWords(question);
  return WHOLE_DOC_HINTS.some((h) => q.includes(` ${h} `));
}

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = words.slice();
  for (let i = 1; i < words.length; i += 1) out.push(`${words[i - 1]}_${words[i]}`);
  return out;
}

interface Entry {
  readonly passage: Passage;
  readonly tf: Map<string, number>;
  readonly len: number;
}

interface Index {
  readonly entries: readonly Entry[];
  readonly byDoc: Map<string, Entry[]>;
  readonly df: Map<string, number>;
  readonly avgLen: number;
}

function toEntry(doc: Doc, section: Section): Entry {
  const tokens = tokenize(`${doc.title}\n${section.headingPath}\n${section.content}`);
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return {
    passage: {
      slug: doc.slug,
      title: doc.title,
      url: doc.url,
      headingPath: section.headingPath,
      content: section.content,
      ord: section.ord,
    },
    tf,
    len: tokens.length,
  };
}

let index: Promise<Index> | null = null;

async function buildIndex(): Promise<Index> {
  const entries: Entry[] = [];
  const byDoc = new Map<string, Entry[]>();
  for (const doc of await allDocs()) {
    const list: Entry[] = [];
    for (const section of doc.sections) {
      const entry = toEntry(doc, section);
      entries.push(entry);
      list.push(entry);
    }
    byDoc.set(doc.slug, list);
  }

  const df = new Map<string, number>();
  let total = 0;
  for (const e of entries) {
    total += e.len;
    for (const term of e.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }

  return { entries, byDoc, df, avgLen: entries.length ? total / entries.length : 1 };
}

function getIndex(): Promise<Index> {
  index ??= buildIndex();
  return index;
}

const K1 = 1.2;
const B = 0.75;

function bm25(entry: Entry, terms: readonly string[], idx: Index): number {
  const n = idx.entries.length;
  let score = 0;
  for (const term of terms) {
    const tf = entry.tf.get(term);
    if (!tf) continue;
    const df = idx.df.get(term) ?? 0;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    const norm = tf + K1 * (1 - B + (B * entry.len) / idx.avgLen);
    score += idf * ((tf * (K1 + 1)) / norm);
  }
  return score;
}

function rank(pool: readonly Entry[], question: string, idx: Index, topK: number): Passage[] {
  const terms = [...new Set(tokenize(question))];
  if (!terms.length) return [];
  return pool
    .map((entry) => ({ entry, score: bm25(entry, terms, idx) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r) => r.entry.passage);
}

function withinBudget(hits: readonly Passage[], budget: number): Passage[] {
  const out: Passage[] = [];
  let used = 0;
  for (const h of hits) {
    const cost = h.content.length;
    if (used + cost > budget && out.length) continue;
    used += cost;
    out.push(h);
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug) || a.ord - b.ord);
}

function wholeDoc(doc: Doc): Passage[] {
  return doc.sections.length
    ? doc.sections.map((s) => ({
        slug: doc.slug,
        title: doc.title,
        url: doc.url,
        headingPath: s.headingPath,
        content: s.content,
        ord: s.ord,
      }))
    : [
        {
          slug: doc.slug,
          title: doc.title,
          url: doc.url,
          headingPath: "",
          content: doc.text,
          ord: 0,
        },
      ];
}

function outline(doc: Doc): Passage[] {
  const out: Passage[] = [];
  const seen = new Set<string>();
  let used = 0;

  for (const s of doc.sections) {
    const top = s.headingPath.split(" › ")[0] ?? "";
    if (seen.has(top)) continue;
    seen.add(top);

    const content =
      s.content.length > OUTLINE_SECTION_CHARS
        ? `${s.content.slice(0, OUTLINE_SECTION_CHARS)}…`
        : s.content;
    if (used + content.length > OUTLINE_MAX_CHARS && out.length) break;
    used += content.length;
    out.push({
      slug: doc.slug,
      title: doc.title,
      url: doc.url,
      headingPath: s.headingPath,
      content,
      ord: s.ord,
    });
  }
  return out;
}

export async function selectContext(question: string, slug: string | null): Promise<Context> {
  const doc = slug ? await getDoc(slug) : null;
  const idx = await getIndex();

  if (!doc) {
    return {
      passages: withinBudget(rank(idx.entries, question, idx, TOP_K), RETRIEVED_MAX_CHARS),
      currentTitle: null,
    };
  }

  if (doc.chars <= WHOLE_DOC_CHARS) {
    return { passages: wholeDoc(doc), currentTitle: doc.title };
  }

  if (wantsWholeDoc(question)) {
    const sketch = outline(doc);
    if (sketch.length) return { passages: sketch, currentTitle: doc.title };
  }

  const pool = idx.byDoc.get(doc.slug) ?? [];
  const hits = rank(pool, question, idx, TOP_K);
  const passages = hits.length ? withinBudget(hits, RETRIEVED_MAX_CHARS) : outline(doc);
  return { passages, currentTitle: doc.title };
}

export const __test__ = { tokenize, wantsWholeDoc, withinBudget, normalizedWords };
