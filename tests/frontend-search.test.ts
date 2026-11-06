// Hộp tìm kiếm (script trong src/components/Search.astro) chạy trên DOM giả: vùng status ẩn đọc
// trạng thái đang tải, lỗi tải, số kết quả, không có kết quả; listbox chỉ chứa option (gom trong
// group có nhãn), tiêu đề mục và dòng thông báo bị ẩn khỏi trình đọc màn hình.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { stubFetch } from "./helpers/fetch-stub.ts";

type Listener = (event: Record<string, unknown>) => void;

class FakeElement {
  readonly attrs = new Map<string, string>();
  readonly listeners: { type: string; fn: Listener }[] = [];
  innerHTML = "";
  textContent = "";
  className = "";
  value = "";
  placeholder = "";
  readonly clientWidth = 0;
  next: FakeElement | null = null;
  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.push({ type, fn });
  }
  emit(type: string, event: Record<string, unknown> = {}) {
    for (const l of this.listeners) if (l.type === type) l.fn({ type, target: this, ...event });
  }
  focus() {}
  after(el: FakeElement) {
    this.next = el;
  }
  querySelectorAll() {
    return [];
  }
  getContext() {
    return null;
  }
}

const overlay = new FakeElement();
const input = new FakeElement();
const list = new FakeElement();
const crumbs = new FakeElement();
const opener = new FakeElement();
const docListeners: Listener[] = [];
const elements: Record<string, FakeElement> = {
  "[data-search-overlay]": overlay,
  "[data-search-input]": input,
  "[data-search-results]": list,
  "[data-search-crumbs]": crumbs,
  "[data-search-close]": new FakeElement(),
};

Object.assign(globalThis, {
  window: { addEventListener() {}, open() {} },
  document: {
    body: new FakeElement(),
    activeElement: opener,
    querySelector: (selector: string) => elements[selector] ?? null,
    querySelectorAll: (selector: string) => (selector === "[data-search-open]" ? [opener] : []),
    createElement: () => new FakeElement(),
    addEventListener: (type: string, fn: Listener) => void (type === "keydown" && docListeners.push(fn)),
  },
});

const press = (key: string, extra: Record<string, unknown> = {}) => {
  for (const fn of docListeners) fn({ key, preventDefault() {}, ...extra });
};
const type = (text: string) => {
  input.value = text;
  input.emit("input");
};
// Chờ fetch giả, đọc body và chuỗi then của loadIndex chạy xong (vài vòng event loop, không hẹn giờ).
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

// Các phần tử con trực tiếp của một đoạn HTML (bỏ qua thẻ tự đóng như <path/>).
const children = (html: string) => {
  const out: { attrs: string; inner: string }[] = [];
  let depth = 0;
  let attrs = "";
  let innerStart = 0;
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/gi)) {
    if (m[4]) continue;
    if (!m[1]) {
      if (depth === 0) {
        attrs = m[3];
        innerStart = m.index + m[0].length;
      }
      depth++;
    } else if (--depth === 0) {
      out.push({ attrs, inner: html.slice(innerStart, m.index) });
    }
  }
  return out;
};

// Listbox: con trực tiếp chỉ là group có nhãn (chứa toàn option) hoặc phần tử aria-hidden.
const assertListboxOnlyOptions = () => {
  const groups = children(list.innerHTML).filter((c) => !/aria-hidden="true"/.test(c.attrs));
  for (const group of groups) {
    assert.match(group.attrs, /role="group" aria-label="[^"]+"/);
    for (const option of children(group.inner)) assert.match(option.attrs, /role="option"/);
  }
  return groups;
};

const source = readFileSync(new URL("../src/components/Search.astro", import.meta.url), "utf8");
const script = source.match(/<script>([\s\S]*?)<\/script>/)![1]!;
const dir = mkdtempSync(join(tmpdir(), "frontend-search-"));
after(() => rmSync(dir, { recursive: true, force: true }));

let indexOk = false;
const index = [
  { t: "Bào chữa hình sự", d: "Luật sư bào chữa", u: "/dich-vu/bao-chua-hinh-su/", g: "", k: "" },
  { t: "Án lệ 13/2017/AL", d: "Hiệu lực thanh toán thư tín dụng", u: "/bai-viet/an-le-13/", g: "", k: "" },
];
const fetches = stubFetch(() =>
  indexOk ? Response.json(index) : new Response("", { status: 500 })
);
after(() => fetches.restore());

writeFileSync(join(dir, "search.ts"), script);
await import(pathToFileURL(join(dir, "search.ts")).href);
const status = list.next!;

test("có đúng một vùng status ẩn (sr-only) đặt ngay sau listbox", () => {
  assert.ok(status, "chưa dựng vùng status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.className, "sr-only");
  assert.equal(status.textContent, "");
});

test("đang tải rồi lỗi tải đều được báo qua status", async () => {
  press("k", { ctrlKey: true });
  assert.equal(status.textContent, "Đang tải dữ liệu tìm kiếm…");
  assert.match(list.innerHTML, /^<p aria-hidden="true"/);
  await settle();
  assert.equal(status.textContent, "Không tải được dữ liệu tìm kiếm. Thử lại sau nhé.");
  assert.equal(input.getAttribute("aria-expanded"), "false");
  press("Escape");
  assert.equal(status.textContent, "", "đóng hộp phải xoá status để lần mở sau vẫn được đọc");
});

test("tải được thì báo số mục; listbox chỉ chứa option trong group có nhãn", async () => {
  indexOk = true;
  opener.emit("click");
  await settle();
  assert.equal(status.textContent, "Điều hướng: 5 mục");
  assert.equal(input.getAttribute("aria-expanded"), "true");
  assert.equal(input.getAttribute("aria-activedescendant"), "search-hit-0");
  const [group] = assertListboxOnlyOptions();
  assert.match(group!.attrs, /aria-label="Điều hướng"/);
  assert.equal(children(group!.inner).length, 5);
});

test("không có kết quả thì báo qua status, câu hỏi được thoát HTML trong danh sách", () => {
  type("zzz");
  assert.equal(status.textContent, "Không tìm thấy kết quả cho “zzz”.");
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.equal(input.getAttribute("aria-activedescendant"), null);
  type("<img src=x onerror=alert(1)>");
  assert.ok(!list.innerHTML.includes("<img"), list.innerHTML);
  assert.match(list.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(status.textContent, "Không tìm thấy kết quả cho “<img src=x onerror=alert(1)>”.");
  assertListboxOnlyOptions();
});

test("có kết quả thì báo số kết quả và chọn sẵn hàng đầu", () => {
  type("bào chữa");
  assert.equal(status.textContent, "Kết quả: 1 mục");
  assert.equal(input.getAttribute("aria-activedescendant"), "search-hit-0");
  const [group] = assertListboxOnlyOptions();
  assert.match(group!.inner, /id="search-hit-0" role="option" aria-selected="true"/);
  press("Escape");
  assert.equal(status.textContent, "");
});
