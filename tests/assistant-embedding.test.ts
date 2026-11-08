import assert from "node:assert/strict";
import { test } from "node:test";
import { EMBEDDING_INDEX } from "../src/data/embedding-index.ts";
import type { Doc } from "../src/server/knowledge.ts";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  dot,
  embedQuery,
  embeddingText,
  normalize,
  packVector,
  passageHash,
  passageKey,
  rankBySimilarity,
  reciprocalRankFusion,
  unpackVector,
  usableVectors,
  type EmbeddingIndex,
} from "../src/server/embedding.ts";
import { __test__ as retrieval, selectContext } from "../src/server/retrieval.ts";
import { __setEnv } from "./stubs/astro-env-server.mjs";
import { stubFetch } from "./helpers/fetch-stub.ts";

type Item = [key: string, hash: string, packed: string];

const PAGE_SLUG = "du-thao-luat-dat-dai-thu-hoi-dat-vuot-nguong-dong-thuan";

function axis(i: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  v[i] = 1;
  return v;
}

function embeddingResponse(vec: Float32Array): Response {
  return new Response(JSON.stringify({ data: [{ index: 0, embedding: Array.from(vec) }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function withApiKey<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  __setEnv({ OPENROUTER_API_KEY: key });
  try {
    return await run();
  } finally {
    __setEnv({ OPENROUTER_API_KEY: undefined });
  }
}

function singleSectionDoc(slug: string, title: string, headingPath: string, content: string): Doc {
  return {
    slug,
    title,
    url: `/bai-viet/${slug}/`,
    category: "Pháp luật",
    text: content,
    chars: content.length,
    sections: [{ headingPath, content, ord: 0 }],
  };
}

function itemFor(doc: Doc, vec: Float32Array): Item {
  const section = doc.sections[0]!;
  const parts = { title: doc.title, headingPath: section.headingPath, content: section.content };
  return [passageKey(doc.slug, section.ord), passageHash(parts), packVector(vec)];
}

function indexOf(items: readonly Item[], overrides: Partial<EmbeddingIndex> = {}): EmbeddingIndex {
  return { model: EMBEDDING_MODEL, dim: EMBEDDING_DIM, items, ...overrides };
}

function slugsOf(passages: readonly { readonly slug: string }[]): string[] {
  return passages.map((p) => p.slug);
}

// D1 khớp từ khoá và gần nghĩa vừa phải (cosine 0,6), D2 chỉ gần nghĩa (1,0), D3 chỉ khớp từ khoá
// (cosine 0, dưới ngưỡng). Câu hỏi có thêm một từ lạ để mỗi test có khoá cache riêng.
const D1 = singleSectionDoc("giay-chung-nhan", "Giấy chứng nhận", "Mục 1", "giấy chứng nhận quyền sử dụng đất");
const D2 = singleSectionDoc("noi-dung-khac", "Nội dung khác", "", "bản tin tổng hợp hằng tuần");
const D3 = singleSectionDoc("thoi-han-dat", "Thời hạn", "", "thời hạn sử dụng đất ổn định");
const DOCS = [D1, D2, D3];

const VEC_D1 = new Float32Array(EMBEDDING_DIM);
VEC_D1[0] = 0.6;
VEC_D1[1] = 0.8;

const ITEMS: Item[] = [itemFor(D1, VEC_D1), itemFor(D2, axis(0)), itemFor(D3, axis(2))];

const question = (tag: string) => `giấy chứng nhận đất ${tag}`;

test("truy xuất toàn cục: đoạn vừa khớp từ khoá vừa gần nghĩa được đưa lên đầu", async () => {
  const stub = stubFetch(() => embeddingResponse(axis(0)));
  try {
    const idx = retrieval.buildIndexFrom(DOCS, indexOf(ITEMS));
    const passages = await withApiKey("test-key", () => retrieval.globalPassages(question("tim1"), idx));
    assert.deepEqual(slugsOf(passages), ["giay-chung-nhan", "noi-dung-khac", "thoi-han-dat"]);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("đoạn đã đổi chữ kể từ lúc build không dùng vector cũ", async () => {
  const stale: Item = [passageKey(D2.slug, 0), "00000000", packVector(axis(0))];
  const stub = stubFetch(() => embeddingResponse(axis(0)));
  try {
    const idx = retrieval.buildIndexFrom(DOCS, indexOf([ITEMS[0]!, stale, ITEMS[2]!]));
    const passages = await withApiKey("test-key", () => retrieval.globalPassages(question("tim2"), idx));
    assert.deepEqual(slugsOf(passages), ["giay-chung-nhan", "thoi-han-dat"]);
  } finally {
    stub.restore();
  }
});

test("chỉ mục sai model hoặc sai số chiều thì không gọi mạng và trả đúng kết quả BM25", async () => {
  const stub = stubFetch(() => embeddingResponse(axis(0)));
  try {
    const wrongModel = retrieval.buildIndexFrom(DOCS, indexOf(ITEMS, { model: "khac/model" }));
    const wrongDim = retrieval.buildIndexFrom(DOCS, indexOf(ITEMS, { dim: 512 }));
    for (const idx of [wrongModel, wrongDim]) {
      const passages = await withApiKey("test-key", () => retrieval.globalPassages(question("tim3"), idx));
      assert.deepEqual(slugsOf(passages), ["giay-chung-nhan", "thoi-han-dat"]);
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("lỗi HTTP khi embed câu hỏi thì rơi về BM25 và không ném lỗi", async () => {
  const stub = stubFetch(() => new Response("hết hạn mức", { status: 429 }));
  try {
    const idx = retrieval.buildIndexFrom(DOCS, indexOf(ITEMS));
    const passages = await withApiKey("test-key", () => retrieval.globalPassages(question("tim4"), idx));
    assert.deepEqual(slugsOf(passages), ["giay-chung-nhan", "thoi-han-dat"]);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("vector trả về sai số chiều bị bỏ qua", async () => {
  const stub = stubFetch(
    () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] }), { status: 200 }),
  );
  try {
    const vec = await withApiKey("test-key", () => embedQuery("sai chiều tim5"));
    assert.equal(vec, null);
  } finally {
    stub.restore();
  }
});

test("thiếu khoá API thì không gọi mạng", async () => {
  const stub = stubFetch(() => embeddingResponse(axis(0)));
  try {
    const idx = retrieval.buildIndexFrom(DOCS, indexOf(ITEMS));
    const passages = await retrieval.globalPassages(question("tim6"), idx);
    assert.deepEqual(slugsOf(passages), ["giay-chung-nhan", "thoi-han-dat"]);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("câu hỏi lặp lại dùng lại vector đã nhớ, và yêu cầu gửi đúng model và đầu vào", async () => {
  const stub = stubFetch(() => embeddingResponse(axis(3)));
  try {
    await withApiKey("test-key", async () => {
      const first = await embedQuery("nhớ vector tim7");
      const second = await embedQuery("  Nhớ Vector TIM7 ");
      assert.ok(first);
      assert.equal(second, first);
    });
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0]!.url, "https://openrouter.ai/api/v1/embeddings");
    assert.deepEqual(stub.calls[0]!.json, { model: EMBEDDING_MODEL, input: ["nhớ vector tim7"] });
  } finally {
    stub.restore();
  }
});

test("chỉ mục rỗng thì truy xuất toàn cục không gọi mạng", async () => {
  const stub = stubFetch(() => embeddingResponse(axis(0)));
  try {
    const idx = retrieval.buildIndexFrom(DOCS, indexOf([]));
    const passages = await withApiKey("test-key", () => retrieval.globalPassages(question("tim8"), idx));
    assert.deepEqual(slugsOf(passages), ["giay-chung-nhan", "thoi-han-dat"]);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("trang bài viết đi nhánh nguyên bài và không gọi mạng", async () => {
  const stub = stubFetch(() => embeddingResponse(axis(0)));
  try {
    const ctx = await withApiKey("test-key", () => selectContext("Quy định này có hiệu lực chưa?", PAGE_SLUG));
    assert.ok(ctx.passages.length > 0);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("chỉ mục đã sinh khớp model và số chiều hiện hành", () => {
  assert.equal(EMBEDDING_INDEX.model, EMBEDDING_MODEL);
  assert.equal(EMBEDDING_INDEX.dim, EMBEDDING_DIM);
});

test("usableVectors bỏ vector sai số chiều hoặc không giải mã được", () => {
  const hashes = new Map([[passageKey("a", 0), "h"]]);
  const bad: Item = [passageKey("a", 0), "h", packVector(new Float32Array(10))];
  assert.equal(usableVectors(indexOf([bad]), hashes).size, 0);
  const good: Item = [passageKey("a", 0), "h", packVector(axis(0))];
  assert.equal(usableVectors(indexOf([good], { dim: 512 }), hashes).size, 0);
  assert.equal(usableVectors(indexOf([good]), hashes).size, 1);
});

test("lượng tử hoá int8 giữ gần như nguyên hướng của vector", () => {
  const v = normalize(Float32Array.from({ length: EMBEDDING_DIM }, (_, i) => Math.sin(i * 0.37) + 0.1));
  const back = unpackVector(packVector(v), EMBEDDING_DIM);
  assert.ok(back);
  assert.ok(dot(v, back) > 0.999);
});

test("rankBySimilarity giữ đoạn từ ngưỡng trở lên và xếp giảm dần", () => {
  const at = (x: number): Float32Array => {
    const v = new Float32Array(EMBEDDING_DIM);
    v[0] = x;
    return v;
  };
  const ranked = rankBySimilarity(
    axis(0),
    [
      { key: "a", vec: at(0.9) },
      { key: "b", vec: at(0.2) },
      { key: "c", vec: at(0.5) },
    ],
    0.3,
    5,
  );
  assert.deepEqual(ranked, ["a", "c"]);
});

test("reciprocalRankFusion đẩy đoạn ở cả hai bảng lên trước; một bảng thì giữ nguyên thứ tự", () => {
  assert.deepEqual(reciprocalRankFusion([["a", "b", "c"], ["c", "a", "d"]]), ["a", "c", "b", "d"]);
  assert.deepEqual(reciprocalRankFusion([["x", "y", "z"]]), ["x", "y", "z"]);
});

test("embeddingText ghép như embed_text của rag-backend; hash đổi khi nội dung đổi", () => {
  assert.equal(embeddingText({ title: "T", headingPath: "", content: "C" }), "T\nC");
  assert.equal(embeddingText({ title: "T", headingPath: "H", content: "C" }), "T\nH\nC");
  const base = { title: "T", headingPath: "H", content: "C" };
  assert.equal(passageHash(base), passageHash({ ...base }));
  assert.notEqual(passageHash(base), passageHash({ ...base, content: "C2" }));
});
