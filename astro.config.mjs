import { defineConfig, envField } from "astro/config";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";

// `output: "static"` được giữ nguyên: mọi trang vẫn dựng sẵn thành HTML tĩnh và
// nằm trên CDN của Vercel. Adapter chỉ tồn tại để những route khai báo
// `export const prerender = false` — hiện chỉ có /api/v1/* — được đóng gói thành
// serverless function. Không route nào của giao diện chạm tới nhánh đó, nên chỉ
// số PageSpeed của các trang hiện có không đổi.
export default defineConfig({
  output: "static",
  adapter: vercel({
    // Để mặc định `imageService: false`: ảnh vẫn do Astro tối ưu lúc build và
    // phục vụ từ /_astro. Bật lên là đẩy ảnh qua Image Optimization API của
    // Vercel — đổi hẳn đường phục vụ ảnh và rủi ro tụt điểm LCP.
    // `maxDuration` cố tình không đặt: mỗi gói Vercel có trần khác nhau, khai
    // vượt trần là hỏng deploy. Xem README nếu cần nới thời gian chạy.
  }),
  image: {

    domains: ["img.lsvn.vn"],
  },
  env: {
    schema: {
      // `access: "secret"` ⇒ chỉ đọc lúc chạy từ process.env, không bao giờ bị
      // nhúng vào file build. `optional: true` để thiếu key thì endpoint trả câu
      // xin lỗi tiếng Việt thay vì ném stack trace 500.
      OPENROUTER_API_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      // Các biến dưới đây là `context: "server"` — chúng chỉ đi vào bundle của
      // serverless function. Tuyệt đối không dùng `context: "client"` ở đây, vì
      // biến client bị nhúng vào JS của MỌI trang.
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
      // Proxy sang backend Rust đã bỏ: /api/v1/chat giờ là route Astro thật, nên
      // `astro dev` chạy đúng đoạn mã sẽ chạy trên production. Backend Rust vẫn
      // dùng cho ingest và thử nghiệm truy xuất.
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
