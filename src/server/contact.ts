import {
  BREVO_API_KEY,
  CONTACT_FROM_EMAIL,
  CONTACT_TO_EMAIL,
} from "astro:env/server";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const SENDER_NAME = "CNN Legal";

export const MAX_CONTACT_BYTES = 24 * 1024;

const LIMITS = {
  name: 120,
  phone: 32,
  email: 200,
  subject: 200,
  message: 5000,
} as const;

const ALLOWED_FIELDS = new Set([
  "Hình sự",
  "Dân sự - Kinh doanh",
  "Hành chính",
  "Nghiên cứu và phản biện",
  "Ứng tuyển vào CNN Legal",
]);

const EMAIL_RE = /^[^\s@<>";,]+@[^\s@<>";,]+\.[^\s@<>";,]{2,}$/;
const PHONE_RE = /^[0-9+()\-. ]{6,32}$/;

export interface ContactData {
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly field: string;
  readonly subject: string;
  readonly message: string;
}

function oneLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function multiLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim().slice(0, max);
}

export function hasBrevoKey(): boolean {
  return Boolean(BREVO_API_KEY?.trim());
}

export type ParseResult =
  | { readonly ok: true; readonly data: ContactData }
  | { readonly ok: false; readonly error: string };

export function parseContact(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Dữ liệu gửi lên không hợp lệ." };
  }
  const body = raw as Record<string, unknown>;

  if (oneLine(body.company, 100)) {
    return { ok: false, error: "Yêu cầu bị từ chối." };
  }

  const name = oneLine(body.name, LIMITS.name);
  const phone = oneLine(body.phone, LIMITS.phone);
  const email = oneLine(body.email, LIMITS.email);
  const field = oneLine(body.field, 64);
  const subject = oneLine(body.subject, LIMITS.subject);
  const message = multiLine(body.message, LIMITS.message);

  if (!name) return { ok: false, error: "Vui lòng nhập họ tên." };
  if (!phone) return { ok: false, error: "Vui lòng nhập số điện thoại." };
  if (!PHONE_RE.test(phone)) return { ok: false, error: "Số điện thoại không hợp lệ." };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "Email không hợp lệ." };
  if (!ALLOWED_FIELDS.has(field)) return { ok: false, error: "Vui lòng chọn lĩnh vực." };
  if (!message) return { ok: false, error: "Vui lòng nhập nội dung." };

  return { ok: true, data: { name, phone, email, field, subject, message } };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildSubject(data: ContactData): string {
  const tail = data.subject ? ` – ${data.subject}` : "";
  return oneLine(`[CNN Legal] ${data.field}${tail} – ${data.name}`, 200);
}

export function buildHtml(data: ContactData): string {
  const rows: [string, string][] = [
    ["Họ tên", data.name],
    ["Điện thoại", data.phone],
    ["Email", data.email || "(không cung cấp)"],
    ["Lĩnh vực", data.field],
    ["Tiêu đề", data.subject || "(không có)"],
  ];
  const table = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#5b6472;white-space:nowrap">${escapeHtml(k)}</td>` +
        `<td style="padding:4px 0;color:#0f1923">${escapeHtml(v)}</td></tr>`,
    )
    .join("");
  const body = escapeHtml(data.message).replace(/\n/g, "<br>");
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.7">` +
    `<table style="border-collapse:collapse;margin-bottom:16px">${table}</table>` +
    `<div style="white-space:normal;color:#0f1923">${body}</div>` +
    `</div>`
  );
}

export function buildText(data: ContactData): string {
  return [
    `Họ tên: ${data.name}`,
    `Điện thoại: ${data.phone}`,
    `Email: ${data.email || "(không cung cấp)"}`,
    `Lĩnh vực: ${data.field}`,
    `Tiêu đề: ${data.subject || "(không có)"}`,
    "",
    data.message,
  ].join("\n");
}

export async function sendContactEmail(
  data: ContactData,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; messageId: string | null; detail: string | null }> {
  const payload: Record<string, unknown> = {
    sender: { email: CONTACT_FROM_EMAIL.trim(), name: SENDER_NAME },
    to: [{ email: CONTACT_TO_EMAIL.trim() }],
    subject: buildSubject(data),
    htmlContent: buildHtml(data),
    textContent: buildText(data),
  };
  // Brevo giới hạn trường name tối đa 70 ký tự, cắt bớt để tránh lỗi 400.
  if (data.email) payload.replyTo = { email: data.email, name: data.name.slice(0, 70) };

  const res = await fetch(BREVO_URL, {
    method: "POST",
    signal,
    headers: {
      "api-key": BREVO_API_KEY?.trim() ?? "",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  // Brevo tra 201 ngay ca khi thu bi tu choi sau do (vi du nguoi gui chua xac minh).
  // Giu lai messageId de con tra cuu trong Brevo > Logs khi thu khong toi noi.
  const raw = await res.text().catch(() => "");
  let messageId: string | null = null;
  let detail: string | null = null;
  try {
    const body = JSON.parse(raw) as { messageId?: unknown; message?: unknown };
    if (typeof body?.messageId === "string") messageId = body.messageId;
    if (typeof body?.message === "string") detail = body.message.slice(0, 300);
  } catch {
    // Than tra ve khong phai JSON - status va detail rong da du de ghi log.
  }
  return { ok: res.ok, status: res.status, messageId, detail };
}

const SENDERS_URL = "https://api.brevo.com/v3/senders";
const DOMAINS_URL = "https://api.brevo.com/v3/senders/domains";

export interface SenderStatus {
  readonly from: string;
  readonly valid: boolean;
  readonly reason: string;
}

// Trang thai nguoi gui gan nhu khong doi. Nho lai de /health khong bien thanh
// duong khuech dai: moi lan goi la 2 request ra Brevo, ton quota cua chinh minh.
const SENDER_TTL_MS = 5 * 60 * 1000;
let senderCache: { at: number; value: SenderStatus } | null = null;

/**
 * Kiem tra CONTACT_FROM_EMAIL co thuc su gui duoc khong.
 * Brevo chap nhan request (201) roi moi tu choi khong dong bo neu nguoi gui
 * chua hop le, nen khong the phat hien luc gui - phai hoi truoc bang duong nay.
 */
export async function checkSender(signal?: AbortSignal): Promise<SenderStatus> {
  if (senderCache && Date.now() - senderCache.at < SENDER_TTL_MS) return senderCache.value;

  const status = await fetchSenderStatus(signal);
  // Chi nho ket qua chac chan; loi mang tam thoi thi lan sau hoi lai.
  if (status.reason !== "Không kiểm tra được trạng thái người gửi.") {
    senderCache = { at: Date.now(), value: status };
  }
  return status;
}

async function fetchSenderStatus(signal?: AbortSignal): Promise<SenderStatus> {
  const from = CONTACT_FROM_EMAIL.trim();
  const key = BREVO_API_KEY?.trim() ?? "";
  if (!key) return { from, valid: false, reason: "Thiếu BREVO_API_KEY." };

  const init = { signal, headers: { "api-key": key, Accept: "application/json" } };

  try {
    const res = await fetch(SENDERS_URL, init);
    if (res.ok) {
      const body = (await res.json()) as { senders?: { email?: string; active?: boolean }[] };
      const hit = body.senders?.find((s) => s.email?.toLowerCase() === from.toLowerCase());
      if (hit?.active) return { from, valid: true, reason: "Người gửi đã được xác minh." };
    } else {
      await res.body?.cancel().catch(() => {});
    }

    const domain = from.split("@")[1]?.toLowerCase() ?? "";
    const dRes = await fetch(DOMAINS_URL, init);
    if (dRes.ok) {
      const body = (await dRes.json()) as { domains?: { domain_name?: string; authenticated?: boolean }[] };
      const hit = body.domains?.find((d) => d.domain_name?.toLowerCase() === domain);
      if (hit?.authenticated) return { from, valid: true, reason: `Domain ${domain} đã xác thực.` };
    } else {
      await dRes.body?.cancel().catch(() => {});
    }

    return {
      from,
      valid: false,
      reason: `${from} chưa được xác minh và domain ${domain} chưa xác thực — thư sẽ bị Brevo từ chối sau khi nhận.`,
    };
  } catch {
    return { from, valid: false, reason: "Không kiểm tra được trạng thái người gửi." };
  }
}
