import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  image: {
    // Ảnh minh hoạ bài viết được nạp từ img.lsvn.vn và tối ưu tại thời điểm build.
    domains: ["img.lsvn.vn"],
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
      proxy: {
        "/api/chat": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true,
        },
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
