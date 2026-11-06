import assert from "node:assert/strict";
import { test } from "node:test";

test("mọi module server và route API nạp được ngoài Vite", async () => {
  for (const path of [
    "../src/server/guard.ts",
    "../src/server/contact.ts",
    "../src/server/openrouter.ts",
    "../src/server/tavily.ts",
    "../src/server/prompt.ts",
    "../src/server/knowledge.ts",
    "../src/server/retrieval.ts",
    "../src/scripts/ask-markdown.ts",
    "../src/pages/api/v1/chat.ts",
    "../src/pages/api/v1/contact.ts",
    "../src/pages/api/v1/health.ts",
  ]) {
    const mod = await import(path);
    assert.ok(Object.keys(mod).length > 0, path);
  }
});

test("kho tri thức của trợ lý có đủ bài viết, vụ án và dịch vụ", async () => {
  const { allDocs } = await import("../src/server/knowledge.ts");
  const docs = await allDocs();
  assert.ok(docs.length >= 10, `chỉ có ${docs.length} tài liệu`);
});
