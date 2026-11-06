import assert from "node:assert/strict";
import { test } from "node:test";
import { stubFetch } from "./helpers/fetch-stub.ts";
import { __setEnv } from "./stubs/astro-env-server.mjs";
import { parseContact, sendContactEmail, type ContactData } from "../src/server/contact.ts";

// Người gửi, người nhận đặt riêng cho test: đổi CONTACT_FROM_EMAIL trong .env (vd. sau khi xác minh
// người gửi trên MisarMail) không được làm hỏng test, chỉ cần thư đi đúng theo biến môi trường.
__setEnv({ MISARMAIL_API_KEY: "msk_test", CONTACT_FROM_EMAIL: "gui@example.test", CONTACT_TO_EMAIL: "nhan@example.test" });

const MISARMAIL_URL = "https://api.misar.io/mail/v1/send";

function lead(email = "khach@example.com"): ContactData {
  const r = parseContact({
    name: "Trần Thị B",
    phone: "0901234567",
    email,
    field: "Dân sự - Kinh doanh",
    subject: "Hợp đồng",
    message: "Cần tư vấn <gấp> & bảo mật",
  });
  assert.ok(r.ok);
  return r.data;
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("200: gửi một lần, đúng địa chỉ, khoá và nội dung thư", async () => {
  const stub = stubFetch(() => reply(200, { message_id: "m-1" }));
  try {
    const result = await sendContactEmail(lead(), new AbortController().signal);
    assert.deepEqual(result, { ok: true, status: 200, messageId: "m-1", detail: null });
    assert.equal(stub.calls.length, 1);
    const [call] = stub.calls;
    assert.equal(call!.url, MISARMAIL_URL);
    assert.equal(call!.init?.method, "POST");
    assert.equal((call!.init?.headers as Record<string, string>).Authorization, "Bearer msk_test");
    const payload = call!.json as Record<string, any>;
    assert.deepEqual(payload.from, { email: "gui@example.test", name: "CNN Legal" });
    assert.deepEqual(payload.to, [{ email: "nhan@example.test" }]);
    assert.deepEqual(payload.reply_to, { email: "khach@example.com", name: "Trần Thị B" });
    assert.equal(payload.subject, "[CNN Legal] Dân sự - Kinh doanh – Hợp đồng – Trần Thị B");
    assert.match(payload.html, /Cần tư vấn &lt;gấp&gt; &amp; bảo mật/);
    assert.match(payload.text, /^Họ tên: Trần Thị B\nĐiện thoại: 0901234567\n/);
  } finally {
    stub.restore();
  }
});

test("202 queued vẫn là đã nhận thư", async () => {
  const stub = stubFetch(() => reply(202, { queued: true, message_id: "m-2" }));
  try {
    const result = await sendContactEmail(lead(), new AbortController().signal);
    assert.equal(result.ok, true);
    assert.equal(result.status, 202);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("400 vì reply_to: gửi lại đúng một lần, bỏ reply_to", async () => {
  const stub = stubFetch((_url, _init, i) =>
    i === 0 ? reply(400, { error: "Validation failed", fieldErrors: { reply_to: ["invalid"] } }) : reply(200, { message_id: "m-3" }),
  );
  try {
    const result = await sendContactEmail(lead("a@gmail..com"), new AbortController().signal);
    assert.equal(stub.calls.length, 2);
    assert.ok((stub.calls[0]!.json as Record<string, unknown>).reply_to);
    assert.equal((stub.calls[1]!.json as Record<string, unknown>).reply_to, undefined);
    assert.deepEqual(result, { ok: true, status: 200, messageId: "m-3", detail: null });
  } finally {
    stub.restore();
  }
});

test("400 lần hai hoặc 400 khi không có reply_to thì dừng, không gửi thêm", async () => {
  let stub = stubFetch(() => reply(400, { error: "bad" }));
  try {
    const result = await sendContactEmail(lead(), new AbortController().signal);
    assert.equal(stub.calls.length, 2);
    assert.equal(result.status, 400);
    assert.equal(result.ok, false);
  } finally {
    stub.restore();
  }
  stub = stubFetch(() => reply(400, { error: "bad" }));
  try {
    const result = await sendContactEmail(lead(""), new AbortController().signal);
    assert.equal(stub.calls.length, 1);
    assert.equal(result.status, 400);
  } finally {
    stub.restore();
  }
});

test("403, 429 và 5xx: báo lỗi, không bao giờ gửi lại (tránh thư trùng)", async () => {
  for (const [status, body] of [
    [403, { error: "'from.email' is not a verified account for this API key" }],
    [429, { error: "Too many requests" }],
    [500, { message: "Internal error" }],
    [503, "<html>Service Unavailable</html>"],
  ] as const) {
    const stub = stubFetch(() =>
      typeof body === "string" ? new Response(body, { status }) : reply(status, body),
    );
    try {
      const result = await sendContactEmail(lead(), new AbortController().signal);
      assert.equal(stub.calls.length, 1, String(status));
      assert.equal(result.ok, false);
      assert.equal(result.status, status);
      if (status === 403) assert.equal(result.detail, "'from.email' is not a verified account for this API key");
      if (status === 500) assert.equal(result.detail, "Internal error");
      if (status === 503) assert.equal(result.detail, null);
    } finally {
      stub.restore();
    }
  }
});

test("lỗi mạng và hết thời gian chờ: ném lỗi cho route xử lý", async () => {
  let stub = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
  try {
    await assert.rejects(sendContactEmail(lead(), new AbortController().signal), TypeError);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
  // AbortSignal.timeout(15 s) hết giờ thì fetch ném TimeoutError; giả lập ngay để khỏi chờ.
  stub = stubFetch(() => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
  try {
    await assert.rejects(sendContactEmail(lead(), new AbortController().signal), { name: "TimeoutError" });
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("khách đóng trang giữa chừng thì lời gọi MisarMail bị huỷ theo", async () => {
  const controller = new AbortController();
  const stub = stubFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        assert.ok(signal && !signal.aborted);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        controller.abort(new DOMException("client gone", "AbortError"));
      }),
  );
  try {
    await assert.rejects(sendContactEmail(lead(), controller.signal), { name: "AbortError" });
  } finally {
    stub.restore();
  }
});
