import assert from "node:assert/strict";
import { test } from "node:test";
import { streamTurn, type UsageStats } from "../src/server/openrouter.ts";
import { sseEvent, sseResponse } from "./helpers/fetch-stub.ts";

const delta = (content: string) => sseEvent({ choices: [{ index: 0, delta: { content } }] });
const finish = (reason: string) => sseEvent({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const DONE = "data: [DONE]\n\n";

// Dài hơn mốc giữ lại 48 ký tự, nên đã phát ra ngoài trước khi lỗi tới.
const PART = "Theo bài viết, cơ chế thu hồi đất khi vượt ngưỡng đồng thuận 75% được đề xuất như sau: ";

async function collect(res: Response, onUsage?: (u: UsageStats) => void) {
  const gen = streamTurn(res, 4000, onUsage);
  const pieces: string[] = [];
  for (;;) {
    const { value, done } = await gen.next();
    if (done) return { text: pieces.join(""), pieces, turn: value };
    pieces.push(value);
  }
}

test("khung lỗi giữa luồng: dừng đọc, trả về lỗi và finish_reason error", async () => {
  // Đúng dạng OpenRouter gửi khi nhà cung cấp đứt giữa chừng sau khi đã trả HTTP 200.
  const errorChunk = sseEvent({
    id: "gen-1",
    object: "chat.completion.chunk",
    provider: "parasail",
    error: { code: "server_error", message: "Provider disconnected unexpectedly" },
    choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
  });
  const { text, turn } = await collect(sseResponse([delta(PART), errorChunk, delta("không được hiện"), DONE]));
  assert.equal(text, PART);
  assert.deepEqual(turn.error, { code: "server_error", message: "Provider disconnected unexpectedly" });
  assert.equal(turn.finish, "error");
  assert.equal(turn.call, null);
});

test("lỗi dạng chuỗi hoặc chỉ có finish_reason error cũng bị bắt", async () => {
  const a = await collect(sseResponse([delta(PART), sseEvent({ error: "upstream timeout" }), DONE]));
  assert.deepEqual(a.turn.error, { code: "", message: "upstream timeout" });

  const b = await collect(sseResponse([delta(PART), finish("error"), DONE]));
  assert.equal(b.turn.error, null);
  assert.equal(b.turn.finish, "error");

  // Câu ngắn còn bị giữ lại (dưới 48 ký tự) thì bỏ luôn khi luồng lỗi.
  const c = await collect(sseResponse([delta("Câu ngắn."), finish("error"), DONE]));
  assert.equal(c.text, "");
});

test("finish_reason length được báo lên, chữ đã nhận giữ nguyên", async () => {
  const { text, turn } = await collect(sseResponse([delta(PART), delta("và phần cuối bị cắt"), finish("length"), DONE]));
  assert.equal(text, `${PART}và phần cuối bị cắt`);
  assert.equal(turn.finish, "length");
  assert.equal(turn.error, null);
  assert.equal(turn.cut, null);
});

test("một sự kiện bị cắt giữa hai lần đọc vẫn ghép lại đúng", async () => {
  const usage = sseEvent({
    choices: [],
    usage: { prompt_tokens: 1200, completion_tokens: 40, cost: 0.0001, prompt_tokens_details: { cached_tokens: 1000 } },
  });
  const whole = delta(PART) + delta("Câu thứ hai có dấu tiếng Việt: điều khoản.") + finish("stop") + usage + DONE;
  // Cắt giữa JSON, giữa "data:" và giữa cặp xuống dòng kết thúc sự kiện.
  const cuts = [7, 40, whole.indexOf("Câu thứ hai") + 5, whole.indexOf("finish_reason") + 3, whole.indexOf("usage") - 1];
  const pieces: string[] = [];
  let from = 0;
  for (const at of cuts) {
    pieces.push(whole.slice(from, at));
    from = at;
  }
  pieces.push(whole.slice(from));
  const seen: UsageStats[] = [];
  const { text, turn } = await collect(sseResponse(pieces), (u) => seen.push(u));
  assert.equal(text, `${PART}Câu thứ hai có dấu tiếng Việt: điều khoản.`);
  assert.equal(turn.finish, "stop");
  assert.deepEqual(seen, [{ promptTokens: 1200, cachedTokens: 1000, completionTokens: 40, cost: 0.0001 }]);
});

test("một ký tự nhiều byte bị cắt giữa hai lần đọc vẫn giải mã đúng", async () => {
  const bytes = new TextEncoder().encode(delta(`${PART}Điều 9 — quyền sử dụng đất.`) + finish("stop") + DONE);
  const at = bytes.indexOf(0xc4); // byte đầu của "Đ" (C4 90)
  assert.ok(at > 0);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, at + 1));
      controller.enqueue(bytes.slice(at + 1));
      controller.close();
    },
  });
  const { text } = await collect(new Response(body, { status: 200 }));
  assert.equal(text, `${PART}Điều 9 — quyền sử dụng đất.`);
});

test("lời gọi công cụ chia nhiều mảnh vẫn ghép đủ, finish_reason tool_calls", async () => {
  const call = (args: string, first = false) =>
    sseEvent({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              first
                ? { index: 0, id: "call_1", type: "function", function: { name: "tim_kiem_web", arguments: args } }
                : { index: 0, function: { arguments: args } },
            ],
          },
        },
      ],
    });
  const { text, turn } = await collect(
    sseResponse([call('{"que', true), call('ry":"luật đất đai 2024"}'), finish("tool_calls"), DONE]),
  );
  assert.equal(text, "");
  assert.deepEqual(turn.call, { id: "call_1", name: "tim_kiem_web", args: '{"query":"luật đất đai 2024"}' });
  assert.equal(turn.finish, "tool_calls");
  assert.equal(turn.error, null);
});
