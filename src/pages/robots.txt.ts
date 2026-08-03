import { site } from "../data/site";

export function GET() {
  const body = [
    "User-agent: *",
    "Allow: /",
    // Endpoint máy-gọi-máy, không có nội dung để lập chỉ mục. Mỗi lượt bot gọi
    // vào đây là một lượt tính tiền OpenRouter.
    "Disallow: /api/",
    `Sitemap: ${new URL("/sitemap.xml", site.canonicalBaseUrl).toString()}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
