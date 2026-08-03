/**
 * Chọn ngữ cảnh gửi kèm câu hỏi.
 *
 * Bản Rust chạy truy xuất lai: vector (sqlite-vec) hợp nhất với BM25 (FTS5).
 * Trên serverless không có SQLite lẫn sqlite-vec, và quan trọng hơn: đo lại kho
 * bài thì 27/33 bài chỉ dài dưới 2.900 ký tự — nhỏ hơn cả ngân sách truy xuất
 * 5.000 ký tự mà bản Rust vốn đã gửi đi. Với những bài đó, gửi nguyên bài vừa rẻ
 * hơn vừa không bao giờ trượt đoạn cần tìm, nên nhánh embedding bị bỏ hẳn: đỡ
 * một lần gọi API tính tiền cho mỗi câu hỏi.
 *
 * Chỉ 6 bài dài (11K–32K ký tự) mới cần chọn lọc, và đó là việc của BM25 dưới
 * đây. Ngưỡng 6.000 nằm gọn trong khoảng trống 2.9K–11.3K của kho bài nên nội
 * dung có xê dịch cũng không đổi hành vi.
 */
import { allDocs, getDoc, type Doc, type Section } from "./knowledge";

const WHOLE_DOC_CHARS = 6000;
/** Trùng `RETRIEVED_MAX_CHARS` trong rag-backend/src/rag.rs. */
const RETRIEVED_MAX_CHARS = 5000;
const OUTLINE_SECTION_CHARS = 450;
const OUTLINE_MAX_CHARS = 6000;
/** Trùng `RAG_TOP_K` mặc định. */
const TOP_K = 4;

/** Trùng `WHOLE_DOC_HINTS` trong rag.rs. */
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
  /** Tên bài người dùng đang mở, nếu xác định được từ slug. */
  readonly currentTitle: string | null;
}

/** Đưa câu hỏi về chuỗi từ có khoảng trắng hai đầu, để dò cụm theo trọn từ. */
function normalizedWords(text: string): string {
  const spaced = text.replace(/[^\p{L}\p{N}]+/gu, " ");
  return ` ${spaced.toLowerCase().split(/\s+/).filter(Boolean).join(" ")} `;
}

function wantsWholeDoc(question: string): boolean {
  const q = normalizedWords(question);
  return WHOLE_DOC_HINTS.some((h) => q.includes(` ${h} `));
}

/**
 * Tách từ cho BM25, kèm cụm hai âm tiết liền nhau.
 *
 * Tiếng Việt viết rời từng âm tiết nên nếu chỉ đếm âm tiết đơn thì "thu hồi
 * đất" và "đất thu hồi" cho điểm y hệt nhau. Đánh chỉ mục thêm cụm đôi
 * ("thu_hồi", "hồi_đất") lấy lại được trật tự từ mà không cần từ điển tách từ.
 */
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
  // Tiêu đề bài và đường dẫn mục được tính vào phần đếm từ: chúng là tín hiệu
  // mạnh, mục "Kết quả tố tụng" nên ăn điểm với câu hỏi "kết quả thế nào".
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

/**
 * Cắt theo ngân sách ký tự rồi xếp lại theo mạch bài.
 *
 * Cổng `!out.length` giữ lại đoạn điểm cao nhất kể cả khi nó vượt ngân sách —
 * thà gửi một đoạn dài còn hơn gửi ngữ cảnh rỗng. Trùng `within_budget` ở rag.rs.
 */
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

/** Mục đầu tiên của mỗi tiêu đề cấp 2, cắt ngắn — trùng `fetch_outline` ở db.rs. */
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

  // Không xác định được bài đang mở — tìm khắp kho.
  if (!doc) {
    return {
      passages: withinBudget(rank(idx.entries, question, idx, TOP_K), RETRIEVED_MAX_CHARS),
      currentTitle: null,
    };
  }

  // Bài ngắn: gửi trọn, khỏi truy xuất.
  if (doc.chars <= WHOLE_DOC_CHARS) {
    return { passages: wholeDoc(doc), currentTitle: doc.title };
  }

  // Bài dài mà người dùng hỏi tóm tắt: gửi dàn ý thay vì vài đoạn rời rạc.
  if (wantsWholeDoc(question)) {
    const sketch = outline(doc);
    if (sketch.length) return { passages: sketch, currentTitle: doc.title };
  }

  const pool = idx.byDoc.get(doc.slug) ?? [];
  const hits = rank(pool, question, idx, TOP_K);
  // Câu hỏi không khớp từ nào trong bài dài thì vẫn phải có ngữ cảnh để bám —
  // lấy dàn ý làm phương án lui.
  const passages = hits.length ? withinBudget(hits, RETRIEVED_MAX_CHARS) : outline(doc);
  return { passages, currentTitle: doc.title };
}

export const __test__ = { tokenize, wantsWholeDoc, withinBudget, normalizedWords };
