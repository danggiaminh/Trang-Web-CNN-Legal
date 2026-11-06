// Gửi form liên hệ vào Contact API (Cloudflare Worker + D1) thay cho /api/v1/contact.
// Chỉ có mặt trong bản build đặt PUBLIC_CONTACT_API_URL và PUBLIC_TURNSTILE_SITE_KEY: không đặt thì Vite
// bỏ hẳn nhánh nạp module này và trang liên hệ giữ nguyên từng byte.
// submit() trả về Response cùng khuôn với /api/v1/contact ({ error: string } khi lỗi) để phần hiển thị kết
// quả trong lien-he.astro (thông báo, số điện thoại, thư soạn sẵn) dùng chung cho cả hai đường gửi.

const ENDPOINT = `${String(import.meta.env.PUBLIC_CONTACT_API_URL).replace(/\/+$/, "")}/v1/contact-requests`;
const SITE_KEY = String(import.meta.env.PUBLIC_TURNSTILE_SITE_KEY);
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=cnnTurnstileReady";
// Phải trùng TURNSTILE_ACTION của Worker.
const TURNSTILE_ACTION = "contact_form";
const TOKEN_WAIT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;

// Nhãn ô Lĩnh vực → khoá service_categories (workers/contact-api/migrations/0002_reference_data.sql).
const CATEGORY_KEYS: Record<string, string> = {
  "Hình sự": "criminal",
  "Dân sự - Kinh doanh": "civil_business",
  "Hành chính": "administrative",
  "Nghiên cứu và phản biện": "research",
  "Ứng tuyển vào CNN Legal": "recruitment",
};

interface TurnstileApi {
  // Tên tham số tránh các từ trùng tiện ích Tailwind (vd. container): src/ được quét và CSS nằm inline ở mọi trang.
  render(element: HTMLElement, options: Record<string, unknown>): string | undefined;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    cnnTurnstileReady?: () => void;
  }
}

export interface ContactFields {
  name: string;
  phone: string;
  email: string;
  field: string;
  subject: string;
  message: string;
  cf_hp: string;
}

interface ApiReply {
  reference?: unknown;
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

let widget: Promise<string> | null = null;
let token = "";
let interactive = false;
let unsupported = false;
let waiters: Array<(value: string) => void> = [];
// Gửi lại cùng nội dung (mạng rớt, 503) thì giữ nguyên Idempotency-Key để Worker không ghi trùng;
// nội dung đổi thì sinh khoá mới (Worker trả 409 nếu một khoá đi với hai nội dung khác nhau).
let pending: { key: string; fingerprint: string } | null = null;

function deliver(value: string): void {
  token = value;
  const ready = waiters;
  waiters = [];
  for (const resolve of ready) resolve(value);
}

function loadTurnstile(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    window.cnnTurnstileReady = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onerror = () => reject(new Error("turnstile"));
    document.head.append(script);
  });
}

// Tải và dựng Turnstile một lần, ngay khi khách bắt đầu điền form, để token có sẵn trước lúc bấm Gửi.
// Chế độ interaction-only: ô xác minh chỉ hiện ra khi Cloudflare cần khách bấm xác nhận.
export function prepare(): Promise<string> {
  if (widget) return widget;
  const current = loadTurnstile().then((turnstile) => {
    const box = document.getElementById("cf-turnstile") as HTMLDivElement;
    const id = turnstile.render(box, {
      sitekey: SITE_KEY,
      action: TURNSTILE_ACTION,
      appearance: "interaction-only",
      size: box.clientWidth < 300 ? "compact" : "flexible",
      "response-field": false,
      callback: (value: string) => {
        interactive = false;
        deliver(value);
      },
      "expired-callback": () => {
        token = "";
      },
      "timeout-callback": () => {
        token = "";
      },
      // Trả true: lỗi đã được xử lý (Turnstile tự thử lại); lần gửi sẽ báo lỗi nếu vẫn chưa có token.
      "error-callback": () => {
        token = "";
        return true;
      },
      // Cần khách bấm xác nhận: dừng chờ ngay để lần gửi báo khách hoàn tất ô xác minh.
      "before-interactive-callback": () => {
        interactive = true;
        box.classList.add("mt-4");
        deliver("");
      },
      "after-interactive-callback": () => {
        interactive = false;
      },
      "unsupported-callback": () => {
        unsupported = true;
        deliver("");
      },
    });
    if (!id) throw new Error("turnstile");
    return id;
  });
  widget = current;
  // Tải hỏng (mạng, trình chặn) thì lần sau thử lại từ đầu.
  current.catch(() => {
    if (widget === current) widget = null;
  });
  return current;
}

function nextToken(): Promise<string> {
  if (token || unsupported || interactive) return Promise.resolve(token);
  return new Promise((resolve) => {
    const done = (value: string) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== done);
      resolve("");
    }, TOKEN_WAIT_MS);
    waiters.push(done);
  });
}

function reply(status: number, error?: string): Response {
  return new Response(JSON.stringify(error ? { error } : {}), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function showReference(reference: unknown): void {
  const el = document.getElementById("cf-reference");
  if (!el || typeof reference !== "string") return;
  el.textContent = `Mã yêu cầu của bạn: ${reference}. Khi gọi cho CNN Legal, bạn đọc mã này để được tra cứu nhanh.`;
  el.classList.remove("hidden");
}

export async function submit(form: HTMLFormElement, data: ContactFields): Promise<Response> {
  const consent = form.elements.namedItem("consent") as HTMLInputElement | null;
  if (!consent?.checked) {
    return reply(400, "Vui lòng đánh dấu đồng ý để CNN Legal xử lý thông tin và liên hệ tư vấn cho bạn.");
  }
  const category = CATEGORY_KEYS[data.field];
  if (!category) return reply(400, "Vui lòng chọn lĩnh vực.");

  let widgetId: string;
  try {
    widgetId = await prepare();
  } catch {
    return reply(503, "Không tải được bước xác minh chống spam.");
  }
  const value = await nextToken();
  if (!value) {
    return interactive
      ? reply(400, "Vui lòng hoàn tất ô xác minh chống spam ngay trên nút Gửi rồi bấm gửi lại.")
      : reply(503, "Chưa xác minh được chống spam, bạn thử lại sau ít phút nhé.");
  }
  // Token chỉ dùng được một lần: xin ngay token mới cho lần gửi lại (nếu có).
  token = "";
  window.turnstile?.reset(widgetId);

  const fields = {
    name: data.name,
    phone: data.phone,
    email: data.email,
    category,
    subject: data.subject,
    message: data.message,
    consent: true,
    consent_version: consent.value,
    website: data.cf_hp,
  };
  const fingerprint = JSON.stringify(fields);
  if (pending?.fingerprint !== fingerprint) pending = { key: crypto.randomUUID(), fingerprint };

  // Lỗi mạng hay hết giờ thì để lien-he.astro bắt như đường cũ (kèm số điện thoại và thư soạn sẵn).
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key },
    body: JSON.stringify({ ...fields, turnstile_token: value }),
    signal: AbortSignal.timeout?.(REQUEST_TIMEOUT_MS),
  });
  const payload = (await res.json().catch(() => ({}))) as ApiReply;
  if (res.ok) {
    pending = null;
    showReference(payload.reference);
    return reply(200);
  }
  if (res.status === 409) pending = null;
  const { error } = payload;
  const details = error?.code === "validation_failed" && error.fields ? Object.values(error.fields) : [];
  return reply(res.status, details.length > 0 ? details.join(" ") : error?.message);
}
