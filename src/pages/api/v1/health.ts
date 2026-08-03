/**
 * GET /api/v1/health — một lệnh curl là biết biến môi trường trên Vercel đã vào
 * hay chưa:
 *
 *   curl -s https://cnnlegal.vn/api/v1/health
 *   {"ok":true,"keyPresent":true,"docs":33,"sections":112}
 *
 * `keyPresent` chỉ nói có hay không, không bao giờ trả giá trị khoá. Tên model
 * và nhà cung cấp cũng không trả: system prompt của trợ lý đã cấm tiết lộ thông
 * tin hệ thống, endpoint công khai này không nên đi ngược điều đó. Cần biết
 * model nào đang chạy thì xem trong bảng Environment Variables của Vercel.
 *
 * `docs` bằng 0 nghĩa là kho tri thức rỗng — trợ lý sẽ trả lời chung chung.
 */
export const prerender = false;

import type { APIRoute } from "astro";
import { allDocs } from "../../../server/knowledge";
import { hasApiKey } from "../../../server/openrouter";

export const GET: APIRoute = async () => {
  let docs = 0;
  let sections = 0;
  let ok = true;

  try {
    const corpus = await allDocs();
    docs = corpus.length;
    sections = corpus.reduce((sum, d) => sum + d.sections.length, 0);
  } catch (err) {
    console.error("[api/v1/health] dựng kho tri thức thất bại", err);
    ok = false;
  }

  return new Response(JSON.stringify({ ok, keyPresent: hasApiKey(), docs, sections }), {
    status: ok ? 200 : 500,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
};
