export const prerender = false;

import type { APIRoute } from "astro";
import { corsHeaders, originAllowed, withinRateLimit } from "../../../server/guard";
import {
  MAX_CONTACT_BYTES,
  hasResendKey,
  parseContact,
  sendContactEmail,
} from "../../../server/contact";

const BUSY_MSG = "Không gửi được lúc này, bạn thử lại sau hoặc gọi trực tiếp giúp mình nhé.";

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
    return json(400, { error: parsed.error }, cors);
  }

  if (!withinRateLimit(`contact:${clientIp(request, clientAddress)}`)) {
    return json(429, { error: "Bạn gửi hơi nhanh, chờ một chút rồi thử lại nhé." }, {
      ...cors,
      "Retry-After": "10",
    });
  }

  if (!hasResendKey()) {
    console.error("[api/v1/contact] thiếu RESEND_API_KEY — kiểm tra biến môi trường trên Vercel");
    return json(503, { error: BUSY_MSG }, cors);
  }

  try {
    const result = await sendContactEmail(parsed.data, request.signal);
    if (!result.ok) {
      console.error(`[api/v1/contact] Resend trả lỗi HTTP ${result.status}`);
      return json(502, { error: BUSY_MSG }, cors);
    }
  } catch (err) {
    if (request.signal.aborted) return json(499, { error: BUSY_MSG }, cors);
    console.error("[api/v1/contact] gọi Resend thất bại", err);
    return json(502, { error: BUSY_MSG }, cors);
  }

  return json(200, { ok: true }, cors);
};

export const OPTIONS: APIRoute = ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request) });

export const GET: APIRoute = () => json(405, { error: "Endpoint này chỉ nhận POST." });
