import { createHash } from "node:crypto";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const outDir = resolve(repoRoot, "src/content/articles");

const { articles, externalArticles } = await import(resolve(repoRoot, "src/data/articles.ts"));
const { notableCases } = await import(resolve(repoRoot, "src/data/cases.ts"));

function toIso(d) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d || "").trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const m2 = /(\d{4})/.exec(d || "");
  return m2 ? `${m2[1]}-01-01` : null;
}


function stamp(rawDate, body) {
  return toIso(rawDate) ?? `sha256:${createHash("sha256").update(body).digest("hex").slice(0, 16)}`;
}

function yamlEscape(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

function frontmatter({ title, slug, category, updatedAt, url }) {
  return [
    "---",
    `title: ${yamlEscape(title)}`,
    `slug: ${yamlEscape(slug)}`,
    `category: ${yamlEscape(category || "Pháp luật")}`,


    `url: ${yamlEscape(url)}`,
    `updatedAt: ${yamlEscape(updatedAt)}`,
    "---",
    "",
  ].join("\n");
}

function articleBody(a) {
  if (Array.isArray(a.blocks) && a.blocks.length) {
    return a.blocks
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
  return (a.bodyParagraphs || []).join("\n\n");
}

function htmlToMd(html) {
  return String(html)
    .replace(/<h2>(.*?)<\/h2>/gis, (_, t) => `\n## ${strip(t)}\n`)
    .replace(/<h3>(.*?)<\/h3>/gis, (_, t) => `\n### ${strip(t)}\n`)
    .replace(/<li>(.*?)<\/li>/gis, (_, t) => `- ${strip(t)}\n`)
    .replace(/<\/(p|ul)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function strip(t) {
  return String(t).replace(/<[^>]+>/g, "").trim();
}

/** Bài đăng báo ngoài không có slug riêng — lấy từ đoạn cuối đường dẫn cho ổn định. */
function slugFromUrl(url) {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
  return last
    .replace(/\.(html?|htm|chn|tpo|ldo|amp)$/i, "")
    .replace(/-\d{6,}$/, "")
    .slice(0, 90);
}

await mkdir(outDir, { recursive: true });
const written = new Set();
let count = 0;

for (const a of articles) {
  const body = articleBody(a) + "\n";
  const md =
    frontmatter({
      title: a.title,
      slug: a.slug,
      category: a.category,
      url: `/bai-viet/${a.slug}/`,
      updatedAt: stamp(a.publishedAt, body),
    }) + body;
  await writeFile(resolve(outDir, `${a.slug}.md`), md, "utf8");
  written.add(`${a.slug}.md`);
  count++;
}

for (const c of notableCases) {
  const body =
    (c.summary ? `${c.summary}\n\n` : "") +
    htmlToMd(c.body || "") +
    (Array.isArray(c.keyArguments) && c.keyArguments.length
      ? `\n\n## Luận điểm chính\n\n${c.keyArguments.map((x) => `- ${x}`).join("\n")}`
      : "") +
    "\n";
  const md =
    frontmatter({
      title: c.title,
      slug: c.slug,
      category: c.category,
      url: `/vu-an-tieu-bieu/${c.slug}/`,
      updatedAt: stamp(c.date, body),
    }) + body;
  await writeFile(resolve(outDir, `${c.slug}.md`), md, "utf8");
  written.add(`${c.slug}.md`);
  count++;
}

// Bài đăng trên báo ngoài: trang web chỉ giới thiệu chứ không đăng lại toàn văn,
// nên phần đưa vào kho tri thức cũng chỉ là tóm tắt. Ghi rõ điều đó trong nội dung
// để trợ lý không trả lời như thể đã đọc trọn bài.
for (const a of externalArticles ?? []) {
  const slug = slugFromUrl(a.sourceUrl);
  const body = `${a.summary}\n\nĐây là phần giới thiệu ngắn. Toàn văn bài viết đăng trên ${a.sourceName}.\n`;
  const md =
    frontmatter({
      title: a.title,
      slug,
      category: a.category,
      url: a.sourceUrl,
      updatedAt: stamp(a.publishedAt, body),
    }) + body;
  await writeFile(resolve(outDir, `${slug}.md`), md, "utf8");
  written.add(`${slug}.md`);
  count++;
}

// Dọn file của bài đã gỡ khỏi dữ liệu — để sót thì `ingest --prune` không thấy,
// và trợ lý sẽ tiếp tục trích dẫn đường dẫn đã chết.
let removed = 0;
for (const name of await readdir(outDir)) {
  if (!name.endsWith(".md") || written.has(name)) continue;
  await unlink(resolve(outDir, name));
  console.log(`Đã xoá file mồ côi: ${name}`);
  removed++;
}

console.log(`Đã xuất ${count} file .md vào ${outDir}${removed ? ` (xoá ${removed} file cũ)` : ""}`);

