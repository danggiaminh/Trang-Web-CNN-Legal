import { getAllArticles, externalArticles, type ArticleBlock } from "../data/articles";
import { notableCases } from "../data/cases";

const TARGET_CHARS = 1800;
const MIN_CHARS = 200;
const HEADING_SEP = " › ";

export interface Section {
  readonly headingPath: string;
  readonly content: string;
  readonly ord: number;
}

export interface Doc {
  readonly slug: string;
  readonly title: string;
  readonly url: string;
  readonly category: string;
  readonly text: string;
  readonly chars: number;
  readonly sections: readonly Section[];
}

function blocksToText(blocks: readonly ArticleBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
        case "noteHeading":
          return `## ${b.text}`;
        case "subheading":
          return `### ${b.text}`;
        case "lead":
        case "paragraph":
        case "italic":
        case "quote":
        case "note":
          return b.text;
        case "signature":
          return [b.name, b.org].filter(Boolean).join("\n");
        case "image":
          return b.caption ? `*${b.caption}*` : "";
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

function stripTags(t: string): string {
  return String(t).replace(/<[^>]+>/g, "").trim();
}

function htmlToText(html: string): string {
  return String(html)
    .replace(/<h2>(.*?)<\/h2>/gis, (_, t) => `\n## ${stripTags(t)}\n`)
    .replace(/<h3>(.*?)<\/h3>/gis, (_, t) => `\n### ${stripTags(t)}\n`)
    .replace(/<li>(.*?)<\/li>/gis, (_, t) => `- ${stripTags(t)}\n`)
    .replace(/<\/(p|ul)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugFromUrl(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  return last
    .replace(/\.(html?|htm|chn|tpo|ldo|amp)$/i, "")
    .replace(/-\d{6,}$/, "")
    .slice(0, 90);
}

function toSections(markdown: string): Section[] {
  const raw: { path: string; parts: string[] }[] = [];
  let h2 = "";
  let h3 = "";
  let current: { path: string; parts: string[] } | null = null;

  const pathNow = () => [h2, h3].filter(Boolean).join(HEADING_SEP);
  const open = () => {
    current = { path: pathNow(), parts: [] };
    raw.push(current);
  };

  for (const block of markdown.split(/\n{2,}/)) {
    const text = block.trim();
    if (!text) continue;

    const m2 = /^##\s+(.*)$/.exec(text);
    const m3 = /^###\s+(.*)$/.exec(text);
    if (m2) {
      h2 = m2[1].trim();
      h3 = "";
      open();
      continue;
    }
    if (m3) {
      h3 = m3[1].trim();
      open();
      continue;
    }
    if (!current) open();
    current!.parts.push(text);
  }

  const out: Section[] = [];
  for (const sec of raw) {
    let buf: string[] = [];
    let used = 0;
    const flush = () => {
      if (!buf.length) return;
      out.push({ headingPath: sec.path, content: buf.join("\n\n"), ord: out.length });
      buf = [];
      used = 0;
    };
    for (const para of sec.parts) {
      if (used && used + para.length > TARGET_CHARS) flush();
      buf.push(para);
      used += para.length;
    }
    flush();
  }

  const merged: Section[] = [];
  for (const sec of out) {
    const last = merged[merged.length - 1];
    if (last && sec.content.length < MIN_CHARS && last.headingPath === sec.headingPath) {
      merged[merged.length - 1] = {
        ...last,
        content: `${last.content}\n\n${sec.content}`,
      };
      continue;
    }
    merged.push({ ...sec, ord: merged.length });
  }
  return merged;
}

function makeDoc(input: {
  slug: string;
  title: string;
  url: string;
  category: string;
  text: string;
}): Doc {
  const text = input.text.trim();
  return {
    slug: input.slug,
    title: input.title,
    url: input.url,
    category: input.category || "Pháp luật",
    text,
    chars: text.length,
    sections: toSections(text),
  };
}

async function buildCorpus(): Promise<Map<string, Doc>> {
  const docs = new Map<string, Doc>();
  const add = (d: Doc) => {
    if (d.text) docs.set(d.slug, d);
  };

  for (const a of await getAllArticles()) {
    const body = a.blocks?.length
      ? blocksToText(a.blocks)
      : (a.bodyParagraphs ?? []).join("\n\n");
    add(
      makeDoc({
        slug: a.slug,
        title: a.title,
        url: `/bai-viet/${a.slug}/`,
        category: a.category,
        text: body,
      }),
    );
  }

  for (const c of notableCases) {
    const luanDiem = c.keyArguments?.length
      ? `\n\n## Luận điểm chính\n\n${c.keyArguments.map((x) => `- ${x}`).join("\n")}`
      : "";
    add(
      makeDoc({
        slug: c.slug,
        title: c.title,
        url: `/vu-an-tieu-bieu/${c.slug}/`,
        category: c.category,
        text: `${c.summary ? `${c.summary}\n\n` : ""}${htmlToText(c.body ?? "")}${luanDiem}`,
      }),
    );
  }

  for (const a of externalArticles ?? []) {
    const slug = slugFromUrl(a.sourceUrl);
    add(
      makeDoc({
        slug,
        title: a.title,
        url: a.sourceUrl,
        category: a.category,
        text: `${a.summary}\n\nĐây là phần giới thiệu ngắn. Toàn văn bài viết đăng trên ${a.sourceName}.`,
      }),
    );
  }

  return docs;
}

let corpus: Promise<Map<string, Doc>> | null = null;

export function getCorpus(): Promise<Map<string, Doc>> {
  corpus ??= buildCorpus();
  return corpus;
}

export async function getDoc(slug: string): Promise<Doc | null> {
  return (await getCorpus()).get(slug) ?? null;
}

export async function allDocs(): Promise<Doc[]> {
  return [...(await getCorpus()).values()];
}
