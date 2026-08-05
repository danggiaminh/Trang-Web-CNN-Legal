export const prerender = false;

import type { APIRoute } from "astro";
import { allDocs } from "../../../server/knowledge";
import { hasApiKey } from "../../../server/openrouter";
import { hasResendKey } from "../../../server/contact";

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

  const body = {
    ok,
    keyPresent: hasApiKey(),

    resendKeyPresent: hasResendKey(),
    docs,
    sections,
  };

  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
};
