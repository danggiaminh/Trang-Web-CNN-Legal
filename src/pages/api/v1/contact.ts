export const prerender = false;

import type { APIRoute } from "astro";
import { site } from "../../../data/site";
import { contactSendWait, corsHeaders, originAllowed, withinRateLimit } from "../../../server/guard";
import {
  MAX_CONTACT_BYTES,
  hasMailKey,
  noteSend,
  parseContact,
  sendContactEmail,
} from "../../../server/contact";

const BUSY_MSG = "Không gửi được lúc này, bạn thử lại sau hoặc gọi trực tiếp giúp mình nhé.";
const LIMIT_MSG = `Bạn đã gửi nhiều yêu cầu liên tiếp. Để được hỗ trợ ngay, bạn gọi trực tiếp ${site.publicPhone} giúp mình nhé.`;

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

function clientIp(request: Request, fallback: string | undefined): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  return fallback ?? request.headers.get("x-real-ip") ?? "unknown";
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const cors = corsHeaders(request);

  if (!originAllowed(request)) {
    return json(403, { error: "Origin không được phép." });
  }

  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_CONTACT_BYTES) {
    return json(413, { error: "Nội dung quá dài." }, cors);
  }

  const raw = await request.text();
  if (raw.length > MAX_CONTACT_BYTES) {
    return json(413, { error: "Nội dung quá dài." }, cors);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Dữ liệu gửi lên không hợp lệ." }, cors);
  }

  const parsed = parseContact(body);
  if (!parsed.ok) {
    // Bot điền ô bẫy: trả y như gửi thành công để nó không biết mình bị lọc, và không gửi thư.
    if (parsed.trap) {
      console.warn("[api/v1/contact] ô bẫy chống bot có dữ liệu, bỏ qua không gửi thư");
      return json(200, { ok: true }, cors);
    }
    return json(400, { error: parsed.error }, cors);
  }

  const ip = clientIp(request, clientAddress);
  if (!withinRateLimit(`contact:${ip}`)) {
    return json(429, { error: "Bạn gửi hơi nhanh, chờ một chút rồi thử lại nhé." }, {
      ...cors,
      "Retry-After": "10",
    });
  }

  const wait = contactSendWait(ip);
  if (wait > 0) {
    return json(429, { error: LIMIT_MSG }, { ...cors, "Retry-After": String(wait) });
  }

  if (!hasMailKey()) {
    console.error("[api/v1/contact] thiếu MISARMAIL_API_KEY — kiểm tra biến môi trường trên Vercel");
    return json(503, { error: BUSY_MSG }, cors);
  }

  try {
    const result = await sendContactEmail(parsed.data, request.signal);
    noteSend(result.status);
    if (!result.ok) {
      console.error(
        `[api/v1/contact] MisarMail trả lỗi HTTP ${result.status}${result.detail ? ` — ${result.detail}` : ""}`,
      );
      return json(502, { error: BUSY_MSG }, cors);
    }
    // Ghi messageId để tra trong MisarMail nếu khách báo đã gửi mà không thấy thư về.
    console.log(
      `[api/v1/contact] MisarMail nhận thư (HTTP ${result.status}), messageId=${result.messageId ?? "(không có)"}`,
    );
  } catch (err) {
    if (request.signal.aborted) return json(499, { error: BUSY_MSG }, cors);
    noteSend(0);
    console.error("[api/v1/contact] gọi MisarMail thất bại", err);
    return json(502, { error: BUSY_MSG }, cors);
  }

  return json(200, { ok: true }, cors);
};

export const OPTIONS: APIRoute = ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request) });

export const GET: APIRoute = () => json(405, { error: "Endpoint này chỉ nhận POST." });
