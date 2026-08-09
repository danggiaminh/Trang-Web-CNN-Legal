import { CHAT_ALLOWED_ORIGINS, TAVILY_DAILY_CAP } from "astro:env/server";
import type { ChatMessage } from "./prompt";

export const MAX_QUESTION_CHARS = 2000;
const MAX_SLUG_CHARS = 200;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 4000;
export const MAX_BODY_BYTES = 32 * 1024;

const allowedOrigins = new Set(
  CHAT_ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function selfHost(request: Request): string | null {
  const header = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (header) return header.split(",")[0]!.trim().toLowerCase();
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
}

function accepted(request: Request, origin: string | null): boolean {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    const host = selfHost(request);
    return host !== null && new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function originAllowed(request: Request): boolean {
  return accepted(request, request.headers.get("origin"));
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !accepted(request, origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

const RATE_PER_SECOND = 1;
const BURST = 6;
const MAX_BUCKETS = 5000;

const buckets = new Map<string, { tokens: number; last: number }>();

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

// ---------------------------------------------------------------------------
// Hạn mức tìm kiếm trên mạng
//
// Số lượt do trình duyệt giữ (localStorage + sessionStorage, khoá theo dấu vân
// tay trình duyệt) và gửi kèm mỗi câu hỏi. Sổ dưới đây là bản sao phía máy chủ,
// khoá theo ĐÚNG dấu vân tay đó — không đụng tới IP. Nó chỉ vá được trường hợp
// xoá storage: trên Vercel mỗi instance có sổ riêng và instance nguội thì mất
// sạch, y hệt bộ đếm chống dồn dập ở trên. Đây là hàng rào mềm, không phải
// khoá chống gian lận; ai cố ý sửa fingerprint vẫn qua được.
// ---------------------------------------------------------------------------

export const WEB_SEARCH_LIMIT = 3;

const FINGERPRINT_RE = /^[0-9a-f]{8,32}$/;
const USE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FINGERPRINTS = 5000;

const searchUse = new Map<string, { used: number; last: number }>();

export function cleanFingerprint(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const fp = raw.trim().toLowerCase();
  return FINGERPRINT_RE.test(fp) ? fp : null;
}

function claimedUses(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.trunc(n), 0), WEB_SEARCH_LIMIT);
}

/** Số lượt đã dùng: lấy con số lớn hơn giữa lời khai của trình duyệt và sổ máy chủ. */
export function webSearchUsed(fp: string | null, raw: unknown): number {
  const claimed = claimedUses(raw);
  if (!fp) return claimed;
  const rec = searchUse.get(fp);
  if (!rec || Date.now() - rec.last > USE_TTL_MS) return claimed;
  return Math.max(claimed, rec.used);
}

export function noteWebSearch(fp: string | null, used: number): void {
  if (!fp) return;
  const now = Date.now();

  // delete rồi set lại đẩy khoá xuống cuối, nhờ vậy thứ tự duyệt Map thành LRU
  // và dọn chỗ chỉ cần cắt từ đầu.
  searchUse.delete(fp);
  if (searchUse.size >= MAX_FINGERPRINTS) {
    for (const [key, rec] of searchUse) {
      if (now - rec.last > USE_TTL_MS) searchUse.delete(key);
    }
    while (searchUse.size >= MAX_FINGERPRINTS) {
      const oldest = searchUse.keys().next();
      if (oldest.done) break;
      searchUse.delete(oldest.value);
    }
  }
  searchUse.set(fp, { used: Math.min(used, WEB_SEARCH_LIMIT), last: now });
}

// ---------------------------------------------------------------------------
// Trần tiêu thụ Tavily cho TOÀN SITE
//
// Hạn mức 3 lượt ở trên khoá theo dấu vân tay do trình duyệt gửi lên, mà trường
// đó thì ai cũng bịa được: đổi `fp` mỗi lần gọi là có lại 3 lượt mới. Endpoint
// chat lại không có đăng nhập, và header Origin ngoài trình duyệt cũng giả được,
// nên không có cách nào phân biệt người đọc thật với script. Chốt chặn duy nhất
// có ý nghĩa là một trần tuyệt đối cho số lần gọi Tavily, không phụ thuộc vào
// bất cứ thứ gì client khai báo.
//
// Cũng như bộ đếm chống dồn dập, biến này nằm trong bộ nhớ từng instance Vercel:
// nhiều instance thì trần thực tế là cap × số instance. Nó thu hẹp thiệt hại
// chứ không chặn tuyệt đối — trần cứng phải đặt thêm ở trang quản trị Tavily.
// ---------------------------------------------------------------------------

const GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000;
let windowStart = Date.now();
let globalUsed = 0;

export function withinGlobalSearchCap(): boolean {
  const now = Date.now();
  if (now - windowStart > GLOBAL_WINDOW_MS) {
    windowStart = now;
    globalUsed = 0;
  }
  return globalUsed < TAVILY_DAILY_CAP;
}

export function noteGlobalSearch(): void {
  globalUsed += 1;
  if (globalUsed === TAVILY_DAILY_CAP) {
    console.warn(`[guard] đã chạm trần ${TAVILY_DAILY_CAP} lượt tìm kiếm Tavily trong 24 giờ`);
  }
}

export function isMeaninglessQuestion(question: string): boolean {
  const chars = [...question].filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (chars.length < 3) return true;
  const first = chars[0].toLowerCase();
  return chars.every((c) => c.toLowerCase() === first);
}

export function cleanSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw.trim();
  if (!slug || slug.length > MAX_SLUG_CHARS) return null;
  return /^[A-Za-z0-9_-]+$/.test(slug) ? slug : null;
}

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
