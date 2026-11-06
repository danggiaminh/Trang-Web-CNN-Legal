// Bảng trợ lý và hộp tìm kiếm cùng nổi trên trang. Hộp tìm kiếm nằm trong header (lớp z-50) nên
// chỉ nổi ngang header; bảng (z-[60]) mà không hạ xuống thì che mất ô tìm kiếm đang nhận phím gõ.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("AskBox: hộp tìm kiếm đang mở thì bảng trợ lý hạ xuống dưới header", () => {
  const askBox = read("components/AskBox.astro");
  const header = read("components/Header.astro");
  assert.match(askBox, /<div class="[^"]*\bz-\[60\][^"]*" data-ask-panel-wrap>/);
  assert.match(header.slice(header.indexOf("<header")), /^<header\s+class="[^"]*\bz-50\b/);
  assert.match(askBox, /:global\(body\[data-search-open\] \[data-ask-panel-wrap\]\) \{\s*z-index: 40;/);
});

test("AskBox: phím tắt và Esc nhường hộp tìm kiếm đang mở, mỗi Esc chỉ đóng một lớp", () => {
  const askBox = read("components/AskBox.astro");
  const handler = askBox.slice(askBox.indexOf('document.addEventListener("keydown"'));
  const guard = handler.indexOf('if (event.defaultPrevented || document.body.hasAttribute("data-search-open")) return;');
  assert.ok(guard > 0, "thiếu điều kiện nhường phím cho hộp tìm kiếm");
  assert.ok(guard < handler.indexOf('event.key.toLowerCase() === "i"'), "điều kiện phải đứng trước Ctrl+I");
  assert.ok(guard < handler.indexOf('event.key === "Escape"'), "điều kiện phải đứng trước Esc");
});
