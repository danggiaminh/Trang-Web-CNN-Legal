/**
 * Hạn mức tìm kiếm trên mạng của trợ lý bài viết, giữ ở phía trình duyệt.
 *
 * Ba lớp cùng giữ một con số, không lớp nào đụng tới IP:
 *  - localStorage: sống qua việc đóng trình duyệt.
 *  - sessionStorage: còn nguyên khi người dùng xoá riêng localStorage trong tab đang mở.
 *  - dấu vân tay trình duyệt: khoá lưu trữ, đồng thời là danh tính gửi lên máy
 *    chủ để bên đó giữ một bản sao — xoá sạch storage cũng không về lại 3 lượt
 *    khi máy chủ còn nhớ dấu vân tay đó.
 *
 * Đây là hàng rào mềm. Người cố tình vẫn vượt được (đổi trình duyệt, sửa
 * fingerprint), nhưng nó chặn được việc vô tình hay tiện tay F5 để xin thêm lượt.
 */

const PREFIX = "cnn.ws";
export const DEFAULT_LIMIT = 3;

export interface Quota {
  readonly used: number;
  readonly limit: number;
  readonly dismissed: boolean;
}

const EMPTY: Quota = { used: 0, limit: DEFAULT_LIMIT, dismissed: false };

function fnv1a(input: string, seed: number): string {
  let h = seed;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // h * 16777619 viết bằng phép dịch để không rơi khỏi số nguyên 32 bit.
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

let cachedFp = "";

/**
 * Cố tình KHÔNG dùng canvas/WebGL: Safari và Brave bịa số ngẫu nhiên cho hai thứ
 * đó, dấu vân tay sẽ trôi sau mỗi lần tải trang và hạn mức âm thầm reset. Ở đây
 * cần chữ ký ổn định hơn là cần nhiều entropy.
 */
export function fingerprint(): string {
  if (cachedFp) return cachedFp;

  const nav = navigator as Navigator & { deviceMemory?: number };
  const parts = [
    nav.userAgent,
    nav.language,
    (nav.languages ?? []).join(","),
    String(nav.hardwareConcurrency ?? 0),
    String(nav.deviceMemory ?? 0),
    String(nav.maxTouchPoints ?? 0),
    String(screen.colorDepth),
    // Xoay điện thoại thì width/height đổi chỗ cho nhau — sắp xếp lại để không
    // sinh ra một danh tính mới chỉ vì người dùng nằm nghiêng đọc báo.
    `${Math.min(screen.width, screen.height)}x${Math.max(screen.width, screen.height)}`,
    // Làm tròn để phóng to trang ở mức thường gặp (110%, 125%) không đổi dấu vân tay.
    String(Math.round(window.devicePixelRatio || 1)),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    String(new Date().getTimezoneOffset()),
  ].join("|");

  cachedFp = fnv1a(parts, 0x811c9dc5) + fnv1a(parts, 0x01000193);
  return cachedFp;
}

function stores(): Storage[] {
  const out: Storage[] = [];
  // Chế độ riêng tư của vài trình duyệt ném lỗi ngay khi chạm vào storage.
  try {
    out.push(window.localStorage);
  } catch {
    /* bỏ qua */
  }
  try {
    out.push(window.sessionStorage);
  } catch {
    /* bỏ qua */
  }
  return out;
}

function parse(raw: string | null): Quota | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { u?: unknown; n?: unknown; d?: unknown };
    const used = typeof v.u === "number" && Number.isFinite(v.u) ? Math.max(0, Math.trunc(v.u)) : 0;
    const limit = typeof v.n === "number" && Number.isFinite(v.n) ? Math.trunc(v.n) : DEFAULT_LIMIT;
    return { used, limit: limit > 0 ? limit : DEFAULT_LIMIT, dismissed: v.d === 1 };
  } catch {
    return null;
  }
}

/**
 * Gộp mọi bản ghi tìm thấy ở cả hai kho: lấy số lượt CAO nhất. Nhờ vậy xoá một
 * kho, hay dấu vân tay trôi vì đổi phiên bản trình duyệt, đều không cấp lại lượt.
 */
export function readQuota(): Quota {
  let used = 0;
  let limit = DEFAULT_LIMIT;
  let dismissed = false;

  for (const store of stores()) {
    let keys: string[] = [];
    try {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key && key.startsWith(PREFIX)) keys.push(key);
      }
    } catch {
      keys = [];
    }
    for (const key of keys) {
      let found: Quota | null = null;
      try {
        found = parse(store.getItem(key));
      } catch {
        found = null;
      }
      if (!found) continue;
      if (found.used > used) used = found.used;
      if (found.limit > limit) limit = found.limit;
      dismissed = dismissed || found.dismissed;
    }
  }

  return used || dismissed ? { used, limit, dismissed } : EMPTY;
}

export function saveQuota(quota: Quota): void {
  const raw = JSON.stringify({ u: quota.used, n: quota.limit, d: quota.dismissed ? 1 : 0 });
  // Ghi cả khoá theo dấu vân tay lẫn khoá chung: khoá chung là lưới đỡ khi dấu
  // vân tay đổi, khoá theo dấu vân tay khớp với sổ bên máy chủ.
  for (const store of stores()) {
    for (const key of [`${PREFIX}.${fingerprint()}`, PREFIX]) {
      try {
        store.setItem(key, raw);
      } catch {
        /* hết chỗ hoặc bị chặn — bỏ qua, phía máy chủ vẫn còn bản sao */
      }
    }
  }
}
