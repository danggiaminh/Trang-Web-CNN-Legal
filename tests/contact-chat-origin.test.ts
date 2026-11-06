import assert from "node:assert/strict";
import { test } from "node:test";
import { readAll, sseEvent, sseResponse, stubFetch } from "./helpers/fetch-stub.ts";
import { __setEnv } from "./stubs/astro-env-server.mjs";

// Có khoá thì một request lọt cổng sẽ gọi OpenRouter thật sự (ở đây là fetch giả), nên số lần gọi
// fetch cho biết request có đi qua cổng Origin hay không.
__setEnv({ OPENROUTER_API_KEY: "sk-or-test" });
const { POST } = await import("../src/pages/api/v1/chat.ts");

type Ctx = Parameters<typeof POST>[0];
let ipSeq = 0;

function chat(headers: Record<string, string>, message = "Thủ tục ly hôn đơn phương thế nào?"): Promise<Response> {
  const ip = `192.0.2.${++ipSeq}`;
  const request = new Request("https://www.cnnlegal.vn/api/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.cnnlegal.vn", "x-vercel-forwarded-for": ip, ...headers },
    body: JSON.stringify({ message }),
  });
  return Promise.resolve(POST({ request, clientAddress: ip } as unknown as Ctx));
}

const openRouterStream = () =>
  sseResponse([sseEvent({ choices: [{ delta: { content: "Chào bạn." } }] }), sseEvent("[DONE]")]);

test("chat POST không có Origin lẫn Sec-Fetch-Site: 403, không gọi OpenRouter", async () => {
  const stub = stubFetch(openRouterStream);
  try {
    const res = await chat({});
    assert.equal(res.status, 403);
    assert.deepEqual(JSON.parse(await readAll(res)), { error: "Origin không được phép." });
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("chat POST có Origin lạ: 403, không gọi OpenRouter", async () => {
  const stub = stubFetch(openRouterStream);
  try {
    const res = await chat({ origin: "https://evil.example", "sec-fetch-site": "same-origin" });
    assert.equal(res.status, 403);
    await readAll(res);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

// Đối chứng chỉ kiểm cổng Origin: phần trả lời phía sau thuộc chat.ts (nhóm khác có thể sửa), nên
// chỉ cần request không bị 403 và đã gọi ra ngoài.
test("đối chứng: cùng câu hỏi từ trang của site (Origin hoặc Sec-Fetch-Site) thì qua được cổng", async () => {
  const variants: Record<string, string>[] = [{ origin: "https://www.cnnlegal.vn" }, { "sec-fetch-site": "same-origin" }];
  for (const headers of variants) {
    const stub = stubFetch(openRouterStream);
    try {
      const res = await chat(headers);
      assert.notEqual(res.status, 403, JSON.stringify(headers));
      await readAll(res);
      assert.ok(stub.calls.length >= 1, JSON.stringify(headers));
    } finally {
      stub.restore();
    }
  }
});
