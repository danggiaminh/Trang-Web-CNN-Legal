export const prerender = false;

import type { APIRoute } from "astro";
import {
  MAX_BODY_BYTES,
  MAX_QUESTION_CHARS,
  WEB_SEARCH_LIMIT,
  cleanFingerprint,
  cleanSlug,
  corsHeaders,
  isMeaninglessQuestion,
  noteGlobalSearch,
  noteWebSearch,
  originAllowed,
  sanitizeHistory,
  webSearchUsed,
  withinGlobalSearchCap,
  withinRateLimit,
} from "../../../server/guard";
import {
  MAX_ANSWER_CHARS,
  WEB_SEARCH_TOOL_NAME,
  callOpenRouter,
  hasApiKey,
  retryAfterMs,
  streamTurn,
  type CallOptions,
  type ToolCall,
  type TurnResult,
  type UsageStats,
} from "../../../server/openrouter";
import { buildMessages, toolResultMessages, type ChatMessage } from "../../../server/prompt";
import { selectContext } from "../../../server/retrieval";
import { MAX_QUERY_CHARS, hasTavilyKey, renderResults, searchWeb } from "../../../server/tavily";

const BUSY_MSG = "Xin lỗi hệ thống đang bận, vui lòng thử lại sau.";
const VO_NGHIA_MSG =
  "Mình chưa hiểu câu hỏi. Bạn thử hỏi rõ hơn về một vụ án hoặc bài viết trên trang nhé.";
const LIMIT_MSG =
  `Bạn đã dùng hết ${WEB_SEARCH_LIMIT}/${WEB_SEARCH_LIMIT} lượt tìm kiếm trên mạng, ` +
  "nên mình không tra cứu thêm trên Internet được nữa. Mình vẫn trả lời được dựa " +
  "trên nội dung bài viết trên trang — bạn thử hỏi lại theo hướng đó nhé.";
const NO_RESULT_NOTE =
  "Lần tra cứu này không ra kết quả nào (lượt tìm chưa bị trừ). Hãy nói ngắn gọn " +
  "với người dùng như vậy, rồi trả lời dựa trên TÀI LIỆU THAM KHẢO.";
const CAP_NOTE =
  "Chức năng tìm kiếm trên mạng đang tạm nghỉ vì cả trang đã chạm trần tra cứu " +
  "trong ngày (lượt tìm của người dùng chưa bị trừ). Hãy nói ngắn gọn như vậy, " +
  "rồi trả lời dựa trên TÀI LIỆU THAM KHẢO.";
const BAD_TOOL_NOTE =
  "Công cụ không tồn tại hoặc thiếu tham số. Hãy trả lời dựa trên TÀI LIỆU THAM KHẢO.";

const MAX_RETRIES = 5;
const RETRY_BUDGET_MS = 5000;

/**
 * t: chữ | r/m: đang thử lại | e: lỗi cuối | w: bắt đầu tìm trên mạng
 * s/n: đã tiêu 1 lượt tìm (đã dùng / tổng) — trình duyệt lấy số này làm chuẩn.
 * x: xoá sạch phần chữ đã hiện (model lỡ mở lời rồi mới quyết định tra mạng).
 */
type Payload =
  | { t: string }
  | { r: number; m: number }
  | { e: string }
  | { w: string }
  | { s: number; n: number }
  | { x: 1 };

interface Quota {
  readonly fp: string | null;
  readonly used: number;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
  "X-Robots-Tag": "noindex",
} as const;

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      ...extra,
    },
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function clientIp(request: Request, fallback: string | undefined): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  return fallback ?? request.headers.get("x-real-ip") ?? "unknown";
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

function logUsage(u: UsageStats): void {
  const pct = u.promptTokens ? Math.round((u.cachedTokens / u.promptTokens) * 100) : 0;
  console.log(
    `[api/v1/chat] token vào=${u.promptTokens} trúng cache=${u.cachedTokens} (${pct}%) ` +
      `ra=${u.completionTokens} chi phí=$${u.cost.toFixed(7)}`,
  );
}

/** Đọc luồng của một lượt, đổi token thành payload và trả về lời gọi công cụ (nếu có). */
async function* tokensOf(res: Response): AsyncGenerator<Payload, TurnResult, void> {
  const gen = streamTurn(res, MAX_ANSWER_CHARS, logUsage);
  try {
    for (;;) {
      const { value, done } = await gen.next();
      if (done) return value ?? EMPTY_TURN;
      yield { t: value };
    }
  } finally {
    // Người đọc đóng tab giữa chừng: đóng luôn kết nối tới OpenRouter.
    await gen.return(EMPTY_TURN).catch(() => {});
  }
}

const EMPTY_TURN: TurnResult = { call: null, preamble: "" };

interface TurnOutcome {
  readonly ok: boolean;
  readonly toolCall: ToolCall | null;
  readonly preamble: string;
}

const FAILED: TurnOutcome = { ok: false, toolCall: null, preamble: "" };

/** Một lượt gọi model, kèm nguyên vòng thử lại khi dính 429. */
async function* runTurn(
  messages: readonly ChatMessage[],
  opts: CallOptions,
  signal: AbortSignal,
): AsyncGenerator<Payload, TurnOutcome, void> {
  const deadline = Date.now() + RETRY_BUDGET_MS;
  let attempt = 0;

  for (;;) {
    if (signal.aborted) return FAILED;

    let res: Response;
    try {
      res = await callOpenRouter(messages, signal, opts);
    } catch (err) {
      if (signal.aborted) return FAILED;
      console.error("[api/v1/chat] gọi OpenRouter thất bại", err);
      yield { e: BUSY_MSG };
      return FAILED;
    }

    if (res.ok) {
      try {
        const turn = yield* tokensOf(res);
        return { ok: true, toolCall: turn.call, preamble: turn.preamble };
      } catch (err) {
        if (signal.aborted) return FAILED;
        console.error("[api/v1/chat] lỗi khi đọc luồng từ OpenRouter", err);
        yield { e: BUSY_MSG };
        return FAILED;
      }
    }

    if (res.status === 429) {
      attempt += 1;
      const wait = retryAfterMs(res, attempt);
      await discard(res);
      if (attempt <= MAX_RETRIES && Date.now() + wait <= deadline) {
        yield { r: attempt, m: MAX_RETRIES };
        await sleep(wait, signal);
        continue;
      }
      console.error(`[api/v1/chat] OpenRouter 429, dừng sau ${attempt} lần thử`);
      yield { e: BUSY_MSG };
      return FAILED;
    }

    console.error(`[api/v1/chat] OpenRouter trả lỗi HTTP ${res.status}`);
    await discard(res);
    yield { e: BUSY_MSG };
    return FAILED;
  }
}

function parseQuery(args: string): string {
  try {
    const query = (JSON.parse(args) as { query?: unknown })?.query;
    return typeof query === "string" ? query.trim().slice(0, MAX_QUERY_CHARS) : "";
  } catch {
    return "";
  }
}

async function* answer(
  question: string,
  slug: string | null,
  history: ReturnType<typeof sanitizeHistory>,
  quota: Quota,
  signal: AbortSignal,
): AsyncGenerator<Payload, void, void> {
  if (isMeaninglessQuestion(question)) {
    yield { m: 0, r: 0 };
    yield { t: VO_NGHIA_MSG };
    return;
  }

  if (!hasApiKey()) {
    console.error("[api/v1/chat] thiếu OPENROUTER_API_KEY — kiểm tra biến môi trường trên Vercel");
    yield { e: BUSY_MSG };
    return;
  }

  const webSearch = hasTavilyKey();
  const exhausted = quota.used >= WEB_SEARCH_LIMIT;

  let messages: ChatMessage[];
  try {
    const context = await selectContext(question, slug);
    messages = buildMessages(question, context.passages, context.currentTitle, history, {
      webSearch,
      quotaExhausted: exhausted,
    });
  } catch (err) {
    console.error("[api/v1/chat] dựng ngữ cảnh thất bại", err);
    yield { e: BUSY_MSG };
    return;
  }

  const first = yield* runTurn(
    messages,
    { withTools: webSearch, allowToolCall: webSearch },
    signal,
  );
  if (!first.ok || !first.toolCall) return;

  const call = first.toolCall;
  const query = call.name === WEB_SEARCH_TOOL_NAME ? parseQuery(call.args) : "";

  // Model đã trót nói "Tôi sẽ tìm kiếm…" trước khi gọi công cụ. Bản trước vứt
  // luôn lời gọi, để lại lời hứa suông; giờ bảo trình duyệt xoá câu đó đi rồi
  // tra tiếp như bình thường.
  if (first.preamble) {
    console.log(`[api/v1/chat] bỏ lời mở đầu ${first.preamble.length} ký tự trước khi gọi công cụ`);
    yield { x: 1 };
  }

  // Hết hạn mức mà model vẫn đòi tìm: từ chối tại chỗ, không gọi Tavily, cũng
  // không tốn thêm một lượt gọi model. Đây là chốt chặn chắc chắn, còn lời nhắc
  // trong prompt chỉ để model tự biết đường mà không đòi.
  if (query && exhausted) {
    console.log("[api/v1/chat] từ chối tìm kiếm: đã hết hạn mức");
    // Trình duyệt có thể đang tưởng mình còn lượt (vừa bị xoá storage) trong khi
    // sổ máy chủ nói hết. Đẩy con số thật về để nó hiện thông báo và các câu sau
    // khai đúng, thay vì lệch nhau mãi.
    yield { s: quota.used, n: WEB_SEARCH_LIMIT };
    yield { t: LIMIT_MSG };
    return;
  }

  let toolResult = BAD_TOOL_NOTE;

  if (query && !withinGlobalSearchCap()) {
    // Trần toàn site đã chạm: không gọi Tavily, cũng không trừ lượt của người
    // đọc — họ không có lỗi gì trong chuyện này.
    console.warn("[api/v1/chat] bỏ qua tìm kiếm: chạm trần Tavily trong ngày");
    toolResult = CAP_NOTE;
  } else if (query) {
    yield { w: query };
    const results = await searchWeb(query, signal);
    if (signal.aborted) return;

    if (results) {
      const used = quota.used + 1;
      noteWebSearch(quota.fp, used);
      noteGlobalSearch();
      // Chỉ trừ lượt khi đã cầm chắc kết quả trong tay.
      yield { s: used, n: WEB_SEARCH_LIMIT };
      toolResult = renderResults(query, results);
      console.log(`[api/v1/chat] tìm trên mạng "${query}" — ${results.length} kết quả, lượt ${used}/${WEB_SEARCH_LIMIT}`);
    } else {
      toolResult = NO_RESULT_NOTE;
    }
  } else {
    console.error(`[api/v1/chat] model gọi công cụ lạ hoặc thiếu tham số: ${call.name}`);
  }

  yield* runTurn(
    [...messages, ...toolResultMessages(call, toolResult, first.preamble)],
    { withTools: webSearch, allowToolCall: false },
    signal,
  );
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const cors = corsHeaders(request);

  if (!originAllowed(request)) {
    return json(403, { error: "Origin không được phép." });
  }

  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json(413, { error: "Yêu cầu quá lớn." }, cors);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json(413, { error: "Yêu cầu quá lớn." }, cors);
  }

  let body: {
    message?: unknown;
    slug?: unknown;
    history?: unknown;
    fp?: unknown;
    used?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Thân yêu cầu không phải JSON hợp lệ." }, cors);
  }

  const question = typeof body.message === "string" ? body.message.trim() : "";
  if (!question) {
    return json(400, { error: "Câu hỏi trống." }, cors);
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return json(400, { error: "Câu hỏi quá dài." }, cors);
  }

  if (!withinRateLimit(clientIp(request, clientAddress))) {
    return json(429, { error: BUSY_MSG }, { ...cors, "Retry-After": "2" });
  }

  const fp = cleanFingerprint(body.fp);
  const gen = answer(
    question,
    cleanSlug(body.slug),
    sanitizeHistory(body.history),
    { fp, used: webSearchUsed(fp, body.used) },
    request.signal,
  );
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
    },
    async cancel() {
      await gen.return().catch(() => {});
    },
  });

  return new Response(stream, { headers: { ...SSE_HEADERS, ...cors } });
};

export const OPTIONS: APIRoute = ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request) });

export const GET: APIRoute = () =>
  json(405, {
    error: "Endpoint này chỉ nhận POST.",
    usage: {
      method: "POST",
      path: "/api/v1/chat",
      body: {
        message: "string",
        slug: "string | null",
        history: "{role, content}[]",
        fp: "string | null (dấu vân tay trình duyệt, hex)",
        used: `number (số lượt tìm trên mạng đã dùng, tối đa ${WEB_SEARCH_LIMIT})`,
      },
      response: "text/event-stream",
    },
  });
