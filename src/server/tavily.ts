import { TAVILY_API_KEY } from "astro:env/server";

const BASE_URL = "https://api.tavily.com/search";

// Mỗi lượt tìm là một "credit" của Tavily và người dùng chỉ có 3 lượt, nên lấy
// đủ rộng để trả lời được ngay: 5 kết quả, chiều sâu "basic" (1 credit).
const MAX_RESULTS = 5;
const SEARCH_DEPTH = "basic";

// Cắt bớt trước khi nhồi vào prompt: 5 kết quả × 700 ký tự vẫn nhỏ hơn nhiều so
// với nguyên bài viết đang nằm sẵn trong ngữ cảnh, nên không đội chi phí lên mấy.
const SNIPPET_CHARS = 700;
const RESULTS_MAX_CHARS = 4200;

// Người đọc đang nhìn màn hình chờ, không đáng để treo lâu hơn thế này. Quá hạn
// thì coi như tìm hỏng — và tìm hỏng thì KHÔNG trừ lượt.
const TIMEOUT_MS = 8000;

export const MAX_QUERY_CHARS = 300;

export interface WebResult {
  readonly title: string;
  readonly url: string;
  readonly content: string;
}

export function hasTavilyKey(): boolean {
  return Boolean(TAVILY_API_KEY?.trim());
}

function trimTo(text: string, limit: number): string {
  const t = text.trim();
  return t.length > limit ? `${t.slice(0, limit)}…` : t;
}

function parseResults(raw: unknown): WebResult[] {
  if (typeof raw !== "object" || raw === null) return [];
  const list = (raw as { results?: unknown }).results;
  if (!Array.isArray(list)) return [];

  const out: WebResult[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url.trim() : "";
    const content = typeof r.content === "string" ? r.content.trim() : "";
    if (!url || !content) continue;
    out.push({
      title: typeof r.title === "string" && r.title.trim() ? r.title.trim() : url,
      url,
      content: trimTo(content, SNIPPET_CHARS),
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/**
 * Trả về null khi tìm kiếm hỏng (thiếu khoá, mạng lỗi, quá hạn, Tavily đổi cấu
 * trúc trả về, không có kết quả nào dùng được). Người gọi phải hiểu null là
 * "chưa tiêu lượt nào" — chỉ trừ lượt khi thật sự có kết quả trong tay.
 */
export async function searchWeb(query: string, signal: AbortSignal): Promise<WebResult[] | null> {
  const q = query.trim().slice(0, MAX_QUERY_CHARS);
  if (!q || !hasTavilyKey()) return null;

  let res: Response;
  try {
    res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TAVILY_API_KEY?.trim() ?? ""}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      body: JSON.stringify({
        query: q,
        search_depth: SEARCH_DEPTH,
        max_results: MAX_RESULTS,
        topic: "general",
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
    });
  } catch (err) {
    if (signal.aborted) return null;
    console.error("[tavily] gọi tìm kiếm thất bại", err);
    return null;
  }

  if (!res.ok) {
    console.error(`[tavily] tìm kiếm trả lỗi HTTP ${res.status}`);
    await res.body?.cancel().catch(() => {});
    return null;
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    console.error("[tavily] không đọc được JSON trả về", err);
    return null;
  }

  const results = parseResults(payload);
  return results.length ? results : null;
}

export function renderResults(query: string, results: readonly WebResult[]): string {
  const lines: string[] = [`Kết quả tìm kiếm trên Internet cho truy vấn: "${query}"`, ""];
  let used = 0;
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i]!;
    const block = `[W${i + 1}] ${r.title}\nNguồn: ${r.url}\n${r.content}`;
    if (used + block.length > RESULTS_MAX_CHARS && i > 0) break;
    used += block.length;
    lines.push(block, "");
  }
  return lines.join("\n").trim();
}

export const __test__ = { parseResults, renderResults, trimTo };
