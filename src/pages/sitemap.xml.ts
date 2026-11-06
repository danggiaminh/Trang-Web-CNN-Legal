import { site } from "../data/site";
import { getAllArticles } from "../data/articles";
import { notableCases } from "../data/cases";
import { services } from "../data/services";

interface SitemapEntry {
  path: string;
  changefreq: "daily" | "weekly" | "monthly";
  priority: number;
  // Chỉ ghi khi biết ngày sửa thật. Ghi ngày build cho trang không đổi thì Google học cách bỏ qua
  // lastmod của cả sitemap; ngày diễn ra vụ án cũng không phải ngày trang được sửa.
  lastmod?: string;
}

function toIsoDate(input: string): string | undefined {
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.trim());
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : undefined;
}

export async function GET() {
  const articles = await getAllArticles();

  const pages: SitemapEntry[] = [

    { path: "/", changefreq: "weekly", priority: 1.0 },
    { path: "/tong-quan/", changefreq: "monthly", priority: 0.8 },
    { path: "/dich-vu/", changefreq: "weekly", priority: 0.9 },
    ...services.map((s) => ({
      path: `/dich-vu/${s.slug}/`,
      changefreq: "monthly" as const,
      priority: 0.8,
    })),
    { path: "/kinh-nghiem/", changefreq: "weekly", priority: 0.9 },
    { path: "/bai-viet/", changefreq: "weekly", priority: 0.9 },

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
    })),
    { path: "/lien-he/", changefreq: "monthly", priority: 0.7 },
  ];

  const urls = pages
    .map(
      (p) =>
        `  <url>\n    <loc>${new URL(p.path, site.canonicalBaseUrl).toString()}</loc>\n${p.lastmod ? `    <lastmod>${p.lastmod}</lastmod>\n` : ""}    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority.toFixed(1)}</priority>\n  </url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
