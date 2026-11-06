import assert from "node:assert/strict";
import { test } from "node:test";
import { stubFetch } from "./helpers/fetch-stub.ts";
import { __setEnv } from "./stubs/astro-env-server.mjs";

__setEnv({ MISARMAIL_API_KEY: "msk_test" });
// guard.ts dựng danh sách Origin lúc import nên phải import động sau __setEnv.
const contactRoute = await import("../src/pages/api/v1/contact.ts");
const healthRoute = await import("../src/pages/api/v1/health.ts");

type Ctx = Parameters<typeof contactRoute.POST>[0];

const SITE = "https://www.cnnlegal.vn";
const PHONE = "08.59618686";
const BUSY_MSG = "Không gửi được lúc này, bạn thử lại sau hoặc gọi trực tiếp giúp mình nhé.";
const LEAD = {
  name: "Lê Văn C",
  phone: "0912345678",
  email: "c@example.com",
  field: "Hành chính",
  subject: "",
  message: "Xin tư vấn thủ tục.",
  cf_hp: "",
};

// Mỗi test một IP riêng để hạn mức trong bộ nhớ của test này không lây sang test khác.
let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;

function call(
  handler: (ctx: Ctx) => Response | Promise<Response>,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; ip?: string; url?: string } = {},
): Promise<Response> {
  const ip = init.ip ?? nextIp();
  const request = new Request(init.url ?? `${SITE}/api/v1/contact`, {
    method: init.method ?? "POST",
    headers: { host: "www.cnnlegal.vn", "x-vercel-forwarded-for": ip, ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return Promise.resolve(handler({ request, clientAddress: ip } as unknown as Ctx));
}

const browserPost = (body: unknown = LEAD, ip?: string) =>
  call(contactRoute.POST, { body, ip, headers: { "content-type": "application/json", origin: SITE } });

const ok200 = () => new Response(JSON.stringify({ message_id: "m-ok" }), { status: 200 });

test("POST không có Origin lẫn Sec-Fetch-Site: 403, không gọi MisarMail", async () => {
  const stub = stubFetch(ok200);
  try {
    const res = await call(contactRoute.POST, { body: LEAD, headers: { "content-type": "application/json" } });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Origin không được phép." });
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("POST không có Origin nhưng Sec-Fetch-Site: same-origin thì được nhận", async () => {
  const stub = stubFetch(ok200);
  try {
    const res = await call(contactRoute.POST, {
      body: LEAD,
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("Origin lạ, Origin localhost trên production, hay Sec-Fetch-Site khác same-origin: 403", async () => {
  const stub = stubFetch(ok200);
  try {
    const variants: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "https://evil.example", "sec-fetch-site": "same-origin" },
      { origin: "http://localhost:4321" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ];
    for (const headers of variants) {
      const res = await call(contactRoute.POST, { body: LEAD, headers: { "content-type": "application/json", ...headers } });
      assert.equal(res.status, 403, JSON.stringify(headers));
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("dev: trang và API cùng host (localhost) thì được nhận nhờ so host, không cần danh sách", async () => {
  const stub = stubFetch(ok200);
  try {
    const res = await call(contactRoute.POST, {
      url: "http://localhost:4825/api/v1/contact",
      body: LEAD,
      headers: { "content-type": "application/json", origin: "http://localhost:4825", host: "localhost:4825" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:4825");
  } finally {
    stub.restore();
  }
});

test("hạn mức riêng của form: 3 thư thì thư thứ 4 nhận 429 kèm số điện thoại, không gửi", async () => {
  const stub = stubFetch(ok200);
  const ip = nextIp();
  try {
    for (let i = 0; i < 3; i += 1) assert.equal((await browserPost(LEAD, ip)).status, 200);
    const res = await browserPost(LEAD, ip);
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.includes(PHONE), body.error);
    const retry = Number(res.headers.get("retry-after"));
    assert.ok(retry > 590 && retry <= 600, String(retry));
    assert.equal(stub.calls.length, 3);
    // IP khác không bị ảnh hưởng.
    assert.equal((await browserPost(LEAD)).status, 200);
  } finally {
    stub.restore();
  }
});

test("dữ liệu sai (400) không tiêu lượt gửi", async () => {
  const stub = stubFetch(ok200);
  const ip = nextIp();
  try {
    for (let i = 0; i < 4; i += 1) assert.equal((await browserPost({ ...LEAD, phone: "" }, ip)).status, 400);
    assert.equal((await browserPost(LEAD, ip)).status, 200);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("ô bẫy có chữ: trả 200 { ok: true } như gửi thành công, không gọi MisarMail, không tiêu lượt", async () => {
  const stub = stubFetch(ok200);
  const ip = nextIp();
  const warn = console.warn;
  const warned: unknown[][] = [];
  console.warn = (...args: unknown[]) => void warned.push(args);
  try {
    for (let i = 0; i < 5; i += 1) {
      const res = await browserPost({ ...LEAD, cf_hp: "http://spam.example" }, ip);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
    }
    assert.equal(stub.calls.length, 0);
    assert.equal(warned.length, 5);
    // Dòng log không chứa gì của khách.
    assert.ok(!JSON.stringify(warned).includes(LEAD.phone));
    assert.equal((await browserPost(LEAD, ip)).status, 200);
  } finally {
    console.warn = warn;
    stub.restore();
  }
});

test("MisarMail 403 (người gửi chưa xác minh) → 502 BUSY_MSG; health hiện lần gửi lỗi đó", async () => {
  const stub = stubFetch(
    () => new Response(JSON.stringify({ error: "'from.email' is not a verified account for this API key" }), { status: 403 }),
  );
  const error = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    const res = await browserPost();
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: BUSY_MSG });
    assert.equal(res.headers.get("access-control-allow-origin"), SITE);
    assert.equal(stub.calls.length, 1);
    // Log có mã lỗi để tra, không có nội dung liên hệ.
    const text = JSON.stringify(logged);
    assert.match(text, /HTTP 403/);
    for (const v of [LEAD.name, LEAD.phone, LEAD.email, LEAD.message]) assert.ok(!text.includes(v), v);
  } finally {
    console.error = error;
    stub.restore();
  }

  const health = await call(healthRoute.GET, { method: "GET", url: `${SITE}/api/v1/health` });
  assert.equal(health.status, 200);
  const body = (await health.json()) as { contact: { keyPresent: boolean; lastSend: { at: string; status: number; ok: boolean } } };
  assert.equal(body.contact.keyPresent, true);
  assert.equal(body.contact.lastSend.status, 403);
  assert.equal(body.contact.lastSend.ok, false);
  assert.ok(!Number.isNaN(Date.parse(body.contact.lastSend.at)));
  assert.deepEqual(Object.keys(body.contact.lastSend).sort(), ["at", "ok", "status"]);
});

const lastSend = async () => {
  const health = await call(healthRoute.GET, { method: "GET", url: `${SITE}/api/v1/health` });
  const body = (await health.json()) as { contact: { lastSend: { status: number; ok: boolean } } };
  return [body.contact.lastSend.status, body.contact.lastSend.ok];
};

test("lỗi mạng, hết giờ chờ, 5xx và 429 của MisarMail đều thành 502, mỗi loại gọi đúng một lần", async () => {
  const error = console.error;
  console.error = () => {};
  try {
    // Mã thứ hai là status health phải ghi lại: 0 là lỗi mạng hoặc hết thời gian chờ.
    for (const [make, status] of [
      [() => Promise.reject(new TypeError("fetch failed")), 0],
      [() => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")), 0],
      // Huỷ từ phía MisarMail/runtime, không phải khách đóng trang (request.signal còn nguyên).
      [() => Promise.reject(new DOMException("This operation was aborted", "AbortError")), 0],
      [() => new Response("upstream down", { status: 503 }), 503],
      [() => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }), 429],
    ] as const) {
      const stub = stubFetch(make);
      try {
        const res = await browserPost();
        assert.equal(res.status, 502);
        assert.deepEqual(await res.json(), { error: BUSY_MSG });
        assert.equal(stub.calls.length, 1);
        assert.deepEqual(await lastSend(), [status, false]);
      } finally {
        stub.restore();
      }
    }
  } finally {
    console.error = error;
  }
});

test("MisarMail 202 queued: khách nhận 200, health ghi lần gửi thành công", async () => {
  const stub = stubFetch(() => new Response(JSON.stringify({ queued: true, message_id: "m-q" }), { status: 202 }));
  const log = console.log;
  console.log = () => {};
  try {
    const res = await browserPost();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(await lastSend(), [202, true]);
  } finally {
    console.log = log;
    stub.restore();
  }
});

test("health là GET, không cần Origin", async () => {
  const res = await call(healthRoute.GET, { method: "GET", url: `${SITE}/api/v1/health`, headers: {} });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; contact: { keyPresent: boolean } };
  assert.equal(body.ok, true);
  assert.equal(body.contact.keyPresent, true);
});

test("OPTIONS preflight vẫn trả CORS cho Origin được phép, không trả cho Origin lạ; GET là 405", async () => {
  const allowed = await call(contactRoute.OPTIONS, {
    method: "OPTIONS",
    headers: { origin: "https://cnnlegal.vn", "access-control-request-method": "POST" },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://cnnlegal.vn");
  assert.equal(allowed.headers.get("access-control-allow-methods"), "POST, OPTIONS");

  const foreign = await call(contactRoute.OPTIONS, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
  assert.equal(foreign.status, 204);
  assert.equal(foreign.headers.get("access-control-allow-origin"), null);

  const get = await call(contactRoute.GET, { method: "GET" });
  assert.equal(get.status, 405);
});
