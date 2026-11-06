// Bản giả của module ảo astro:env/server. Biến public lấy từ file .env mẫu đang được track (đúng giá
// trị build nhúng vào khi Vercel không đặt biến), thiếu thì lấy default như schema trong
// astro.config.mjs (env-stub.test.ts giữ hai bên khớp nhau). Khoá bí mật không bao giờ đọc từ môi
// trường: test tự đặt bằng __setEnv, nên không thể vô tình dùng khoá thật.
import { readFileSync } from "node:fs";

export const SCHEMA_DEFAULTS = {
  TAVILY_DAILY_CAP: 200,
  CONTACT_TO_EMAIL: "cnnlegal.vn@gmail.com",
  CONTACT_FROM_EMAIL: "cnnlegal.vn@gmail.com",
  OPENROUTER_MODEL: "deepseek/deepseek-v4-flash",
  OPENROUTER_PROVIDER: "parasail",
  OPENROUTER_MAX_TOKENS: 1200,
  OPENROUTER_REFERER: "https://cnnlegal.vn",
  OPENROUTER_TITLE: "CNN Legal Assistant",
  CHAT_ALLOWED_ORIGINS: "https://cnnlegal.vn,https://www.cnnlegal.vn",
};
export const SECRET_KEYS = ["OPENROUTER_API_KEY", "TAVILY_API_KEY", "MISARMAIL_API_KEY"];
const NUMBERS = new Set(["TAVILY_DAILY_CAP", "OPENROUTER_MAX_TOKENS"]);

function readTemplate() {
  const values = {};
  const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m && m[2].trim() !== "" && !SECRET_KEYS.includes(m[1])) values[m[1]] = m[2].trim();
  }
  return values;
}

const template = readTemplate();
const pick = (key) => {
  const raw = template[key] ?? SCHEMA_DEFAULTS[key];
  return NUMBERS.has(key) ? Number(raw) : raw;
};

export let OPENROUTER_API_KEY = undefined;
export let TAVILY_API_KEY = undefined;
export let MISARMAIL_API_KEY = undefined;
export let TAVILY_DAILY_CAP = pick("TAVILY_DAILY_CAP");
export let CONTACT_TO_EMAIL = pick("CONTACT_TO_EMAIL");
export let CONTACT_FROM_EMAIL = pick("CONTACT_FROM_EMAIL");
export let OPENROUTER_MODEL = pick("OPENROUTER_MODEL");
export let OPENROUTER_PROVIDER = pick("OPENROUTER_PROVIDER");
export let OPENROUTER_MAX_TOKENS = pick("OPENROUTER_MAX_TOKENS");
export let OPENROUTER_REFERER = pick("OPENROUTER_REFERER");
export let OPENROUTER_TITLE = pick("OPENROUTER_TITLE");
export let CHAT_ALLOWED_ORIGINS = pick("CHAT_ALLOWED_ORIGINS");

// Đổi giá trị trong lúc test. Module nào chép giá trị vào biến riêng lúc import (vd. guard.ts dựng
// allowedOrigins) thì phải đặt trước khi import động module đó.
export function __setEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    switch (key) {
      case "OPENROUTER_API_KEY": OPENROUTER_API_KEY = value; break;
      case "TAVILY_API_KEY": TAVILY_API_KEY = value; break;
      case "MISARMAIL_API_KEY": MISARMAIL_API_KEY = value; break;
      case "TAVILY_DAILY_CAP": TAVILY_DAILY_CAP = value; break;
      case "CONTACT_TO_EMAIL": CONTACT_TO_EMAIL = value; break;
      case "CONTACT_FROM_EMAIL": CONTACT_FROM_EMAIL = value; break;
      case "OPENROUTER_MODEL": OPENROUTER_MODEL = value; break;
      case "OPENROUTER_PROVIDER": OPENROUTER_PROVIDER = value; break;
      case "OPENROUTER_MAX_TOKENS": OPENROUTER_MAX_TOKENS = value; break;
      case "OPENROUTER_REFERER": OPENROUTER_REFERER = value; break;
      case "OPENROUTER_TITLE": OPENROUTER_TITLE = value; break;
      case "CHAT_ALLOWED_ORIGINS": CHAT_ALLOWED_ORIGINS = value; break;
      default: throw new Error(`Biến không có trong schema: ${key}`);
    }
  }
}
