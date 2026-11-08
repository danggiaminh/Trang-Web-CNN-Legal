// Sinh tự động bởi scripts/build-embedding-index.ts. Không sửa tay.
// Chưa có chỉ mục: trợ lý dùng BM25 như trước.
import type { EmbeddingIndex } from "../server/embedding";

export const EMBEDDING_INDEX: EmbeddingIndex = {
  model: "openai/text-embedding-3-small",
  dim: 1536,
  items: [],
};
