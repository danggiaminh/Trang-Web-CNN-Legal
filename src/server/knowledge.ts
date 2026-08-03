/**
 * Kho tri thức của trợ lý, dựng thẳng từ `src/data/*.ts`.
 *
 * Không đọc `src/content/articles/` — thư mục đó nằm trong .gitignore vì được
 * sinh ra bởi `rag-backend/scripts/export-content.mjs`, nên trên Vercel nó không
 * tồn tại. Lấy trực tiếp từ `src/data` cũng là lấy đúng nguồn mà các trang đang
 * hiển thị, khỏi lo hai bên lệch nhau.
 *
 * Cách dựng văn bản dưới đây bám theo `export-content.mjs` để ngữ cảnh gửi cho
 * model trùng với những gì backend Rust đã nạp.
 *
 * Chỉ import từ mã chạy trên máy chủ (`src/pages/api/**`). Module này kéo theo
 * toàn bộ nội dung bài viết; lỡ import vào một component giao diện là ném thêm
 * vài trăm KB vào bundle của trang đó.
 */
import { getAllArticles, externalArticles, type ArticleBlock } from "../data/articles";
import { notableCases } from "../data/cases";

/** Trùng `TARGET_CHARS` trong rag-backend/src/chunk.rs. */
const TARGET_CHARS = 1800;
/** Trùng `MIN_CHARS` — mục ngắn hơn ngần này thì gộp vào mục trước. */
const MIN_CHARS = 200;
/** Trùng `HEADING_SEP` — dấu phân cấp tiêu đề khi in nguồn cho model. */
const HEADING_SEP = " › ";

export interface Section {
  /** Đường dẫn tiêu đề, ví dụ "Bối cảnh tố tụng › Giai đoạn sơ thẩm". */
  readonly headingPath: string;
  readonly content: string;
  /** Thứ tự trong bài — dùng để xếp lại ngữ cảnh theo mạch đọc. */
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

/** Thân vụ án trong `cases.ts` là HTML — hạ về văn bản giữ lại cấp tiêu đề. */
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

/** Bài đăng báo ngoài không có slug riêng — lấy từ đoạn cuối đường dẫn. */
function slugFromUrl(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  return last
    .replace(/\.(html?|htm|chn|tpo|ldo|amp)$/i, "")
    .replace(/-\d{6,}$/, "")
    .slice(0, 90);
}

/**
 * Cắt bài thành mục theo tiêu đề, mục quá dài thì cắt tiếp ở ranh giới đoạn.
 *
 * Chỉ H2/H3 mở mục mới; H4 trở xuống coi như văn bản thường, giống `chunk.rs`.
 */
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

  // Nội dung dài thì tách ở ranh giới đoạn, không cắt giữa câu.
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

  // Mẩu quá ngắn gộp ngược vào mục trước cùng tiêu đề — mảnh vụn vừa tốn chỗ
  // vừa nhiễu điểm xếp hạng.
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

  // Bài đăng báo ngoài: trang chỉ giới thiệu chứ không đăng lại toàn văn, nên
  // ghi rõ điều đó để trợ lý không trả lời như thể đã đọc trọn bài.
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

// Dựng một lần cho mỗi instance rồi giữ lại: lần gọi nguội trả tiền, các lần
// sau dùng chung.
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
