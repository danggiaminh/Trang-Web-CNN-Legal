import assert from "node:assert/strict";
import { test } from "node:test";
import { isJunkRepetition, streamTurn } from "../src/server/openrouter.ts";
import { sseEvent, sseResponse } from "./helpers/fetch-stub.ts";

// Hai đoạn văn thường (~260 ký tự) đứng trước, để phần đuôi đem ra soi luôn đủ dài.
const PROSE =
  "Theo Điều 9 Luật Đất đai, Nhà nước thu hồi đất vì mục đích quốc phòng, an ninh; phát triển " +
  "kinh tế - xã hội vì lợi ích quốc gia, công cộng. ";
const LEAD = PROSE + PROSE;

const delta = (content: string) => sseEvent({ choices: [{ index: 0, delta: { content } }] });
const stop = sseEvent({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });

async function collect(res: Response) {
  const gen = streamTurn(res, 4000);
  let text = "";
  for (;;) {
    const { value, done } = await gen.next();
    if (done) return { text, turn: value };
    text += value;
  }
}

test("dòng kẻ bảng, dòng chấm chừa chỗ điền, dấu câu lặp dài: không bao giờ là rác", () => {
  const runs: Record<string, string> = {
    "12 gạch": "-".repeat(12),
    "16 gạch": "-".repeat(16),
    "12 dấu …": "…".repeat(12),
    "15 dấu chấm": ".".repeat(15),
    "12 gạch dưới": "_".repeat(12),
    "12 lần ---|": "---|".repeat(12),
    "12 lần ' --- |'": " --- |".repeat(12),
    "dòng kẻ 300 gạch": `|${"-".repeat(300)}|`,
    "dòng kẻ 40 cột": "|:---".repeat(40),
    "300 dấu …": "…".repeat(300),
    "300 dấu =": "=".repeat(300),
    "300 dấu *": "*".repeat(300),
    "300 gạch dài": "—".repeat(300),
    "dấu chấm cách nhau": ". ".repeat(150),
    "khoảng trắng và xuống dòng": " \n".repeat(150),
  };
  for (const [name, run] of Object.entries(runs)) {
    assert.equal(isJunkRepetition(LEAD + run), false, name);
    assert.equal(isJunkRepetition(run), false, `${name} (đứng một mình)`);
  }
  // Mẫu điền đơn dài cũng vậy: chữ xen giữa các dòng chấm.
  const form = "Họ và tên: ……………………………………………\nNgày sinh: ……………………\nĐịa chỉ: ………………………………………………………………\n".repeat(4);
  assert.equal(isJunkRepetition(LEAD + form), false, "mẫu điền đơn");
  assert.equal(isJunkRepetition(LEAD + PROSE), false, "văn bản thường");
});

test("một chữ hay một cụm ngắn lặp suốt từ 200 ký tự trở lên: là rác", () => {
  const loops: Record<string, string> = {
    "một chữ": "a".repeat(200),
    "chữ số": "0".repeat(220),
    "cụm 2 ký tự": "ha".repeat(100),
    "cụm có dấu câu": "Có. ".repeat(50),
    "cụm 8 ký tự": "luật sư ".repeat(25),
    "cụm 24 ký tự": "theo quy định pháp luật ".repeat(9),
    "biểu tượng cảm xúc": "😀".repeat(100),
  };
  for (const [name, loop] of Object.entries(loops)) {
    assert.equal(isJunkRepetition(LEAD + loop), true, name);
  }
  // Cùng một vòng lặp nhưng chưa đủ 200 ký tự thì chưa cắt.
  assert.equal(isJunkRepetition(LEAD + "ha".repeat(90)), false, "180 ký tự");
  assert.equal(isJunkRepetition("ha".repeat(99)), false, "198 ký tự, đứng một mình");
});

test("luồng có bảng Markdown: một mẩu kết thúc giữa dòng kẻ không làm đứt câu trả lời", async () => {
  const pieces = [
    PROSE,
    PROSE,
    "| Tiêu chí | Miễn trách nhiệm hình sự | Miễn truy cứu |\n|",
    "-".repeat(16),
    "|",
    "-".repeat(26),
    "|",
    "-".repeat(16),
    "|\n| Căn cứ | Điều 29 | Điều 157 |\n\nHọ và tên: ",
    "…".repeat(24),
    "\nKết luận: hai chế định khác nhau.",
  ];
  const full = pieces.join("");
  const { text, turn } = await collect(sseResponse([...pieces.map(delta), stop, "data: [DONE]\n\n"]));
  assert.equal(text, full);
  assert.equal(turn.cut, null);
  assert.equal(turn.finish, "stop");
});

test("luồng model lặp chữ: cắt sớm, báo cut = junk", async () => {
  const pieces = [PROSE, ...Array.from({ length: 400 }, () => "ha ")];
  const { text, turn } = await collect(sseResponse([...pieces.map(delta), stop, "data: [DONE]\n\n"]));
  assert.equal(turn.cut, "junk");
  assert.ok(text.length < PROSE.length + 260, `đọc tới ${text.length} ký tự mới cắt`);
  assert.ok(text.startsWith(PROSE));
});
