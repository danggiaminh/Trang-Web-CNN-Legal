// Kiểm mã nguồn các component giao diện dùng chung: những chỗ dễ bị sửa ngược mà build vẫn qua.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("Header: ngăn kéo đóng sẵn inert, nhãn aside và nav khác nhau, cả hai nav có aria-current", () => {
  const header = read("components/Header.astro");
  const aside = header.match(/<aside\b[^>]*>/)![0];
  assert.match(aside, /\sinert[\s>]/, "aside#mobile-menu phải có inert trong markup");
  const asideLabel = aside.match(/aria-label="([^"]+)"/)![1];
  const drawerNav = header.slice(header.indexOf("<aside")).match(/<nav\b[^>]*aria-label="([^"]+)"/)![1];
  assert.notEqual(asideLabel, drawerNav);
  assert.match(header, /<div class="pointer-events-none fixed[^"]*overflow-hidden[^"]*" style="overflow:clip">/);
  assert.equal(header.match(/aria-current=\{isActive\(item\) \? "page" : undefined\}/g)?.length, 2);
});

test("HeroBreadcrumb: chữ trắng đặc, mục hiện tại có aria-current, nhãn tiếng Việt", () => {
  const crumb = read("components/HeroBreadcrumb.astro");
  assert.match(crumb, /<nav class="[^"]*\btext-white"[^>]*aria-label="Đường dẫn"/);
  assert.match(crumb, /<span class="font-semibold" aria-current="page">/);
  // Không còn lớp trắng trong suốt nào (chỉ component này dùng, nằm trong CSS của mọi trang);
  // dấu ngăn trang trí (aria-hidden) mờ bằng thuộc tính opacity của SVG.
  assert.doesNotMatch(crumb, /text-white\/\d/);
  assert.match(crumb, /<svg class="[^"]*" opacity="\.25"[^>]*aria-hidden="true"/);
});

test("ServiceShell: banner có lớp phủ đều 20% ngay sau ảnh, tiêu đề nằm trên", () => {
  const shell = read("components/ServiceShell.astro");
  const banner = shell.slice(shell.indexOf('<div class="absolute inset-0 z-0"'), shell.indexOf('<div class="section-shell relative z-10">'));
  assert.ok(banner.length > 0);
  const picture = banner.indexOf("<Picture");
  const overlay = banner.indexOf('<div class="absolute inset-0" style="background-color:rgb(0 0 0 / 0.2)"></div>');
  assert.ok(picture >= 0 && overlay > picture, "lớp phủ phải đứng sau <Picture> trong khung z-0");
});

test("Hero: không đọc heroSaigon.width/height (giữ file JPEG gốc 1 MB trong bản deploy)", () => {
  const hero = read("components/Hero.astro").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.ok(!/heroSaigon(Tall)?\.(width|height)\b/.test(hero), "đọc width/height của ảnh import");
  assert.match(hero, /width=\{wideWebp\.attributes\.width\}/);
  assert.match(hero, /height=\{wideWebp\.attributes\.height\}/);
});

test("global.css: vòng focus navy đặc, dòng đầu giữ source(\"..\")", () => {
  const css = read("styles/global.css");
  assert.equal(css.split("\n")[0], '@import "tailwindcss" source("..");');
  const rule = css.match(/a:focus-visible,\s*button:focus-visible\s*\{([^}]*)\}/)![1];
  assert.match(rule, /outline:\s*2px solid var\(--color-deep-blue-navy\);/);
  assert.doesNotMatch(rule, /color-mix|transparent/);
});

