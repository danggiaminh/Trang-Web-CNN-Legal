import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Hành vi trên trình duyệt của lien-he.astro đã kiểm bằng Chrome; test này giữ các mốc trong mã nguồn
// để lỡ tay xoá (method, noscript, focus, đường liên hệ dự phòng) thì npm test báo ngay.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/pages/lien-he.astro");

test("form gửi bằng POST, tắt JavaScript thì có dòng noscript kèm số điện thoại và email", () => {
  assert.match(page, /<form id="contact-form" method="post"/);
  const noscript = page.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? "";
  assert.ok(noscript.includes("{site.publicPhoneHref}") && noscript.includes("{site.publicEmailHref}"), noscript);
});

test("khung báo đã gửi có role=status, tabindex=-1 và nhận focus ngay khi hiện", () => {
  const tag = page.match(/<div id="cf-success"[^>]*>/)?.[0] ?? "";
  assert.match(tag, /role="status"/);
  assert.match(tag, /tabindex="-1"/);
  assert.match(page, /successMsg\.classList\.remove\('hidden'\);\s*successMsg\.focus\(\);/);
});

test("gửi lỗi mà khách không tự sửa được thì hiện số điện thoại và thư soạn sẵn", () => {
  const fallback = page.match(/<p id="cf-fallback"[\s\S]*?<\/p>/)?.[0] ?? "";
  assert.ok(fallback.includes("{site.publicPhoneHref}") && fallback.includes('id="cf-mailto"'), fallback);
  // Thư gửi tới địa chỉ trang đang hiện (data-email), cả khi máy chủ báo lỗi lẫn khi mất mạng.
  assert.match(page, /data-email=\{site\.publicEmail\}/);
  assert.match(page, /`mailto:\$\{form\.dataset\.email\}\?subject=/);
  assert.match(page, /const stuck = res\.status !== 400 && res\.status !== 413;/);
  assert.equal(page.match(/mailLink\.href = mailtoHref\(data\);/g)?.length, 2);
});

test("JSON-LD của trang liên hệ dùng lại @id LegalService của trang chủ", () => {
  const id = '"@id": `${site.canonicalBaseUrl}/#legal-service`';
  const type = '"@type": ["Organization", "LegalService"]';
  for (const source of [page, read("../src/pages/index.astro")]) {
    assert.ok(source.includes(id) && source.includes(type));
  }
});
