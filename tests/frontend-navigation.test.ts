// Ngăn kéo menu di động (src/scripts/navigation.ts) chạy trên DOM giả: đóng thì inert, mở thì
// focus tới nút Đóng, đóng thì trả focus về nút Mở menu, Escape đóng được.
import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Listener = (event: Record<string, unknown>) => void;

let focused: FakeElement | null = null;
let focusCalls = 0;

class FakeElement {
  readonly attrs = new Map<string, string>();
  readonly classes: Set<string>;
  readonly listeners: { type: string; fn: Listener }[] = [];
  inert = false;
  lastFocusOptions: unknown;
  constructor(classes: string[] = [], attrs: Record<string, string> = {}) {
    this.classes = new Set(classes);
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }
  readonly classList = {
    toggle: (name: string, force: boolean) => void (force ? this.classes.add(name) : this.classes.delete(name)),
  };
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value));
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.push({ type, fn });
  }
  emit(type: string, event: Record<string, unknown> = {}) {
    for (const l of [...this.listeners]) if (l.type === type) l.fn({ type, target: this, ...event });
  }
  focus(options?: unknown) {
    focused = this;
    focusCalls++;
    this.lastFocusOptions = options;
  }
}

const menuButton = new FakeElement([], { "aria-expanded": "false" });
const closeButton = new FakeElement();
// Ngăn kéo trong markup đóng sẵn và có thuộc tính inert.
const drawer = new FakeElement(["translate-x-full"]);
drawer.inert = true;
// Link đầu (logo) và link cuối (Liên hệ) của ngăn kéo; nút Đóng nằm giữa.
const firstLink = new FakeElement();
const drawerLink = new FakeElement();
const body = new FakeElement();
const docListeners: { type: string; fn: Listener }[] = [];

Object.assign(globalThis, {
  document: {
    body,
    querySelector: (selector: string) =>
      ({ "[data-menu-button]": menuButton, "[data-menu-close]": closeButton, "[data-mobile-drawer]": drawer })[selector] ??
      null,
    querySelectorAll: (selector: string) =>
      selector === "[data-mobile-drawer] a" ? [firstLink, drawerLink] : [],
    addEventListener: (type: string, fn: Listener) => docListeners.push({ type, fn }),
  },
});

let prevented = 0;
const pressKey = (key: string, shiftKey = false) => {
  for (const l of docListeners) if (l.type === "keydown") l.fn({ key, shiftKey, target: focused, preventDefault: () => prevented++ });
};

const isOpen = () => menuButton.getAttribute("aria-expanded") === "true";

// Hết hiệu ứng trượt (200 ms + 50 ms dự phòng) thì ngăn kéo mới nhận lệnh tiếp.
const finishTransition = () => mock.timers.tick(250);

mock.timers.enable({ apis: ["setTimeout"] });
// Script trình duyệt không phải module ES (không import/export) nên nạp theo URL.
await import(new URL("../src/scripts/navigation.ts", import.meta.url).href);

test("Escape khi ngăn kéo đang đóng không làm gì, không cướp focus", () => {
  pressKey("Escape");
  assert.equal(focusCalls, 0);
  assert.equal(drawer.inert, true);
  assert.equal(isOpen(), false);
});

test("mở menu: bỏ inert, trượt vào, focus tới nút Đóng mà không cuộn", () => {
  menuButton.emit("click");
  assert.equal(isOpen(), true);
  assert.equal(drawer.inert, false);
  assert.ok(drawer.classes.has("translate-x-0") && !drawer.classes.has("translate-x-full"));
  assert.ok(body.classes.has("nav-open"));
  assert.equal(focused, closeButton);
  assert.deepEqual(closeButton.lastFocusOptions, { preventScroll: true });
  finishTransition();
});

test("Escape đóng menu: inert lại và trả focus về nút Mở menu", () => {
  pressKey("Escape");
  assert.equal(isOpen(), false);
  assert.equal(drawer.inert, true);
  assert.ok(drawer.classes.has("translate-x-full"));
  assert.ok(!body.classes.has("nav-open"));
  assert.equal(focused, menuButton);
  finishTransition();
});

test("nút Đóng và link trong ngăn kéo cũng đóng, focus về nút Mở menu", () => {
  for (const closer of [closeButton, drawerLink]) {
    menuButton.emit("click");
    finishTransition();
    assert.equal(isOpen(), true);
    closer.emit("click");
    assert.equal(isOpen(), false);
    assert.equal(drawer.inert, true);
    assert.equal(focused, menuButton);
    finishTransition();
  }
});

test("ngăn kéo mở: Tab ở link cuối vòng về link đầu, Shift+Tab ở link đầu về link cuối", () => {
  menuButton.emit("click");
  finishTransition();
  drawerLink.focus();
  pressKey("Tab");
  assert.equal(focused, firstLink);
  pressKey("Tab", true);
  assert.equal(focused, drawerLink);
  assert.equal(prevented, 2);
  // Ở giữa danh sách thì để trình duyệt tự chuyển focus.
  closeButton.focus();
  pressKey("Tab");
  pressKey("Tab", true);
  assert.equal(focused, closeButton);
  assert.equal(prevented, 2);
  pressKey("Escape");
  assert.equal(focused, menuButton);
  pressKey("Tab");
  assert.equal(prevented, 2);
  finishTransition();
});

test("nút Đóng bấm khi ngăn kéo đã đóng không đổi gì", () => {
  const before = focusCalls;
  closeButton.emit("click");
  assert.equal(focusCalls, before);
  assert.equal(drawer.inert, true);
  mock.timers.reset();
});

test("trình duyệt chưa hỗ trợ inert: link của ngăn kéo đóng vẫn nhận focus, Tab không bị giữ lại trong đó", () => {
  const before = prevented;
  // inert là undefined trước lần mở đầu (thuộc tính không được phản chiếu), là expando true sau khi đóng.
  for (const inert of [undefined, true]) {
    drawer.inert = inert as boolean;
    drawerLink.focus();
    pressKey("Tab");
    firstLink.focus();
    pressKey("Tab", true);
  }
  assert.equal(prevented, before);
  drawer.inert = true;
});
