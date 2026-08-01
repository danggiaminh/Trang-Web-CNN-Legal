import { site } from "../data/site";
import { getAllArticles } from "../data/articles";
import { notableCases } from "../data/cases";

interface SitemapEntry {
  path: string;
  changefreq: "daily" | "weekly" | "monthly";
  priority: number;
  lastmod: string;
}

const today = new Date().toISOString().split("T")[0];


function toIsoDate(input: string | undefined): string {
  const s = (input ?? "").trim();
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const year = /^(\d{4})$/.exec(s);
  if (year) return `${year[1]}-01-01`;
  return today;
}

export async function GET() {
  const articles = await getAllArticles();

  const pages: SitemapEntry[] = [

    { path: "/", changefreq: "weekly", priority: 1.0, lastmod: today },
    { path: "/tong-quan/", changefreq: "monthly", priority: 0.8, lastmod: today },
    { path: "/dich-vu/", changefreq: "weekly", priority: 0.9, lastmod: today },
    { path: "/kinh-nghiem/", changefreq: "weekly", priority: 0.9, lastmod: today },
    { path: "/bai-viet/", changefreq: "weekly", priority: 0.9, lastmod: today },

    ...articles.map((a) => ({
      path: `/bai-viet/${a.slug}/`,
      changefreq: "monthly" as const,
      priority: 0.7,
      lastmod: toIsoDate(a.publishedAt),
    })),
    ...notableCases.map((c) => ({
      path: `/vu-an-tieu-bieu/${c.slug}/`,
      changefreq: "monthly" as const,
      priority: 0.7,
      lastmod: toIsoDate(c.date || String(c.year)),
    })),
    { path: "/lien-he/", changefreq: "monthly", priority: 0.7, lastmod: today },
  ];

  const urls = pages
    .map(
      (p) =>
        `  <url>\n    <loc>${new URL(p.path, site.canonicalBaseUrl).toString()}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority.toFixed(1)}</priority>\n  </url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
