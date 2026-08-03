import type { APIRoute } from "astro";
import { articles, externalArticles } from "../data/articles";
import { notableCases } from "../data/cases";
import { services } from "../data/services";

type Entry = {
  t: string;
  d: string;
  u: string;
  g: string;
  k: "Dịch vụ" | "Bài viết" | "Vụ án";
};

const trim = (s: string, n = 120) => {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n).trimEnd() + "…" : clean;
};

export const GET: APIRoute = () => {
  const entries: Entry[] = [
    ...services.map((s) => ({
      t: s.title,
      d: trim(s.summary),
      u: "/dich-vu/",
      g: "Dịch vụ",
      k: "Dịch vụ" as const,
    })),

    ...articles.map((a) => ({
      t: a.title,
      d: trim(a.excerpt),
      u: `/bai-viet/${a.slug}/`,
      g: a.category || "Bài viết",
      k: "Bài viết" as const,
    })),

    ...externalArticles.map((a) => ({
      t: a.title,
      d: trim(`${a.sourceName} · ${a.summary}`),
      u: a.sourceUrl,
      g: a.category || "Bài viết",
      k: "Bài viết" as const,
    })),

    ...notableCases.map((c) => ({
      t: c.title,
      d: trim(c.summary || c.charge),
      u: `/vu-an-tieu-bieu/${c.slug}/`,
      g: c.category || "Vụ án",
      k: "Vụ án" as const,
    })),
  ];

  return new Response(JSON.stringify(entries), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
};
