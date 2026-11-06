import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseContact } from "../src/server/contact.ts";

const VALID = {
  name: "  Nguyễn Văn A ",
  phone: "0901 234 567",
  email: "a@example.com",
  field: "Hình sự",
  subject: "Tranh chấp\thợp đồng",
  message: "Dòng một\r\nDòng hai  ",
};

test("parseContact nhận dữ liệu hợp lệ, cắt khoảng trắng và chuẩn hoá xuống dòng", () => {
  const r = parseContact(VALID);
  assert.ok(r.ok);
  assert.deepEqual(r.data, {
    name: "Nguyễn Văn A",
    phone: "0901 234 567",
    email: "a@example.com",
    field: "Hình sự",
    subject: "Tranh chấp hợp đồng",
    message: "Dòng một\nDòng hai",
  });
});

test("parseContact báo lỗi rõ cho từng trường sai", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ ...VALID, name: " " }, "Vui lòng nhập họ tên."],
    [{ ...VALID, phone: "" }, "Vui lòng nhập số điện thoại."],
    [{ ...VALID, phone: "abc" }, "Số điện thoại không hợp lệ."],
    [{ ...VALID, email: "a@b" }, "Email không hợp lệ."],
    [{ ...VALID, field: "Khác" }, "Vui lòng chọn lĩnh vực."],
    [{ ...VALID, message: "\n" }, "Vui lòng nhập nội dung."],
  ];
  for (const [input, error] of cases) {
    const r = parseContact(input);
    assert.ok(!r.ok);
    assert.equal(r.error, error);
    assert.equal(r.trap, undefined, error);
  }
  for (const raw of [null, "chuỗi", 42]) {
    const r = parseContact(raw);
    assert.ok(!r.ok);
    assert.equal(r.error, "Dữ liệu gửi lên không hợp lệ.");
  }
});

test("ô bẫy cf_hp có chữ thì bị đánh dấu trap, kể cả khi các trường khác sai", () => {
  for (const input of [{ ...VALID, cf_hp: "http://spam.example" }, { cf_hp: "x" }]) {
    const r = parseContact(input);
    assert.ok(!r.ok);
    assert.equal(r.trap, true);
  }
  // Chỉ có khoảng trắng thì coi như trống.
  assert.ok(parseContact({ ...VALID, cf_hp: "  \t" }).ok);
});

test("trường company cũ không còn là bẫy: trình duyệt tự điền tên công ty không làm mất liên hệ", () => {
  assert.ok(parseContact({ ...VALID, company: "Công ty ABC" }).ok);
});

test("tên ô bẫy trong lien-he.astro khớp với trường máy chủ kiểm", () => {
  const page = readFileSync(new URL("../src/pages/lien-he.astro", import.meta.url), "utf8");
  const input = page.match(/<input id="cf-hp" name="([^"]+)"[^>]*>/);
  assert.ok(input, "không thấy ô bẫy cf-hp");
  const [tag, name] = input;
  assert.equal(name, "cf_hp");
  assert.match(tag, /tabindex="-1"/);
  assert.match(tag, /autocomplete="off"/);
  // Script gửi đúng tên đó lên máy chủ.
  assert.ok(page.includes(`${name}: (form.elements.namedItem('${name}') as HTMLInputElement).value`));
  assert.ok(!/name="company"|namedItem\('company'\)/.test(page));
  const r = parseContact({ ...VALID, [name]: "bot" });
  assert.ok(!r.ok && r.trap === true);
});
