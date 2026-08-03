/**
 * POST /api/v1/chat — endpoint không giao diện, trả lời theo luồng SSE.
 *
 * `prerender = false` chỉ nằm ở file này và ở health.ts. Mọi trang giao diện vẫn
 * được dựng sẵn thành HTML tĩnh lúc build và phục vụ thẳng từ CDN, nên thêm
 * endpoint này không đụng gì tới chỉ số PageSpeed của chúng.
 *
 * Khoá OpenRouter chỉ tồn tại ở phía máy chủ; trình duyệt không bao giờ thấy nó.
 *
 * Định dạng mỗi dòng giữ nguyên như backend Rust để AskBox.astro không phải đổi
 * cách đọc:
 *   data: {"t":"..."}            mẩu chữ trả lời
 *   data: {"r":1,"m":5}          đang thử lại lần r trên m
 *   data: {"e":"..."}            lỗi cuối cùng, hiển thị nguyên văn
 */
export const prerender = false;

import type { APIRoute } from "astro";
import {
  MAX_BODY_BYTES,
  MAX_QUESTION_CHARS,
  cleanSlug,
  corsHeaders,
  isMeaninglessQuestion,
  originAllowed,
  sanitizeHistory,
  withinRateLimit,
} from "../../../server/guard";
import {
  MAX_ANSWER_CHARS,
  callOpenRouter,
  hasApiKey,
  retryAfterMs,
  streamContent,
} from "../../../server/openrouter";
import { buildMessages } from "../../../server/prompt";
import { selectContext } from "../../../server/retrieval";

/** Trùng các thông báo trong rag-backend/src/routes.rs. */
const BUSY_MSG = "Xin lỗi hệ thống đang bận, vui lòng thử lại sau.";
const VO_NGHIA_MSG =
  "Mình chưa hiểu câu hỏi. Bạn thử hỏi rõ hơn về một vụ án hoặc bài viết trên trang nhé.";

const MAX_RETRIES = 5;
/**
 * Trần thời gian thực cho toàn bộ các lần thử lại.
 *
 * Bản Rust thử tới 5 lần, mỗi lần chờ tối đa 3 giây — cộng lại có thể ngủ 15
 * giây trước khi chữ đầu tiên kịp ra. Đó là tiến trình chạy dài nên không sao,
 * còn serverless thì bị cắt theo `maxDuration` và người dùng mất trắng câu trả
 * lời. Ở đây vẫn thử lại, nhưng hết ngân sách này là dừng.
 */
const RETRY_BUDGET_MS = 5000;

type Payload = { t: string } | { r: number; m: number } | { e: string };

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  // Dặn mọi lớp proxy đứng giữa đừng gom cả luồng rồi mới trả — gom là mất hiệu
  // ứng chữ chạy dần.
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

/**
 * Khoá định danh cho gáo token.
 *
 * Đọc `x-vercel-forwarded-for` trước vì header thuộc miền `x-vercel-*` do chính
 * nền tảng đặt và ghi đè, còn `x-forwarded-for` — thứ mà `clientAddress` của
 * adapter cũng lấy ra — thì bên gọi tự khai được. Dù vậy, MỌI cách xác định IP
 * từ trong function đều chỉ đáng tin bằng lớp proxy đứng trước: xem ghi chú ở
 * `withinRateLimit` và mục "Chặn đốt hạn mức" trong README.
 */
function clientIp(request: Request, fallback: string | undefined): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  return fallback ?? request.headers.get("x-real-ip") ?? "unknown";
}

/** Bỏ nốt phần thân chưa đọc để trả kết nối về pool thay vì treo tới lúc hết giờ. */
async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

async function* answer(
  question: string,
  slug: string | null,
  history: ReturnType<typeof sanitizeHistory>,
  signal: AbortSignal,
): AsyncGenerator<Payload, void, void> {
  // Chặn TRƯỚC khi dựng ngữ cảnh và gọi model.
  if (isMeaninglessQuestion(question)) {
    yield { m: 0, r: 0 };
    yield { t: VO_NGHIA_MSG };
    return;
  }

  // Thiếu khoá thì trả lời như lúc quá tải, tuyệt đối không để lộ nguyên nhân
  // kỹ thuật ra ngoài. Dấu vết chẩn đoán nằm ở log và ở /api/v1/health.
  if (!hasApiKey()) {
    console.error("[api/v1/chat] thiếu OPENROUTER_API_KEY — kiểm tra biến môi trường trên Vercel");
    yield { e: BUSY_MSG };
    return;
  }

  let messages;
  try {
    const context = await selectContext(question, slug);
    messages = buildMessages(question, context.passages, context.currentTitle, history);
  } catch (err) {
    console.error("[api/v1/chat] dựng ngữ cảnh thất bại", err);
    yield { e: BUSY_MSG };
    return;
  }

  const deadline = Date.now() + RETRY_BUDGET_MS;
  let attempt = 0;

  for (;;) {
    if (signal.aborted) return;

    let res: Response;
    try {
      res = await callOpenRouter(messages, signal);
    } catch (err) {
      if (signal.aborted) return;
      console.error("[api/v1/chat] gọi OpenRouter thất bại", err);
      yield { e: BUSY_MSG };
      return;
    }

    if (res.ok) {
      try {
        for await (const token of streamContent(res, MAX_ANSWER_CHARS)) yield { t: token };
      } catch (err) {
        if (signal.aborted) return;
        console.error("[api/v1/chat] lỗi khi đọc luồng từ OpenRouter", err);
        yield { e: BUSY_MSG };
      }
      return;
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
      return;
    }

    console.error(`[api/v1/chat] OpenRouter trả lỗi HTTP ${res.status}`);
    await discard(res);
    yield { e: BUSY_MSG };
    return;
  }
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

  let body: { message?: unknown; slug?: unknown; history?: unknown };
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

  const gen = answer(question, cleanSlug(body.slug), sanitizeHistory(body.history), request.signal);
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
    // Người dùng đóng tab hoặc AskBox huỷ lượt cũ: `return()` chạy khối `finally`
    // trong streamContent, đóng kết nối OpenRouter và ngừng tính tiền phần còn lại.
    async cancel() {
      await gen.return().catch(() => {});
    },
  });

  return new Response(stream, { headers: { ...SSE_HEADERS, ...cors } });
};

export const OPTIONS: APIRoute = ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request) });

/** Mở bằng trình duyệt thì chỉ dẫn cách dùng, không trả trang trắng khó hiểu. */
export const GET: APIRoute = () =>
  json(405, {
    error: "Endpoint này chỉ nhận POST.",
    usage: {
      method: "POST",
      path: "/api/v1/chat",
      body: { message: "string", slug: "string | null", history: "{role, content}[]" },
      response: "text/event-stream",
    },
  });
