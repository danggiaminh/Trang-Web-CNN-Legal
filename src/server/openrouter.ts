/**
 * Gọi OpenRouter và giải mã luồng trả về.
 * Bản chuyển từ `rag-backend/src/openrouter.rs`, giữ nguyên các chốt chặn tốn tiền.
 */
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

// Những số này là quyết định đã chốt bên rag-backend/src/config.rs chứ không
// phải cấu hình triển khai, nên để thẳng ở đây thay vì mở thêm biến môi trường.
// `temperature` thấp cùng hai hình phạt lặp là thứ chặn model rơi vào vòng lặp
// lặp chữ và đốt sạch max_tokens cho một câu trả lời rác.
const TEMPERATURE = 0.2;
const TOP_P = 0.9;
const FREQUENCY_PENALTY = 0.4;
const PRESENCE_PENALTY = 0.2;

/** Chốt cứng: vượt số ký tự này thì ngắt luồng, không chờ model tự dừng. */
export const MAX_ANSWER_CHARS = 4000;

export function hasApiKey(): boolean {
  return Boolean(OPENROUTER_API_KEY?.trim());
}

export function callOpenRouter(
  messages: readonly ChatMessage[],
  signal: AbortSignal,
): Promise<Response> {
  const provider = OPENROUTER_PROVIDER.trim();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${OPENROUTER_API_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
  // OpenRouter dùng hai header này để ghi nhận nguồn gọi trên bảng thống kê.
  if (OPENROUTER_REFERER.trim()) headers["HTTP-Referer"] = OPENROUTER_REFERER.trim();
  if (OPENROUTER_TITLE.trim()) headers["X-Title"] = OPENROUTER_TITLE.trim();

  return fetch(BASE_URL, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      // Ghim nhà cung cấp và tắt dự phòng để giá mỗi token không đổi sau lưng.
      // Bỏ trống biến thì để OpenRouter tự chọn.
      ...(provider ? { provider: { order: [provider], allow_fallbacks: false } } : {}),
      stream: true,
      reasoning: { enabled: false },
      max_tokens: OPENROUTER_MAX_TOKENS,
      temperature: TEMPERATURE,
      top_p: TOP_P,
      frequency_penalty: FREQUENCY_PENALTY,
      presence_penalty: PRESENCE_PENALTY,
      messages,
    }),
  });
}

/** Trùng `retry_after_ms`: tôn trọng header nhưng chặn trên 3 giây. */
export function retryAfterMs(res: Response, attempt: number): number {
  const raw = res.headers.get("retry-after");
  const secs = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(secs) ? Math.min(secs, 3) * 1000 : 400 + attempt * 200;
}

/**
 * Phát hiện model rơi vào vòng lặp lặp chữ ("d d d d…", "bbbb…").
 * Trùng `la_lap_vo_nghia` ở openrouter.rs.
 */
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

function parseSseLine(line: string): string | typeof DONE | null {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data) return null;
  if (data === "[DONE]") return DONE;
  try {
    const token = JSON.parse(data)?.choices?.[0]?.delta?.content;
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

/**
 * Bóc từng mẩu chữ ra khỏi luồng SSE của OpenRouter.
 *
 * `TextDecoder` ở chế độ stream tự giữ lại byte dở dang, nên ký tự tiếng Việt bị
 * cắt ngang giữa hai gói mạng vẫn ghép đúng.
 */
export async function* streamContent(
  res: Response,
  maxChars: number,
): AsyncGenerator<string, void, void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let produced = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);

        const parsed = parseSseLine(line);
        if (parsed === DONE) return;
        if (parsed === null) continue;

        produced += parsed;
        yield parsed;

        // Cắt sớm khi câu trả lời quá dài hoặc đã hỏng — mỗi token sau đó đều
        // là tiền bỏ đi.
        if (produced.length >= maxChars) return;
        if (produced.length >= 120 && isJunkRepetition(produced.slice(-160))) return;
      }
    }
  } finally {
    // Đóng kết nối tới OpenRouter khi thoát sớm, nếu không phần token còn lại
    // vẫn sinh ra và vẫn bị tính tiền.
    await reader.cancel().catch(() => {});
  }
}
