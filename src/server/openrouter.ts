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

export function isJunkRepetition(tail: string): boolean {
  const THRESHOLD = 12;
  const ch = [...tail];
  for (let len = 1; len <= 8; len += 1) {
    if (ch.length < len * THRESHOLD) continue;
    const pattern = ch.slice(ch.length - len).join("");
    let reps = 0;
    let i = ch.length;
    while (i >= len && ch.slice(i - len, i).join("") === pattern) {
      reps += 1;
      i -= len;
    }
    if (reps >= THRESHOLD) return true;
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

interface Delta {
  readonly content: string;
  readonly calls: readonly CallFragment[];
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

function parseSseLine(line: string): Delta | typeof DONE | null {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data) return null;
  if (data === "[DONE]") return DONE;
  try {
    const delta = JSON.parse(data)?.choices?.[0]?.delta;
    if (typeof delta !== "object" || delta === null) return null;
    const content = typeof delta.content === "string" ? delta.content : "";
    const calls = parseCallFragments(delta.tool_calls);
    return content || calls.length ? { content, calls } : null;
  } catch {
    return null;
  }
}

// Gói usage đi kèm ở một khung SSE riêng gần cuối luồng, tách khỏi các khung
// chứa nội dung, nên phải soi song song với việc đọc token.
function usageFromLine(line: string): UsageStats | null {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    return parseUsage(JSON.parse(data)?.usage);
  } catch {
    return null;
  }
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
}

const NOTHING: TurnResult = { call: null, preamble: "" };

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

        if (onUsage) {
          const usage = usageFromLine(line);
          if (usage) onUsage(usage);
        }

        const parsed = parseSseLine(line);
        if (parsed === DONE) break outer;
        if (parsed === null) continue;

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

        if (produced.length >= maxChars) break outer;
        if (produced.length >= 120 && isJunkRepetition(produced.slice(-160))) break outer;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  for (const [index, call] of calls) {
    if (!call.name) continue;
    return {
      call: { id: call.id || `call_${index}`, name: call.name, args: call.args },
      preamble: produced,
    };
  }
  if (held) yield held;
  return NOTHING;
}
