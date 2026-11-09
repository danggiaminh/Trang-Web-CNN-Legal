export const prerender = false;

import type { APIRoute } from "astro";
import { allDocs } from "../../../server/knowledge";
import { hasApiKey } from "../../../server/openrouter";
import { withinRateLimit } from "../../../server/guard";

function clientIp(request: Request, fallback: string | undefined): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  return fallback ?? request.headers.get("x-real-ip") ?? "unknown";
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  // allDocs() dung lai kho tri thuc, ton tai nguyen.
  // Khong chan thi endpoint cong khai nay thanh duong khuech dai chi phi tren Vercel.
  if (!withinRateLimit(`health:${clientIp(request, clientAddress)}`)) {
    return new Response(JSON.stringify({ error: "Quá nhiều yêu cầu." }), {
      status: 429,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
        "Retry-After": "10",
      },
    });
  }

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

  return new Response(
    JSON.stringify({
      ok,
      keyPresent: hasApiKey(),
      docs,
      sections,
    }),
    {
      status: ok ? 200 : 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
};
