// Nạp trước mọi file test (node --import): thay module ảo của Astro bằng bản giả và chặn mọi
// request mạng. Test nào cần mạng phải tự dựng phản hồi giả (xem helpers/fetch-stub.ts).
import { register } from "node:module";

register("./loader.mjs", import.meta.url);

globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`Test không được gọi mạng thật: ${url}`);
};
