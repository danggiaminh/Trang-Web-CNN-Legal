import {
  MISARMAIL_API_KEY,
  CONTACT_FROM_EMAIL,
  CONTACT_TO_EMAIL,
} from "astro:env/server";

const MISARMAIL_URL = "https://api.misar.io/mail/v1/send";
const SENDER_NAME = "CNN Legal";
// Không có trần thì MisarMail treo sẽ giữ khách (và function) chờ tới maxDuration.
const SEND_TIMEOUT_MS = 15_000;

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

export function hasMailKey(): boolean {
  return Boolean(MISARMAIL_API_KEY?.trim());
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
    from: { email: CONTACT_FROM_EMAIL.trim(), name: SENDER_NAME },
    to: [{ email: CONTACT_TO_EMAIL.trim() }],
    subject: buildSubject(data),
    html: buildHtml(data),
    text: buildText(data),
  };
  if (data.email) payload.reply_to = { email: data.email, name: data.name };

  let result = await postToMisarMail(payload, signal);
  // EMAIL_RE lỏng hơn bộ kiểm của MisarMail (vd "a@gmail..com" vẫn lọt), và một
  // reply_to sai làm cả thư bị 400. Email khách đã nằm trong nội dung thư nên bỏ
  // reply_to gửi lại, còn hơn mất liên hệ. 400 nghĩa là chưa gửi gì, không sợ trùng.
  if (result.status === 400 && payload.reply_to) {
    delete payload.reply_to;
    result = await postToMisarMail(payload, signal);
  }
  return result;
}

async function postToMisarMail(
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; messageId: string | null; detail: string | null }> {
  const res = await fetch(MISARMAIL_URL, {
    method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(SEND_TIMEOUT_MS)]),
    headers: {
      Authorization: `Bearer ${MISARMAIL_API_KEY?.trim() ?? ""}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  // 200 là đã gửi; 202 là SMTP chính bận, MisarMail tự xếp hàng gửi lại, nên vẫn
  // tính là nhận. Người gửi chưa xác minh (403) hay hộp nhận bị chặn vì bounce
  // (422) đều báo lỗi ngay lúc gửi, không âm thầm bỏ thư.
  const raw = await res.text().catch(() => "");
  let messageId: string | null = null;
  let detail: string | null = null;
  try {
    const body = JSON.parse(raw) as { message_id?: unknown; error?: unknown; message?: unknown };
    if (typeof body?.message_id === "string") messageId = body.message_id;
    const msg = body?.error ?? body?.message;
    if (typeof msg === "string") detail = msg.slice(0, 300);
  } catch {
    // Thân trả về không phải JSON - status và detail rỗng đã đủ để ghi log.
  }
  return { ok: res.ok, status: res.status, messageId, detail };
}
