import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stubFetch } from "./helpers/fetch-stub.ts";
import { GET } from "../src/server/image-endpoint.ts";

type Ctx = Parameters<typeof GET>[0];

test("astro.config.mjs trỏ /_image tới endpoint riêng của site", async () => {
  const { default: config } = await import("../astro.config.mjs");
  const endpoint = (config.image as { endpoint?: { route?: string; entrypoint?: string } }).endpoint;
  assert.deepEqual(endpoint, { route: "/_image", entrypoint: "./src/server/image-endpoint.ts" });
  assert.ok(existsSync(fileURLToPath(new URL(`../${endpoint!.entrypoint}`, import.meta.url))));
  assert.deepEqual(config.image?.domains, ["img.lsvn.vn"]);
});

test("ngoài dev, /_image trả 404 ngay: không tải ảnh nguồn, không biến đổi gì", async () => {
  const stub = stubFetch(() => new Response("ảnh", { status: 200 }));
  try {
    for (const query of [
      "href=%2Fcnn-apple-180.png&w=16&h=16&f=webp",
      "href=%2F_astro%2Fhero-saigon.CPNQGDoV.jpg&w=2560&q=100&f=avif",
      "href=https%3A%2F%2Fimg.lsvn.vn%2Fa.jpg&w=640&f=avif",
    ]) {
      const url = new URL(`https://www.cnnlegal.vn/_image?${query}`);
      const res = await GET({ request: new Request(url), url } as unknown as Ctx);
      assert.equal(res.status, 404, query);
      assert.equal(await res.text(), "");
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});
