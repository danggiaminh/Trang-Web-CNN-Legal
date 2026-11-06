import assert from "node:assert/strict";
import { test } from "node:test";
import { externalArticles, getAllArticles } from "../src/data/articles.ts";
import { allDocs, getDoc } from "../src/server/knowledge.ts";
import { buildMessages } from "../src/server/prompt.ts";
import { selectContext } from "../src/server/retrieval.ts";

test("tài liệu của từng bài viết mở đầu bằng ngày đăng dd/mm/yyyy", async () => {
  const list = await getAllArticles();
  assert.ok(list.length >= 6);
  for (const a of list) {
    assert.match(a.publishedAt, /^\d{2}\/\d{2}\/\d{4}$/, a.slug);
    const doc = await getDoc(a.slug);
    assert.ok(doc, a.slug);
    assert.ok(doc.text.startsWith(`Ngày đăng: ${a.publishedAt}\n\n`), a.slug);
  }
  // Bài đăng ở báo khác (chỉ có phần giới thiệu) cũng ghi ngày.
  const docs = await allDocs();
  for (const a of externalArticles) {
    const doc = docs.find((d) => d.url === a.sourceUrl);
    assert.ok(doc, a.sourceUrl);
    assert.ok(doc.text.startsWith(`Ngày đăng: ${a.publishedAt}\n\n`), a.sourceUrl);
  }
});

test("nội dung bài viết lấy từ blocks: có cả đoạn đầu lẫn đoạn cuối của bài", async () => {
  for (const a of await getAllArticles()) {
    const blocks = a.blocks ?? [];
    assert.ok(blocks.length > 0, a.slug);
    const texts = blocks.map((b) => ("text" in b ? b.text : "")).filter((t) => t.trim().length > 20);
    const doc = await getDoc(a.slug);
    assert.ok(doc!.text.includes(texts[0]!.trim()), `${a.slug}: thiếu đoạn đầu`);
    assert.ok(doc!.text.includes(texts.at(-1)!.trim()), `${a.slug}: thiếu đoạn cuối`);
  }
});

test("đang đọc một bài: ngày đăng có mặt trong system prompt gửi model", async () => {
  const slug = "du-thao-luat-dat-dai-thu-hoi-dat-vuot-nguong-dong-thuan";
  const ctx = await selectContext("Quy định 75% này đã có hiệu lực chưa?", slug);
  const [system] = buildMessages("Quy định 75% này đã có hiệu lực chưa?", ctx.passages, ctx.currentTitle, [], {
    webSearch: false,
    quotaExhausted: false,
  });
  assert.ok(system!.content.includes("Ngày đăng: 28/09/2025"));
});
