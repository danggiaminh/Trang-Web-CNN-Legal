import { writeFileSync } from "node:fs";
import { allDocs } from "../src/server/knowledge.ts";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  embeddingText,
  packVector,
  passageHash,
  passageKey,
  requestEmbeddings,
} from "../src/server/embedding.ts";

const BATCH_SIZE = 64;
const OUTPUT = new URL("../src/data/embedding-index.ts", import.meta.url);

interface Piece {
  readonly key: string;
  readonly hash: string;
  readonly text: string;
}

async function collectPieces(): Promise<Piece[]> {
  const pieces: Piece[] = [];
  for (const doc of await allDocs()) {
    for (const section of doc.sections) {
      const parts = { title: doc.title, headingPath: section.headingPath, content: section.content };
      pieces.push({
        key: passageKey(doc.slug, section.ord),
        hash: passageHash(parts),
        text: embeddingText(parts),
      });
    }
  }
  return pieces;
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("Thiếu OPENROUTER_API_KEY (đặt trong .env.local hoặc biến môi trường).");

  const pieces = await collectPieces();
  const items: [string, string, string][] = [];
  for (let start = 0; start < pieces.length; start += BATCH_SIZE) {
    const batch = pieces.slice(start, start + BATCH_SIZE);
    const vectors = await requestEmbeddings(
      batch.map((p) => p.text),
      apiKey,
    );
    batch.forEach((p, i) => items.push([p.key, p.hash, packVector(vectors[i]!)]));
    console.log(`đã embed ${Math.min(start + BATCH_SIZE, pieces.length)}/${pieces.length} đoạn`);
  }

  const lines = items.map((item) => `    ${JSON.stringify(item)},`).join("\n");
  const source =
    "// Sinh tự động bởi scripts/build-embedding-index.ts. Không sửa tay.\n" +
    'import type { EmbeddingIndex } from "../server/embedding";\n\n' +
    "export const EMBEDDING_INDEX: EmbeddingIndex = {\n" +
    `  model: ${JSON.stringify(EMBEDDING_MODEL)},\n` +
    `  dim: ${EMBEDDING_DIM},\n` +
    "  items: [\n" +
    (lines ? `${lines}\n` : "") +
    "  ],\n" +
    "};\n";
  writeFileSync(OUTPUT, source, "utf8");
  console.log(`đã ghi ${items.length} vector vào src/data/embedding-index.ts`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
