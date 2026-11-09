import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_ALLOWED_ORIGINS } from "./stubs/astro-env-server.mjs";

// guard.ts dựng danh sách Origin lúc import: import động để đọc đúng giá trị của .env mẫu.
const guard = await import("../src/server/guard.ts");

const req = (headers: Record<string, string>, url = "https://www.cnnlegal.vn/api/v1/chat") =>
  new Request(url, { method: "POST", headers });

test("danh sách Origin mặc định chỉ còn hai tên miền production", () => {
  assert.equal(CHAT_ALLOWED_ORIGINS, "https://cnnlegal.vn,https://www.cnnlegal.vn");
  const prod = { host: "www.cnnlegal.vn" };
  assert.equal(guard.originAllowed(req({ ...prod, origin: "https://www.cnnlegal.vn" })), true);
  assert.equal(guard.originAllowed(req({ ...prod, origin: "https://cnnlegal.vn" })), true);
  // localhost:4321 không còn được production nhận, cũng không được trả CORS.
  const local = req({ ...prod, origin: "http://localhost:4321" });
  assert.equal(guard.originAllowed(local), false);
  assert.deepEqual(guard.corsHeaders(local), {});
});

test("Origin cùng host với request được nhận (dev, bản preview của Vercel)", () => {
  for (const [origin, host] of [
    ["http://localhost:4321", "localhost:4321"],
    ["http://localhost:4825", "LOCALHOST:4825"],
    ["https://cnnlegal-git-x.vercel.app", "cnnlegal-git-x.vercel.app"],
  ]) {
    const r = req({ origin: origin!, host: host! });
    assert.equal(guard.originAllowed(r), true, origin);
    assert.equal(guard.corsHeaders(r)["Access-Control-Allow-Origin"], origin);
  }
  // x-forwarded-host được ưu tiên hơn host.
  assert.equal(
    guard.originAllowed(req({ origin: "https://a.example", host: "a.example", "x-forwarded-host": "b.example" })),
    false,
  );
  // Origin "null", sai cú pháp hay rỗng thì từ chối, không ném lỗi.
  for (const origin of ["null", "not a url", ""]) {
    assert.equal(guard.originAllowed(req({ origin, host: "www.cnnlegal.vn" })), false, JSON.stringify(origin));
  }
});

test("không có Origin: chỉ nhận khi Sec-Fetch-Site là same-origin", () => {
  const host = { host: "www.cnnlegal.vn" };
  assert.equal(guard.originAllowed(req(host)), false);
  assert.equal(guard.originAllowed(req({ ...host, "sec-fetch-site": "same-origin" })), true);
  for (const site of ["same-site", "cross-site", "none", "SAME-ORIGIN "]) {
    assert.equal(guard.originAllowed(req({ ...host, "sec-fetch-site": site })), false, site);
  }
  // Có Origin thì Origin quyết định, Sec-Fetch-Site không cứu được Origin lạ.
  assert.equal(guard.originAllowed(req({ ...host, origin: "https://evil.example", "sec-fetch-site": "same-origin" })), false);
  // Không có Origin thì không có CORS.
  assert.deepEqual(guard.corsHeaders(req({ ...host, "sec-fetch-site": "same-origin" })), {});
});

test("bộ đếm chống dồn dập vẫn cho 6 lượt dồn rồi 1 lượt/giây", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 6; i += 1) assert.equal(guard.withinRateLimit("burst-ip", t0), true);
  assert.equal(guard.withinRateLimit("burst-ip", t0), false);
  assert.equal(guard.withinRateLimit("burst-ip", t0 + 1000), true);
  assert.equal(guard.withinRateLimit("burst-ip", t0 + 1000), false);
});

test("20.000 IP lạ ập tới trong 3 giây: Map không bao giờ vượt trần 5.000", () => {
  const t0 = 2_000_000;
  let max = 0;
  for (let i = 0; i < 20_000; i += 1) {
    assert.equal(guard.withinRateLimit(`flood-${i}`, t0 + Math.floor((i * 3000) / 20_000)), true);
    max = Math.max(max, guard.rateLimitKeys());
  }
  assert.ok(max <= 5000, `Map lên tới ${max} khoá`);
  assert.ok(guard.rateLimitKeys() >= 4500, String(guard.rateLimitKeys()));
  // Khoá cũ nhất đã bị bỏ, khoá mới nhất còn giữ (lượt thứ hai của nó vẫn trừ vào bucket cũ).
  for (let i = 0; i < 5; i += 1) guard.withinRateLimit("flood-19999", t0 + 3000);
  assert.equal(guard.withinRateLimit("flood-19999", t0 + 3000), false);
});

test("khoá đã nguội bị dọn trước khi phải bỏ khoá còn nóng", () => {
  const t0 = 10_000_000;
  for (let i = 0; i < 5000; i += 1) guard.withinRateLimit(`old-${i}`, t0);
  // 7 giây sau mọi khoá cũ đã nguội (6 lượt / 1 lượt mỗi giây): chèn khoá mới thì cả mẻ cũ được dọn.
  guard.withinRateLimit("fresh", t0 + 7000);
  assert.equal(guard.rateLimitKeys(), 1);
});

test("IP dội liên tục giữa lúc ngập IP lạ không bị bỏ khỏi Map, nên không có lại lượt dồn", () => {
  const t0 = 20_000_000;
  let admitted = 0;
  for (let i = 0; i < 20_000; i += 1) {
    const now = t0 + Math.floor((i * 3000) / 20_000);
    guard.withinRateLimit(`flood2-${i}`, now);
    if (i % 50 === 0 && guard.withinRateLimit("steady", now)) admitted += 1;
    assert.ok(guard.rateLimitKeys() <= 5000);
  }
  // 400 lần gọi trong 3 giây: chỉ 6 lượt dồn cộng khoảng 1 lượt mỗi giây được qua.
  assert.ok(admitted <= 10, `qua ${admitted} lượt`);
});
