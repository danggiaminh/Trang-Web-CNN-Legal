// Tải trước ảnh trang đích (src/scripts/image-preload.ts) chỉ khi người dùng thật sự nhắm vào
// link: chuột thật dừng ~90 ms hoặc focus bằng bàn phím (hết giờ mà link không còn :hover hay
// :focus-visible thì thôi); không chạy khi chạm, lướt chuột, Save-Data hay mạng 2g/3g.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { stubFetch } from "./helpers/fetch-stub.ts";

type Handler = (event: Record<string, unknown>) => void;
type Connection = { saveData?: boolean; effectiveType?: string };

class FakeElement {}

class FakeLink extends FakeElement {
  hovered = false;
  focusVisible = false;
  readonly target = "";
  readonly path: string;
  readonly href: string;
  // href: thuộc tính đã phân giải thành URL tuyệt đối như của thẻ <a> thật.
  constructor(path: string, href = `https://www.cnnlegal.vn${path}`) {
    super();
    this.path = path;
    this.href = href;
  }
  closest() {
    return this;
  }
  matches(selector: string) {
    if (selector === ":focus-visible") return this.focusVisible;
    assert.equal(selector, ":hover,:focus-visible");
    return this.hovered || this.focusVisible;
  }
  getAttribute(name: string) {
    return name === "href" ? this.path : null;
  }
  hasAttribute() {
    return false;
  }
}

let handlers = new Map<string, Handler>();
const nav: { connection?: Connection } = {};

Object.assign(globalThis, {
  Element: FakeElement,
  location: { href: "https://www.cnnlegal.vn/", origin: "https://www.cnnlegal.vn", pathname: "/" },
  document: { addEventListener: (type: string, fn: Handler) => handlers.set(type, fn) },
});
Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });

// Trang đích trả 404 nên script dừng ngay sau fetch: chỉ cần đếm request HTML.
const fetches = stubFetch(() => new Response("", { status: 404 }));
const fetched = () => fetches.calls.map((c) => new URL(c.url).pathname);

mock.timers.enable({ apis: ["setTimeout"] });

// Script xét navigator.connection lúc nạp, nên mỗi kiểu mạng nạp một bản mới (query khác nhau).
// Script trình duyệt không phải module ES (không import/export) nên nạp theo URL.
let loads = 0;
const load = async (connection?: Connection) => {
  nav.connection = connection;
  handlers = new Map();
  await import(new URL(`../src/scripts/image-preload.ts?lan=${++loads}`, import.meta.url).href);
  return handlers;
};

const on = await load();
const fire = (type: string, link: FakeLink, extra: Record<string, unknown> = {}) =>
  on.get(type)!({ type, target: link, ...extra });
// Chạm cũng đặt hovered: chặn được là nhờ pointerType, không phải nhờ :hover.
const hover = (link: FakeLink, pointerType = "mouse") => {
  link.hovered = true;
  fire("pointerover", link, { pointerType });
};

test("chỉ nghe pointerover và focusin", () => {
  assert.deepEqual([...on.keys()].sort(), ["focusin", "pointerover"]);
});

test("chuột dừng 90 ms trên link thì mới tải trước, mỗi trang một lần", () => {
  const link = new FakeLink("/dich-vu/");
  hover(link);
  mock.timers.tick(89);
  assert.deepEqual(fetched(), []);
  mock.timers.tick(1);
  assert.deepEqual(fetched(), ["/dich-vu/"]);
  hover(link);
  mock.timers.tick(200);
  assert.deepEqual(fetched(), ["/dich-vu/"]);
});

test("rời link trước 90 ms là huỷ; lướt chuột ngang hàng link 30 ms mỗi link không tải gì", () => {
  const before = fetched().length;
  const first = new FakeLink("/tong-quan/");
  hover(first);
  mock.timers.tick(60);
  first.hovered = false;
  mock.timers.tick(200);
  for (const path of ["/kinh-nghiem/", "/bai-viet/", "/lien-he/", "/"]) {
    const link = new FakeLink(path);
    hover(link);
    mock.timers.tick(30);
    link.hovered = false;
  }
  mock.timers.tick(500);
  assert.equal(fetched().length, before);
});

test("link #…, href rỗng, mailto:, tel: và chính trang đang xem không tải gì", () => {
  const before = fetched().length;
  for (const [path, href] of [
    ["#lien-he", "https://www.cnnlegal.vn/#lien-he"],
    ["", "https://www.cnnlegal.vn/"],
    ["/", "https://www.cnnlegal.vn/"],
    ["?trang=2", "https://www.cnnlegal.vn/?trang=2"],
    ["mailto:info@cnnlegal.vn", "mailto:info@cnnlegal.vn"],
    ["tel:+84000000000", "tel:+84000000000"],
  ]) {
    hover(new FakeLink(path!, href));
    mock.timers.tick(100);
  }
  assert.equal(fetched().length, before);
});

test("chạm và bút không tải trước (pointerover của cảm ứng là lúc bắt đầu cuộn trang)", () => {
  const before = fetched().length;
  hover(new FakeLink("/vu-an-tieu-bieu/a/"), "touch");
  hover(new FakeLink("/vu-an-tieu-bieu/b/"), "pen");
  mock.timers.tick(500);
  assert.equal(fetched().length, before);
});

test("focus bằng bàn phím (:focus-visible) dừng 90 ms thì tải; focus do nhấp hoặc Tab lướt qua thì không", () => {
  const keyboard = new FakeLink("/bai-viet/x/");
  keyboard.focusVisible = true;
  fire("focusin", keyboard);
  mock.timers.tick(90);
  assert.deepEqual(fetched().slice(-1), ["/bai-viet/x/"]);

  const before = fetched().length;
  fire("focusin", new FakeLink("/bai-viet/y/"));
  mock.timers.tick(200);
  for (const path of ["/bai-viet/z1/", "/bai-viet/z2/", "/bai-viet/z3/"]) {
    const passing = new FakeLink(path);
    passing.focusVisible = true;
    fire("focusin", passing);
    mock.timers.tick(40);
    passing.focusVisible = false;
  }
  mock.timers.tick(500);
  assert.equal(fetched().length, before);
});

test("Save-Data hoặc mạng slow-2g/2g/3g thì bỏ hẳn (không gắn sự kiện nào); 4g vẫn tải", async () => {
  for (const connection of [{ saveData: true }, { effectiveType: "slow-2g" }, { effectiveType: "2g" }, { effectiveType: "3g" }]) {
    assert.equal((await load(connection)).size, 0, JSON.stringify(connection));
  }
  const fast = await load({ effectiveType: "4g", saveData: false });
  const before = fetched().length;
  const link = new FakeLink("/nhanh/");
  link.hovered = true;
  fast.get("pointerover")!({ type: "pointerover", target: link, pointerType: "mouse" });
  mock.timers.tick(90);
  assert.deepEqual(fetched().slice(before), ["/nhanh/"]);
  mock.timers.reset();
  fetches.restore();
});
