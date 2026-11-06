import assert from "node:assert/strict";
import { test } from "node:test";
import { readAll, stubFetch } from "./helpers/fetch-stub.ts";
import { __setEnv } from "./stubs/astro-env-server.mjs";

__setEnv({ OPENROUTER_API_KEY: "sk-or-test" });
const { CHAT_DAILY_CAP, chatTurnCap, createTurnCap } = await import("../src/server/chat-cap.ts");
const { POST } = await import("../src/pages/api/v1/chat.ts");
type Ctx = Parameters<typeof POST>[0];

const HOUR = 60 * 60 * 1000;
const BUSY = "Xin lỗi hệ thống đang bận, vui lòng thử lại sau.";

function captureWarn() {
  const lines: string[] = [];
  const saved = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  return { lines, restore: () => void (console.warn = saved) };
}

test("trần 24 giờ trượt: đủ trần thì từ chối, chỉ log một lần, lượt cũ hết hạn thì mở lại đúng chừng ấy chỗ", () => {
  let now = 1_000_000;
  const cap = createTurnCap(3, () => now);
  const warn = captureWarn();
  try {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(cap.take(), true, `lượt ${i + 1}`);
      now += HOUR;
    }
    assert.equal(cap.take(), false);
    now += HOUR;
    assert.equal(cap.take(), false);
    assert.equal(warn.lines.length, 1);
    assert.match(warn.lines[0]!, /chạm trần 3 câu hỏi/);

    // Lượt đầu (mốc 1_000_000) hết hạn đúng 24 giờ sau; chỉ một chỗ được trả lại.
    now = 1_000_000 + 24 * HOUR;
    assert.equal(cap.take(), true);
    assert.equal(cap.take(), false);
    assert.equal(warn.lines.length, 1, "vẫn trong 24 giờ kể từ lần báo trước: không log lại");

    now += 48 * HOUR;
    assert.equal(cap.take(), true);
    assert.equal(cap.take(), true);
    assert.equal(cap.take(), true);
    assert.equal(cap.take(), false);
    assert.equal(warn.lines.length, 2);
  } finally {
    warn.restore();
  }
});

test("trần mặc định rộng tay, đủ cho người đọc thật", () => {
  assert.ok(CHAT_DAILY_CAP >= 500 && CHAT_DAILY_CAP <= 1000, String(CHAT_DAILY_CAP));
});

test("route: chạm trần thì trả lời 'đang bận' ngay, không gọi OpenRouter; câu vô nghĩa vẫn trả lời tại chỗ", async () => {
  const warn = captureWarn();
  let taken = 0;
  while (chatTurnCap.take()) taken += 1;
  assert.equal(taken, CHAT_DAILY_CAP);

  const stub = stubFetch(() => {
    throw new Error("không được gọi OpenRouter khi đã chạm trần");
  });
  const ask = async (message: string, ip: string) => {
    const request = new Request("https://www.cnnlegal.vn/api/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://www.cnnlegal.vn", host: "www.cnnlegal.vn" },
      body: JSON.stringify({ message, slug: null, history: [] }),
    });
    const res = await POST({ request, clientAddress: ip } as unknown as Ctx);
    return (await readAll(res)).split("\n\n").filter(Boolean).map((f) => JSON.parse(f.slice(6)) as Record<string, unknown>);
  };
  try {
    assert.deepEqual(await ask("Án lệ 13/2017 nói về điều gì?", "203.0.113.7"), [{ e: BUSY }]);
    const meaningless = await ask("???", "203.0.113.8");
    assert.equal(meaningless.at(-1)?.t, "Mình chưa hiểu câu hỏi. Bạn thử hỏi rõ hơn về một vụ án hoặc bài viết trên trang nhé.");
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
    warn.restore();
  }
  assert.equal(warn.lines.filter((l) => l.includes("chạm trần")).length, 1);
});
