import { OPENROUTER_API_KEY } from "astro:env/server";

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBED_TIMEOUT_MS = 1200;
const QUERY_CACHE_MAX = 200;
// Cùng k với rrf_fuse bên rag-backend (db.rs).
const RRF_K = 60;
/** Ngưỡng cosine để một đoạn được coi là liên quan. Chưa hiệu chỉnh trên dữ liệu thật. */
export const SEMANTIC_MIN_SIMILARITY = 0.3;

export interface PassageText {
  readonly title: string;
  readonly headingPath: string;
  readonly content: string;
}

/** Khoá ổn định của một đoạn trong chỉ mục: slug bài và thứ tự mục trong bài. */
export function passageKey(slug: string, ord: number): string {
  return `${slug}#${ord}`;
}

/** Ghép giống embed_text bên rag-backend (chunk.rs): tiêu đề, đường dẫn mục, rồi nội dung. */
export function embeddingText({ title, headingPath, content }: PassageText): string {
  return `${title ? `${title}\n` : ""}${headingPath ? `${headingPath}\n` : ""}${content}`;
}

/** FNV-1a 32 bit, chỉ dùng để nhận ra đoạn đã đổi chữ. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function passageHash(passage: PassageText): string {
  return fingerprint(embeddingText(passage));
}

export interface EmbeddingIndex {
  readonly model: string;
  readonly dim: number;
  /** [khoá, hash nội dung lúc build, vector đã lượng tử hoá dạng base64]. */
  readonly items: readonly (readonly [key: string, hash: string, packed: string])[];
}

export function normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (const x of vec) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return vec.map((x) => x / norm);
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

/** Lượng tử hoá int8 theo từng vector đã chuẩn hoá: 4 byte biên độ float32 LE, rồi dim byte. */
export function packVector(vec: Float32Array): string {
  const buf = Buffer.alloc(4 + vec.length);
  let max = 0;
  for (const x of vec) max = Math.max(max, Math.abs(x));
  buf.writeFloatLE(max, 0);
  if (max > 0) {
    for (let i = 0; i < vec.length; i += 1) buf.writeInt8(Math.round((vec[i]! / max) * 127), 4 + i);
  }
  return buf.toString("base64");
}

export function unpackVector(packed: string, dim: number): Float32Array | null {
  const buf = Buffer.from(packed, "base64");
  if (buf.length !== 4 + dim) return null;
  const scale = buf.readFloatLE(0) / 127;
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) out[i] = buf.readInt8(4 + i) * scale;
  return out;
}

/**
 * Giữ vector đúng model, đúng số chiều và chưa lệch nội dung hiện tại. Đoạn không có vector hợp lệ
 * thì chỉ được xếp bằng BM25.
 */
export function usableVectors(
  index: EmbeddingIndex,
  currentHashes: ReadonlyMap<string, string>,
): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  if (index.model !== EMBEDDING_MODEL || index.dim !== EMBEDDING_DIM) return out;
  for (const [key, hash, packed] of index.items) {
    if (currentHashes.get(key) !== hash) continue;
    const vec = unpackVector(packed, EMBEDDING_DIM);
    if (vec) out.set(key, vec);
  }
  return out;
}

/** Khoá có cosine với câu hỏi từ ngưỡng trở lên, xếp giảm dần, tối đa `limit` khoá. */
export function rankBySimilarity(
  query: Float32Array,
  candidates: readonly { readonly key: string; readonly vec: Float32Array }[],
  minScore: number,
  limit: number,
): string[] {
  return candidates
    .map((c) => ({ key: c.key, score: dot(query, c.vec) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.key);
}

/** Reciprocal Rank Fusion, cùng công thức với rrf_fuse (db.rs). Hoà điểm thì xếp theo khoá. */
export function reciprocalRankFusion(rankings: readonly (readonly string[])[]): string[] {
  const score = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((key, rank) => score.set(key, (score.get(key) ?? 0) + 1 / (RRF_K + rank + 1)));
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key]) => key);
}

interface EmbeddingItem {
  readonly index: number;
  readonly embedding: readonly number[];
}

function isEmbeddingItem(value: unknown): value is EmbeddingItem {
  if (typeof value !== "object" || value === null) return false;
  const { index, embedding } = value as { index?: unknown; embedding?: unknown };
  return (
    typeof index === "number" &&
    Array.isArray(embedding) &&
    (embedding as unknown[]).every((x) => typeof x === "number")
  );
}

/** Gọi API embedding của OpenRouter; trả vector đã chuẩn hoá theo đúng thứ tự đầu vào. */
export async function requestEmbeddings(
  inputs: readonly string[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  const res = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
    signal,
  });
  if (!res.ok) throw new Error(`embedding HTTP ${res.status}`);
  const body: unknown = await res.json();
  const data: unknown = typeof body === "object" && body !== null && "data" in body ? body.data : undefined;
  if (!Array.isArray(data) || !data.every(isEmbeddingItem)) throw new Error("embedding: phản hồi sai dạng");
  if (data.length !== inputs.length) throw new Error("embedding: số vector không khớp số đầu vào");
  return [...data]
    .sort((a, b) => a.index - b.index)
    .map((item) => {
      if (item.embedding.length !== EMBEDDING_DIM) {
        throw new Error(`embedding: ${item.embedding.length} chiều, cần ${EMBEDDING_DIM}`);
      }
      return normalize(Float32Array.from(item.embedding));
    });
}

const queryCache = new Map<string, Float32Array>();

/**
 * Vector của câu hỏi, hoặc null khi không dùng được (thiếu khoá, lỗi mạng, quá hạn). Không ném lỗi
 * và không ghi nội dung câu hỏi ra log.
 */
export async function embedQuery(question: string, signal?: AbortSignal): Promise<Float32Array | null> {
  const apiKey = OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const cacheKey = question.trim().toLowerCase();
  const cached = queryCache.get(cacheKey);
  if (cached) return cached;
  try {
    const [vec] = await requestEmbeddings([question], apiKey, timeoutSignal(signal));
    if (!vec) return null;
    rememberQuery(cacheKey, vec);
    return vec;
  } catch (err) {
    if (!signal?.aborted) {
      console.warn(`[embedding] bỏ qua vector câu hỏi: ${err instanceof Error ? err.message : "lỗi không rõ"}`);
    }
    return null;
  }
}

function timeoutSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(EMBED_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function rememberQuery(key: string, vec: Float32Array): void {
  if (queryCache.size >= QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
  queryCache.set(key, vec);
}
