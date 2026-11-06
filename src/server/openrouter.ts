import {
  OPENROUTER_API_KEY,
  OPENROUTER_MAX_TOKENS,
  OPENROUTER_MODEL,
  OPENROUTER_PROVIDER,
  OPENROUTER_REFERER,
  OPENROUTER_TITLE,
} from "astro:env/server";
import type { ChatMessage } from "./prompt";

const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

const TEMPERATURE = 0.2;
const TOP_P = 0.9;
const FREQUENCY_PENALTY = 0.4;
const PRESENCE_PENALTY = 0.2;

export const MAX_ANSWER_CHARS = 4000;

export function hasApiKey(): boolean {
  return Boolean(OPENROUTER_API_KEY?.trim());
}

export const WEB_SEARCH_TOOL_NAME = "tim_kiem_web";

export const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      "Tìm thông tin trên Internet. CHỈ dùng khi câu hỏi cần dữ kiện mới hoặc bên " +
      "ngoài mà TÀI LIỆU THAM KHẢO không có (tin tức, văn bản pháp luật mới ban " +
      "hành, số liệu cập nhật). Người dùng chỉ có 3 lượt tìm cho cả phiên nên " +
      "đừng gọi khi câu trả lời đã nằm sẵn trong tài liệu.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Câu truy vấn ngắn gọn, viết bằng tiếng Việt.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
} as const;

export interface CallOptions {
  /** Gửi kèm định nghĩa công cụ. Giữ nguyên ở mọi lượt để tiền tố prompt không đổi. */
  readonly withTools: boolean;
  /** Cho phép model gọi công cụ ở lượt này. Lượt sau khi đã tìm thì phải tắt, kẻo lặp vô tận. */
  readonly allowToolCall: boolean;
}

export function callOpenRouter(
  messages: readonly ChatMessage[],
  signal: AbortSignal,
  opts: CallOptions = { withTools: false, allowToolCall: false },
): Promise<Response> {
  const provider = OPENROUTER_PROVIDER.trim();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${OPENROUTER_API_KEY?.trim() ?? ""}`,
    "Content-Type": "application/json",
  };
  if (OPENROUTER_REFERER.trim()) headers["HTTP-Referer"] = OPENROUTER_REFERER.trim();
  if (OPENROUTER_TITLE.trim()) headers["X-Title"] = OPENROUTER_TITLE.trim();

  return fetch(BASE_URL, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      // Ưu tiên nhà cung cấp đã đo là giữ cache tốt nhất, nhưng vẫn cho phép
      // chuyển sang nhà khác khi họ lỗi: câu trả lời không cache còn hơn không
      // có câu trả lời. Ghim cứng một nhà là cả trợ lý chết theo họ.
      // require_parameters chỉ bật khi có công cụ: fallback mà rơi vào nhà không
      // hỗ trợ tools thì họ lặng lẽ bỏ qua, trợ lý mất hẳn khả năng tìm kiếm.
      ...(provider
        ? {
            provider: {
              order: [provider],
              allow_fallbacks: true,
              ...(opts.withTools ? { require_parameters: true } : {}),
            },
          }
        : {}),
      stream: true,
      // Để OpenRouter trả về thống kê token, nhờ đó đo được tỉ lệ trúng cache.
      usage: { include: true },
      reasoning: { enabled: false },
      max_tokens: OPENROUTER_MAX_TOKENS,
      temperature: TEMPERATURE,
      top_p: TOP_P,
      frequency_penalty: FREQUENCY_PENALTY,
      presence_penalty: PRESENCE_PENALTY,
      ...(opts.withTools
        ? { tools: [WEB_SEARCH_TOOL], tool_choice: opts.allowToolCall ? "auto" : "none" }
        : {}),
      messages,
    }),
  });
}

export function retryAfterMs(res: Response, attempt: number): number {
  const raw = res.headers.get("retry-after");
  const secs = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(secs) ? Math.min(secs, 3) * 1000 : 400 + attempt * 200;
}

// Model rơi vào vòng lặp (một chữ, một cụm ngắn lặp mãi) thì cắt luồng cho khỏi tốn token. Chỉ
// coi là lặp khi phần đuôi lặp đúng một đơn vị suốt từ JUNK_SPAN_CHARS ký tự trở lên, và đơn vị đó
// không phải toàn dấu câu, khoảng trắng, ký hiệu kẻ dòng. Bản cũ cắt khi một đơn vị lặp 12 lần, nên
// dòng kẻ bảng ("|------------|") hay dòng chấm chừa chỗ điền ("……………") là đủ làm câu trả lời
// đứt ngang mà không báo gì; những dòng như vậy giờ dài mấy cũng không bị coi là rác.
const JUNK_SPAN_CHARS = 200;
const JUNK_MAX_UNIT = 24;
const JUNK_TAIL_CHARS = JUNK_SPAN_CHARS + JUNK_MAX_UNIT;
const FILLER_UNIT = /^[\p{P}\p{Z}\p{Sm}\p{Sk}\s]+$/u;

export function isJunkRepetition(tail: string): boolean {
  const n = tail.length;
  if (n < JUNK_SPAN_CHARS) return false;
  for (let len = 1; len <= JUNK_MAX_UNIT; len += 1) {
    // Độ dài phần đuôi lặp đúng chu kỳ len (đơn vị đầu tiên có thể chỉ lặp dở).
    let run = len;
    while (run < n && tail.charCodeAt(n - 1 - run) === tail.charCodeAt(n - 1 - run + len)) run += 1;
    if (run >= JUNK_SPAN_CHARS && !FILLER_UNIT.test(tail.slice(n - len))) return true;
  }
  return false;
}

const DONE = Symbol("done");

export interface UsageStats {
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly completionTokens: number;
  readonly cost: number;
}

function parseUsage(raw: unknown): UsageStats | null {
  if (typeof raw !== "object" || raw === null) return null;
  const u = raw as Record<string, unknown>;
  const promptTokens = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
  if (!promptTokens) return null;
  const details = u.prompt_tokens_details as { cached_tokens?: unknown } | undefined;
  return {
    promptTokens,
    cachedTokens: typeof details?.cached_tokens === "number" ? details.cached_tokens : 0,
    completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
    cost: typeof u.cost === "number" ? u.cost : 0,
  };
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: string;
}

interface CallFragment {
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly args?: string;
}

/** Khung lỗi OpenRouter gửi giữa luồng, khi đã lỡ trả HTTP 200. */
export interface StreamError {
  readonly code: string;
  readonly message: string;
}

interface Chunk {
  readonly content: string;
  readonly calls: readonly CallFragment[];
  /** finish_reason ("stop", "length", "tool_calls", "error"…); null khi lượt chưa xong. */
  readonly finish: string | null;
  readonly error: StreamError | null;
  readonly usage: UsageStats | null;
}

function parseCallFragments(raw: unknown): CallFragment[] {
  if (!Array.isArray(raw)) return [];
  const out: CallFragment[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const fn = (c.function ?? {}) as Record<string, unknown>;
    out.push({
      index: typeof c.index === "number" ? c.index : 0,
      id: typeof c.id === "string" ? c.id : undefined,
      name: typeof fn.name === "string" ? fn.name : undefined,
      args: typeof fn.arguments === "string" ? fn.arguments : undefined,
    });
  }
  return out;
}

function parseError(raw: unknown): StreamError | null {
  if (typeof raw === "string") return { code: "", message: raw };
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  return {
    code: typeof e.code === "string" || typeof e.code === "number" ? String(e.code) : "",
    message: typeof e.message === "string" ? e.message : "",
  };
}

// Mỗi khung có thể mang chữ, mảnh lời gọi công cụ, finish_reason, lỗi giữa luồng hoặc gói usage
// (gói này đi ở một khung riêng gần cuối luồng). Bản trước chỉ đọc delta và usage, nên lỗi giữa
// luồng hay finish_reason "length" trôi qua im lặng, câu trả lời dở trông như đã xong.
function parseSseLine(line: string): Chunk | typeof DONE | null {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data) return null;
  if (data === "[DONE]") return DONE;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const choice = (Array.isArray(obj.choices) ? obj.choices[0] : null) as Record<string, unknown> | null;
  const delta = (choice?.delta ?? null) as Record<string, unknown> | null;
  return {
    content: typeof delta?.content === "string" ? delta.content : "",
    calls: parseCallFragments(delta?.tool_calls),
    finish: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    error: parseError(obj.error),
    usage: parseUsage(obj.usage),
  };
}

// Model hay mở lời trước khi gọi công cụ ("Tôi sẽ tìm kiếm…"). Giữ lại vài chục
// ký tự đầu để những lời mở đầu ngắn bị nuốt gọn, người đọc không thấy chớp.
// Dài hơn mốc này thì chữ đã bay ra màn hình rồi — lúc đó KHÔNG vứt lời gọi công
// cụ đi (bản trước làm vậy và để lại lời hứa suông), mà vẫn tra rồi báo cho phía
// client xoá phần đã hiện.
const TOOL_HOLD_BACK_CHARS = 48;

export interface TurnResult {
  readonly call: ToolCall | null;
  /** Lời mở đầu đã trót phát ra màn hình trước khi model gọi công cụ. */
  readonly preamble: string;
  /** finish_reason cuối cùng nhà cung cấp báo; null khi luồng tắt mà không báo hoặc mình tự cắt. */
  readonly finish: string | null;
  readonly error: StreamError | null;
  /** Mình tự cắt luồng: quá maxChars, hoặc model lặp chữ. */
  readonly cut: "max_chars" | "junk" | null;
}

const NOTHING: TurnResult = { call: null, preamble: "", finish: null, error: null, cut: null };

/**
 * Vừa phát chữ ra ngoài, vừa dò lời gọi công cụ. Luôn trả về lời gọi công cụ nếu
 * model có gọi, kèm phần chữ đã trót phát ra để người gọi biết mà thu dọn.
 */
export async function* streamTurn(
  res: Response,
  maxChars: number,
  onUsage?: (usage: UsageStats) => void,
): AsyncGenerator<string, TurnResult, void> {
  if (!res.body) return NOTHING;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let produced = "";
  let held = "";
  let flushed = false;
  let finish: string | null = null;
  let error: StreamError | null = null;
  let cut: TurnResult["cut"] = null;

  const calls = new Map<number, { id: string; name: string; args: string }>();
  const merge = (frag: CallFragment) => {
    const cur = calls.get(frag.index) ?? { id: "", name: "", args: "" };
    calls.set(frag.index, {
      id: frag.id ?? cur.id,
      name: frag.name ?? cur.name,
      args: cur.args + (frag.args ?? ""),
    });
  };

  try {
    outer: for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);

        const parsed = parseSseLine(line);
        if (parsed === DONE) break outer;
        if (parsed === null) continue;
        if (parsed.usage && onUsage) onUsage(parsed.usage);
        if (parsed.finish) finish = parsed.finish;
        // Lỗi giữa luồng: phần còn lại (nếu có) không đáng tin, dừng đọc để người gọi báo lỗi.
        if (parsed.error || parsed.finish === "error") {
          error = parsed.error;
          break outer;
        }

        if (parsed.calls.length) {
          for (const frag of parsed.calls) merge(frag);
          if (!flushed) held = "";
        }

        if (!parsed.content) continue;
        // Đã nghiêng về nhánh gọi công cụ thì chữ kèm theo chỉ là rác, bỏ đi.
        if (!flushed && calls.size) continue;

        if (!flushed) {
          held += parsed.content;
          if (held.length < TOOL_HOLD_BACK_CHARS) continue;
          flushed = true;
          produced += held;
          yield held;
          held = "";
        } else {
          produced += parsed.content;
          yield parsed.content;
        }

        if (produced.length >= maxChars) {
          cut = "max_chars";
          break outer;
        }
        if (produced.length >= JUNK_SPAN_CHARS && isJunkRepetition(produced.slice(-JUNK_TAIL_CHARS))) {
          cut = "junk";
          break outer;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const end = { finish, error, cut };
  for (const [index, call] of calls) {
    if (!call.name) continue;
    return {
      call: { id: call.id || `call_${index}`, name: call.name, args: call.args },
      preamble: produced,
      ...end,
    };
  }
  if (held && !error && finish !== "error") yield held;
  return { ...NOTHING, ...end };
}
