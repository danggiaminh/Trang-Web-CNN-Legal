// Hook phân giải module để Node 24 chạy thẳng mã TypeScript của site (Node tự bỏ phần kiểu).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_STUB = new URL("./stubs/astro-env-server.mjs", import.meta.url).href;
const SRC = new URL("../src/", import.meta.url).href;
// Vite thay import.meta.env lúc build; chạy ngoài Vite thì phải tự cấp, giá trị như bản production.
const META_ENV =
  'import.meta.env = { DEV: false, PROD: true, SSR: true, MODE: "production", BASE_URL: "/", SITE: "https://cnnlegal.vn" };';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "astro:env/server") return { url: ENV_STUB, shortCircuit: true };
  // Mã nguồn import không đuôi ("./guard") như Vite cho phép; Node cần đường dẫn đầy đủ.
  if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.startsWith("file:")) {
    for (const ext of [".ts", "/index.ts"]) {
      const url = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith(SRC) && result.source != null) {
    const source = String(result.source);
    if (source.includes("import.meta.env")) return { ...result, source: META_ENV + source, shortCircuit: true };
  }
  return result;
}
