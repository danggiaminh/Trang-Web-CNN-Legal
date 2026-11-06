import { CHAT_ALLOWED_ORIGINS, TAVILY_DAILY_CAP } from "astro:env/server";
import type { ChatMessage } from "./prompt";

export const MAX_QUESTION_CHARS = 2000;
const MAX_SLUG_CHARS = 200;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 4000;
const MAX_HISTORY_MESSAGE_CHARS = 1500;
const MIN_HISTORY_PIECE = 200;
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

function accepted(request: Request, origin: string): boolean {
  if (allowedOrigins.has(origin)) return true;
  try {
    const host = selfHost(request);
    return host !== null && new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

// POST chỉ nhận từ trang của chính site: Origin nằm trong danh sách hoặc cùng host. Trình duyệt
// luôn gửi Origin khi POST; thiếu Origin (proxy cắt bớt header) thì phải có Sec-Fetch-Site là
// same-origin. Không có cả hai thì gần như chắc chắn là script. Script vẫn tự đặt được các header
// này, nên đây chỉ là lớp lọc thô; chặn thật là các hạn mức bên dưới.
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return accepted(request, origin);
  return request.headers.get("sec-fetch-site") === "same-origin";
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

// Map đầy thì bỏ khoá đã nguội; vẫn đầy thì bỏ tiếp khoá cũ nhất theo thứ tự chèn cho tới khi
// trống một phần mười. Khoảng trống đó đẩy lần quét kế tiếp ra xa, nên dù hàng chục nghìn IP lạ
// ập tới trong vài giây thì Map vẫn không vượt trần và mỗi lần thêm khoá chỉ tốn O(1) bình quân.
function makeRoom<V>(map: Map<string, V>, max: number, stale: (value: V) => boolean): void {
  if (map.size < max) return;
  for (const [key, value] of map) {
    if (stale(value)) map.delete(key);
  }
  const target = max - Math.ceil(max / 10);
  for (const key of map.keys()) {
    if (map.size <= target) break;
    map.delete(key);
  }
}

export function withinRateLimit(ip: string, now = Date.now()): boolean {
  const bucket = buckets.get(ip);

  if (!bucket) {
    makeRoom(buckets, MAX_BUCKETS, (b) => (now - b.last) / 1000 > BURST / RATE_PER_SECOND);
    buckets.set(ip, { tokens: BURST - 1, last: now });
    return true;
  }

  bucket.tokens = Math.min(BURST, bucket.tokens + ((now - bucket.last) / 1000) * RATE_PER_SECOND);
  bucket.last = now;
  // Như noteWebSearch: delete rồi set lại đẩy khoá xuống cuối, nên khi Map đầy thì khoá bị bỏ là
  // IP lâu không gọi nhất, không phải IP đang dội liên tục (bị bỏ là nó có lại đủ lượt dồn).
  buckets.delete(ip);
  buckets.set(ip, bucket);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Số khoá bộ đếm chống dồn dập đang giữ (để test kiểm trần). */
export function rateLimitKeys(): number {
  return buckets.size;
}

// ---------------------------------------------------------------------------
// Hạn mức riêng của form liên hệ
//
// Mỗi lượt gửi là một thư thật vào hộp thư văn phòng và tốn quota MisarMail. Bộ đếm chống dồn
// dập ở trên vẫn cho 1 lượt/giây, tức hàng nghìn thư mỗi giờ từ một IP, nên form liên hệ có thêm
// trần theo IP: 3 thư mỗi 10 phút và 10 thư mỗi 24 giờ. Khách thật hiếm khi chạm tới; chạm rồi
// thì được báo gọi điện thay vì thử lại. Cũng chỉ nằm trong bộ nhớ từng instance như mọi hạn mức
// khác ở đây.
// ---------------------------------------------------------------------------

const CONTACT_DAY_MS = 24 * 60 * 60 * 1000;
const CONTACT_WINDOWS = [
  { ms: 10 * 60 * 1000, max: 3 },
  { ms: CONTACT_DAY_MS, max: 10 },
] as const;
const MAX_CONTACT_IPS = 5000;

const contactSends = new Map<string, number[]>();

/**
 * Xin một lượt gửi liên hệ cho IP này. Còn lượt thì ghi nhận luôn và trả 0; hết lượt thì trả số
 * giây phải chờ tới khi có lượt mới.
 */
export function contactSendWait(ip: string, now = Date.now()): number {
  const recent = (contactSends.get(ip) ?? []).filter((t) => now - t < CONTACT_DAY_MS);
  let waitMs = 0;
  for (const { ms, max } of CONTACT_WINDOWS) {
    const inWindow = recent.filter((t) => now - t < ms);
    if (inWindow.length >= max) waitMs = Math.max(waitMs, inWindow[inWindow.length - max]! + ms - now);
  }
  if (waitMs > 0) return Math.ceil(waitMs / 1000);

  // delete rồi set lại đẩy IP xuống cuối, nên khoá bị bỏ trước là IP lâu không gửi nhất.
  contactSends.delete(ip);
  makeRoom(contactSends, MAX_CONTACT_IPS, (times) => now - times.at(-1)! >= CONTACT_DAY_MS);
  contactSends.set(ip, [...recent, now]);
  return 0;
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

// Câu trả lời trước có thể dài tới 4.000 ký tự, bằng cả ngân sách. Bản cũ gặp
// tin nhắn vượt ngân sách là dừng hẳn, nên câu hỏi nối tiếp mất sạch ngữ cảnh
// hoặc chỉ còn một câu trả lời mồ côi. Giờ mỗi tin nhắn bị cắt đuôi ở
// MAX_HISTORY_MESSAGE_CHARS, nhờ vậy cặp hỏi–đáp gần nhất luôn vừa ngân sách,
// và lịch sử không bao giờ mở đầu bằng câu trả lời thiếu câu hỏi của nó.
export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  let used = 0;

  for (let i = raw.length - 1; i >= 0 && out.length < MAX_HISTORY_TURNS; i -= 1) {
    const turn = raw[i];
    const role = turn?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = typeof turn?.content === "string" ? turn.content.trim() : "";
    if (!content) continue;

    const room = Math.min(MAX_HISTORY_MESSAGE_CHARS, MAX_HISTORY_CHARS - used);
    if (room < MIN_HISTORY_PIECE && room < content.length) break;
    const kept = content.length <= room ? content : `${content.slice(0, room - 1).toWellFormed()}…`;
    used += kept.length;
    out.push({ role, content: kept });
  }

  if (out.at(-1)?.role === "assistant") out.pop();
  return out.reverse();
}
