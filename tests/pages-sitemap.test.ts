import assert from "node:assert/strict";
import { test } from "node:test";
import { articles } from "../src/data/articles.ts";
import { notableCases } from "../src/data/cases.ts";
import { site } from "../src/data/site.ts";
import { GET } from "../src/pages/sitemap.xml.ts";

// lastmod chỉ có ở bài viết (ngày đăng). Trang tĩnh và trang vụ án không ghi: ngày build hay ngày
// diễn ra vụ án đều không phải ngày trang được sửa.
test("sitemap chỉ ghi lastmod là ngày đăng của bài viết", async () => {
  const xml = await (await GET()).text();
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: /<loc>(.*?)<\/loc>/.exec(m[1]!)?.[1] ?? "",
    lastmod: /<lastmod>(.*?)<\/lastmod>/.exec(m[1]!)?.[1],
  }));
  const articleDates = new Map(
    articles.map((a) => [new URL(`/bai-viet/${a.slug}/`, site.canonicalBaseUrl).href, a.publishedAt.split("/").reverse().join("-")]),
  );
  const casePages = notableCases.map((c) => new URL(`/vu-an-tieu-bieu/${c.slug}/`, site.canonicalBaseUrl).href);

  assert.equal(urls.length, new Set(urls.map((u) => u.loc)).size, "URL trùng");
  for (const { loc, lastmod } of urls) {
    assert.ok(loc.startsWith(`${site.canonicalBaseUrl}/`), loc);
    assert.equal(lastmod, articleDates.get(loc), loc);
  }
  for (const page of [...articleDates.keys(), ...casePages]) {
    assert.ok(urls.some((u) => u.loc === page), `thiếu ${page}`);
  }
});
