import assert from "node:assert/strict";
import { test } from "node:test";
import { SCHEMA_DEFAULTS, SECRET_KEYS } from "./stubs/astro-env-server.mjs";

test("bản giả astro:env/server khớp schema trong astro.config.mjs", async () => {
  const { default: config } = await import("../astro.config.mjs");
  const schema = config.env!.schema as Record<string, { access: string; default?: unknown }>;
  const publicKeys = Object.keys(schema).filter((k) => schema[k]!.access === "public").sort();
  const secretKeys = Object.keys(schema).filter((k) => schema[k]!.access === "secret").sort();
  assert.deepEqual(Object.keys(SCHEMA_DEFAULTS).sort(), publicKeys);
  assert.deepEqual([...SECRET_KEYS].sort(), secretKeys);
  for (const key of publicKeys) assert.equal((SCHEMA_DEFAULTS as Record<string, unknown>)[key], schema[key]!.default, key);
});

test("không có request mạng thật nào lọt ra khi test", async () => {
  await assert.rejects(fetch("https://example.com/"), /không được gọi mạng thật/);
});
