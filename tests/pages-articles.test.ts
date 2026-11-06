import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { articles, type ArticleBlock } from "../src/data/articles.ts";

// Dán bài từ trang nguồn hay làm một câu bị cắt thành hai khối. Mỗi khối là một <p> riêng nên người
// đọc thấy câu đứt giữa chừng. Dấu hiệu: khối trước không kết thúc bằng dấu kết câu (. ! ? …) và khối
// sau cùng loại mở đầu bằng chữ thường; hoặc khối trước dừng ngay sau một chữ/số còn khối sau mở đầu
// bằng số, ngoặc kép, ngoặc đơn ("…năm" + "2005…", "…rằng" + "“L/C…"). Ký hiệu liệt kê ("a. ",
// "b) ", "(1) ") là đầu mục thật, không tính.
const ENDS_SENTENCE = /[.!?…]["”’)\]]*$/u;
const LIST_MARKER = /^\(?(?:\p{Ll}|\d+)[.)]\s/u;
const STARTS_LOWERCASE = /^\p{Ll}/u;
const ENDS_IN_WORD = /[\p{Ll}\d]$/u;
const STARTS_DIGIT_OR_OPENING = /^[\d“"‘(]/u;

const proseText = (block: ArticleBlock) =>
  block.type === "paragraph" || block.type === "note" ? block.text : undefined;

test("không có câu nào bị cắt đôi thành hai khối", () => {
  const splits: string[] = [];
  for (const article of articles) {
    article.blocks.forEach((block, i) => {
      const next = article.blocks[i + 1];
      if (!next || next.type !== block.type) return;
      const a = proseText(block)?.trimEnd();
      const b = proseText(next)?.trimStart();
      if (a === undefined || b === undefined || ENDS_SENTENCE.test(a) || LIST_MARKER.test(b)) return;
      if (STARTS_LOWERCASE.test(b) || (ENDS_IN_WORD.test(a) && STARTS_DIGIT_OR_OPENING.test(b))) {
        splits.push(`${article.slug} khối ${i}: «…${a.slice(-40)}» + «${b.slice(0, 40)}…»`);
      }
    });
  }
  assert.deepEqual(splits, [], "gộp mỗi cặp thành một khối");
});

test("bài nào cũng có nội dung, alt ảnh, ngày đăng; ảnh có cỡ thật", () => {
  assert.ok(articles.length > 0);
  for (const a of articles) {
    assert.ok(a.blocks.length > 0, `${a.slug}: blocks rỗng`);
    // Nội dung chỉ nằm trong blocks; bodyParagraphs là bản sao cũ đã lệch so với bài.
    assert.ok(!("bodyParagraphs" in a), `${a.slug}: còn bodyParagraphs`);
    assert.ok(a.imageAlt.trim(), `${a.slug}: thiếu imageAlt`);
    assert.match(a.publishedAt, /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/20\d\d$/, `${a.slug}: publishedAt dd/mm/yyyy`);
    // copyrightHolder.url trong JSON-LD lấy origin của link bài gốc.
    assert.equal(new URL(a.sourceUrl).protocol, "https:", `${a.slug}: sourceUrl`);
    if (a.imageUrl.startsWith("/")) {
      // Trang bài dùng bản trong src/assets; bản trong public/ giữ cho link cũ.
      assert.ok(existsSync(new URL(`../src/assets${a.imageUrl}`, import.meta.url)), `${a.slug}: thiếu src/assets${a.imageUrl}`);
      assert.ok(existsSync(new URL(`../public${a.imageUrl}`, import.meta.url)), `${a.slug}: thiếu public${a.imageUrl}`);
    } else {
      assert.match(a.imageUrl, /^https:\/\//, `${a.slug}: imageUrl`);
      for (const n of [a.imageWidth, a.imageHeight]) {
        assert.ok(Number.isInteger(n) && n! > 0, `${a.slug}: ảnh ngoài site cần imageWidth/imageHeight là cỡ thật`);
      }
    }
  }
});
