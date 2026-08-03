/**
 * Chốt chặn trước khi tiêu tiền.
 *
 * Endpoint này là POST công khai và mỗi lượt gọi đều trừ vào hạn mức OpenRouter,
 * nên phần lọc dưới đây không phải trang trí. Bản Rust chặn bằng `tower_governor`
 * (1 lượt/giây, dồn 6) cộng CORS allowlist; ở đây chuyển lại tương đương.
 */
import { CHAT_ALLOWED_ORIGINS } from "astro:env/server";
import type { ChatMessage } from "./prompt";

/** Trùng các trần trong rag-backend/src/routes.rs. */
export const MAX_QUESTION_CHARS = 2000;
const MAX_SLUG_CHARS = 200;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 4000;
/** Thân yêu cầu quá cỡ này thì từ chối trước khi phân tích JSON. */
export const MAX_BODY_BYTES = 32 * 1024;

const allowedOrigins = new Set(
  CHAT_ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Giống ngữ nghĩa CORS: chỉ chặn khi trình duyệt khai một Origin lạ. Thiếu
 * Origin (curl, gọi từ máy chủ) thì không chặn — chặn cũng vô nghĩa vì bên gọi
 * chỉ cần bỏ header đi. Hàng rào thật cho nhóm đó là giới hạn tần suất bên dưới.
 */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || allowedOrigins.has(origin);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

const RATE_PER_SECOND = 1;
const BURST = 6;
/** Chặn Map phình vô hạn khi bị quét: quá ngưỡng thì dọn các gáo đã đầy lại. */
const MAX_BUCKETS = 5000;

const buckets = new Map<string, { tokens: number; last: number }>();

/**
 * Gáo token cho mỗi IP. Đây là gờ giảm tốc, KHÔNG phải hàng rào an ninh — đã đo
 * và xác nhận hai lỗ hổng, cả hai đều không vá được từ bên trong function:
 *
 * 1. Định danh dựa trên header chuyển tiếp, mà bên gọi tự khai được. Thử bằng
 *    `curl -H "X-Forwarded-For: 9.9.$i.1"` mười lần thì cả mười đều lọt.
 * 2. Map nằm trong bộ nhớ của một instance; serverless chạy nhiều instance song
 *    song nên tải rải ra là mỗi instance thấy một phần.
 *
 * Nó chặn được trường hợp thường gặp: một người bấm liên tục, hoặc script ngây
 * thơ chạy vòng lặp. Muốn chặn cứng thì đặt luật ở Vercel Firewall → Rate
 * Limiting cho `/api/v1/chat`; chỗ đó nằm trước function và dùng IP thật.
 */
export function withinRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [key, b] of buckets) {
        if ((now - b.last) / 1000 > BURST / RATE_PER_SECOND) buckets.delete(key);
      }
    }
    buckets.set(ip, { tokens: BURST - 1, last: now });
    return true;
  }

  bucket.tokens = Math.min(BURST, bucket.tokens + ((now - bucket.last) / 1000) * RATE_PER_SECOND);
  bucket.last = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/**
 * Câu hỏi không mang thông tin nào thì đừng tiêu tiền vào nó — trùng
 * `cau_hoi_vo_nghia`. Một ký tự gõ nhầm ("d", "bbbb", "...") vẫn kích hoạt trọn
 * một lượt gọi model nếu không chặn ở đây.
 */
export function isMeaninglessQuestion(question: string): boolean {
  const chars = [...question].filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (chars.length < 3) return true;
  const first = chars[0].toLowerCase();
  return chars.every((c) => c.toLowerCase() === first);
}

/** Slug chỉ được là ký tự an toàn, đúng như bộ lọc ở routes.rs. */
export function cleanSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw.trim();
  if (!slug || slug.length > MAX_SLUG_CHARS) return null;
  return /^[A-Za-z0-9_-]+$/.test(slug) ? slug : null;
}

/**
 * Giữ các lượt gần nhất trong giới hạn, bỏ vai trò lạ — trùng `sanitize_history`.
 * Lọc `system` ở đây là để client không tự chèn chỉ thị vào chuỗi tin nhắn.
 */
export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  let used = 0;

  for (let i = raw.length - 1; i >= 0; i -= 1) {
    const turn = raw[i];
    const role = turn?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = typeof turn?.content === "string" ? turn.content.trim() : "";
    if (!content) continue;

    const cost = content.length;
    if (out.length >= MAX_HISTORY_TURNS || used + cost > MAX_HISTORY_CHARS) break;
    used += cost;
    out.push({ role, content });
  }

  return out.reverse();
}
