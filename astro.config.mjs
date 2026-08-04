import { defineConfig, envField } from "astro/config";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  adapter: vercel({
  }),
  image: {

    domains: ["img.lsvn.vn"],
  },
  env: {
    schema: {
      OPENROUTER_API_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      RESEND_API_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      CONTACT_TO_EMAIL: envField.string({
        context: "server",
        access: "public",
        default: "danggiaminhmicrosoft@gmail.com",
      }),
      CONTACT_FROM_EMAIL: envField.string({
        context: "server",
        access: "public",
        default: "onboarding@resend.dev",
      }),
      OPENROUTER_MODEL: envField.string({
        context: "server",
        access: "public",
        default: "deepseek/deepseek-v4-flash",
      }),
      OPENROUTER_PROVIDER: envField.string({
        context: "server",
        access: "public",
        default: "parasail",
      }),
      OPENROUTER_MAX_TOKENS: envField.number({
        context: "server",
        access: "public",
        default: 1200,
      }),
      OPENROUTER_REFERER: envField.string({
        context: "server",
        access: "public",
        default: "https://cnnlegal.vn",
      }),
      OPENROUTER_TITLE: envField.string({
        context: "server",
        access: "public",
        default: "CNN Legal Assistant",
      }),
      CHAT_ALLOWED_ORIGINS: envField.string({
        context: "server",
        access: "public",
        default: "https://cnnlegal.vn,https://www.cnnlegal.vn,http://localhost:4321",
      }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssCodeSplit: true,
      minify: "esbuild",
    },
    server: {
      watch: {
        ignored: ["!**/src/data/**"],
      },
    },
  },
  compressHTML: true,
  build: {
    inlineStylesheets: "always",
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
});
