import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Form liên hệ gửi vào Contact API (cờ PUBLIC_CONTACT_API_URL) dựa vào ba nơi phải khớp nhau: lựa chọn "Lĩnh vực"
// trên trang, bảng đổi nhãn → khoá trong contact-platform.ts và khoá service_categories của Worker; cộng phiên bản
// câu đồng ý của trang phải nằm trong CONSENT_VERSION của Worker. Lệch một nơi thì khách gửi không được.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/pages/lien-he.astro");
const platform = read("../src/scripts/contact-platform.ts");
const referenceData = read("../workers/contact-api/migrations/0002_reference_data.sql");
const wrangler = read("../workers/contact-api/wrangler.jsonc");

const formOptions = [...(page.match(/<select[\s\S]*?id="cf-field"[\s\S]*?<\/select>/)?.[0] ?? "").matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
const mapping = Object.fromEntries(
  [...(platform.match(/const CATEGORY_KEYS[^{]*\{([\s\S]*?)\};/)?.[1] ?? "").matchAll(/"([^"]+)":\s*"([a-z_]+)"/g)].map((m) => [m[1], m[2]]),
);
const workerCategories = [...(referenceData.match(/INSERT INTO service_categories[\s\S]*?;/)?.[0] ?? "").matchAll(/\('([a-z_]+)',/g)].map((m) => m[1]);

test("mỗi lựa chọn Lĩnh vực trên form đổi được sang một khoá lĩnh vực có thật của Worker", () => {
  assert.ok(formOptions.length >= 5, `chỉ đọc được ${formOptions.length} lựa chọn`);
  assert.deepEqual(Object.keys(mapping).sort(), [...formOptions].sort());
  for (const key of Object.values(mapping)) assert.ok(workerCategories.includes(key), `Worker không có lĩnh vực ${key}`);
});

test("phiên bản câu đồng ý của trang nằm trong CONSENT_VERSION của mọi môi trường Worker", () => {
  const pageVersion = page.match(/const consentVersion = contactApiUrl \? "([^"]+)" : null;/)?.[1];
  assert.ok(pageVersion, "không tìm thấy phiên bản câu đồng ý trong lien-he.astro");
  const envs = [...wrangler.matchAll(/"CONSENT_VERSION":\s*"([^"]+)"/g)].map((m) => m[1].split(",").map((v) => v.trim()));
  assert.equal(envs.length, 3, "wrangler.jsonc phải có CONSENT_VERSION cho local, staging, production");
  for (const accepted of envs) assert.ok(accepted.includes(pageVersion), `${pageVersion} không nằm trong ${accepted.join(",")}`);
});

test("ô đồng ý không tích sẵn và chỉ có khi bật cờ", () => {
  const consent = page.match(/<input id="cf-consent"[^>]*>/)?.[0] ?? "";
  assert.ok(consent, "thiếu ô đồng ý");
  assert.doesNotMatch(consent, /\bchecked\b/);
  assert.match(page, /\{consentVersion && \(\s*<div>\s*<label[^>]*>\s*<input id="cf-consent"/);
});
