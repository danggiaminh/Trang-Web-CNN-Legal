import { CHAT_ALLOWED_ORIGINS } from "astro:env/server";
import type { ChatMessage } from "./prompt";

export const MAX_QUESTION_CHARS = 2000;
const MAX_SLUG_CHARS = 200;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 4000;
export const MAX_BODY_BYTES = 32 * 1024;

const allowedOrigins = new Set(
  CHAT_ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || allowedOrigins.has(origin);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) return {};
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

export function withinRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [key, b] of buckets) {
        if ((now - b.last) / 1000 > BURST / RATE_PER_SECOND) buckets.delete(key);
      }
    }
    buckets.set(ip, { tokens: BURST - 1, last: now });
    return true;
  }

  bucket.tokens = Math.min(BURST, bucket.tokens + ((now - bucket.last) / 1000) * RATE_PER_SECOND);
  bucket.last = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
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

export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  let used = 0;

  for (let i = raw.length - 1; i >= 0; i -= 1) {
    const turn = raw[i];
    const role = turn?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = typeof turn?.content === "string" ? turn.content.trim() : "";
    if (!content) continue;

    const cost = content.length;
    if (out.length >= MAX_HISTORY_TURNS || used + cost > MAX_HISTORY_CHARS) break;
    used += cost;
    out.push({ role, content });
  }

  return out.reverse();
}
