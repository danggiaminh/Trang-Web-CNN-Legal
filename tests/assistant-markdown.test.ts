import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown, safeUrl } from "../src/scripts/ask-markdown.ts";

const SITE = "https://www.cnnlegal.vn";

test("// và / ghép với \\ không được coi là đường dẫn nội bộ", () => {
  for (const url of [
    "//evil.example/login",
    "/\\evil.example",
    "/\\/evil.example",
    "//\\evil.example",
    "/\\\\evil.example",
    "  //evil.example",
    "\\\\evil.example",
    "\\/evil.example",
  ]) {
    assert.equal(safeUrl(url), null, url);
  }
  // Đúng hai ví dụ trong báo cáo: không còn ra thẻ <a> nữa.
  assert.ok(!renderMarkdown("[Văn bản gốc](//evil.example/login)").includes("<a"));
  assert.ok(!renderMarkdown("[x](/\\evil.example)").includes("<a"));
});

test("đường dẫn nội bộ, https và mailto vẫn ra link như cũ", () => {
  assert.equal(safeUrl("/bai-viet/an-le-13/"), "/bai-viet/an-le-13/");
  assert.equal(safeUrl("/"), "/");
  assert.equal(safeUrl("/lien-he/#form"), "/lien-he/#form");
  assert.equal(safeUrl("https://lsvn.vn/bai-viet"), "https://lsvn.vn/bai-viet");
  assert.equal(safeUrl("mailto:cnnlegal.vn@gmail.com"), "mailto:cnnlegal.vn@gmail.com");
  assert.equal(safeUrl("javascript:alert(1)"), null);

  const html = renderMarkdown("Xem [bài viết](/bai-viet/an-le-13/) và [LSVN](https://lsvn.vn/x).");
  assert.ok(html.includes('<a href="/bai-viet/an-le-13/">bài viết</a>'), html);
  assert.ok(html.includes('<a href="https://lsvn.vn/x" target="_blank" rel="noopener noreferrer nofollow">LSVN</a>'), html);
});

test("mọi link không phải http(s)/mailto mà renderer cho qua đều ở lại đúng tên miền của trang", () => {
  const tricky = [
    "/bai-viet/x/",
    "/%2F%2Fevil.example",
    "/./evil.example",
    "/..//evil.example",
    "/.//evil.example",
    "/&#47;evil.example",
    "/%5Cevil.example",
    "/@evil.example",
    "/evil.example:443",
    "//evil.example",
    "/\\evil.example",
  ];
  for (const url of tricky) {
    const html = renderMarkdown(`[x](${url})`);
    const href = /<a href="([^"]*)"/.exec(html)?.[1];
    if (href === undefined) continue;
    // Thuộc tính href được trình duyệt giải mã thực thể HTML trước khi hiểu là URL.
    const decoded = href.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    assert.equal(new URL(decoded, SITE).origin, SITE, url);
  }
});
