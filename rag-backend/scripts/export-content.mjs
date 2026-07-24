import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const outDir = resolve(repoRoot, "src/content/articles");

const { articles } = await import(resolve(repoRoot, "src/data/articles.ts"));
const { notableCases } = await import(resolve(repoRoot, "src/data/cases.ts"));

function toIso(d) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d || "").trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const m2 = /(\d{4})/.exec(d || "");
  return m2 ? `${m2[1]}-01-01` : new Date().toISOString().slice(0, 10);
}

function yamlEscape(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

function frontmatter({ title, slug, category, updatedAt }) {
  return [
    "---",
    `title: ${yamlEscape(title)}`,
    `slug: ${yamlEscape(slug)}`,
    `category: ${yamlEscape(category || "Pháp luật")}`,
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

await mkdir(outDir, { recursive: true });
let count = 0;

for (const a of articles) {
  const md =
    frontmatter({
      title: a.title,
      slug: a.slug,
      category: a.category,
      updatedAt: toIso(a.publishedAt),
    }) + articleBody(a) + "\n";
  await writeFile(resolve(outDir, `${a.slug}.md`), md, "utf8");
  count++;
}

for (const c of notableCases) {
  const md =
    frontmatter({
      title: c.title,
      slug: c.slug,
      category: c.category,
      updatedAt: toIso(c.date),
    }) +
    (c.summary ? `${c.summary}\n\n` : "") +
    htmlToMd(c.body || "") +
    (Array.isArray(c.keyArguments) && c.keyArguments.length
      ? `\n\n## Luận điểm chính\n\n${c.keyArguments.map((x) => `- ${x}`).join("\n")}`
      : "") +
    "\n";
  await writeFile(resolve(outDir, `${c.slug}.md`), md, "utf8");
  count++;
}

console.log(`Đã xuất ${count} file .md vào ${outDir}`);
