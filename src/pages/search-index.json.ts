import type { APIRoute } from "astro";
import { articles, externalArticles } from "../data/articles";
import { notableCases } from "../data/cases";
import { services } from "../data/services";

type Entry = {
  t: string;
  d: string;
  u: string;
  /** Nhãn lĩnh vực hiện bên phải mỗi dòng (Hình sự, Dân sự…). */
  g: string;
  /** Loại nội dung, dùng để gom nhóm trong menu. */
  k: "Dịch vụ" | "Bài viết" | "Vụ án";
};

const trim = (s: string, n = 120) => {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n).trimEnd() + "…" : clean;
};

export const GET: APIRoute = () => {
  // Chỉ mục chỉ chứa NỘI DUNG. Các mục điều hướng (Giới thiệu, Liên hệ, trang
  // danh sách của từng nhánh) do `buildTree` trong Search.astro dựng cứng, nên
  // đưa vào đây chỉ làm phình tệp mà không bao giờ hiển thị.
  const entries: Entry[] = [
    ...services.map((s) => ({
      t: s.title,
      d: trim(s.summary),
      // Không còn trang chi tiết dịch vụ nên trỏ chung về trang Dịch vụ.
      u: "/dich-vu/",
      g: "Dịch vụ",
      k: "Dịch vụ" as const,
    })),

    ...articles.map((a) => ({
      t: a.title,
      d: trim(a.excerpt),
      u: `/bai-viet/${a.slug}/`,
      g: a.category || "Bài viết",
      k: "Bài viết" as const,
    })),

    // Bài đăng báo ngoài: `u` là đường dẫn tuyệt đối nên `kindOf` không suy được
    // loại từ tiền tố — phải dựa vào `k`. Ghi tên báo vào mô tả để người dùng
    // biết trước là sẽ rời khỏi trang.
    ...externalArticles.map((a) => ({
      t: a.title,
      d: trim(`${a.sourceName} · ${a.summary}`),
      u: a.sourceUrl,
      g: a.category || "Bài viết",
      k: "Bài viết" as const,
    })),

    ...notableCases.map((c) => ({
      t: c.title,
      d: trim(c.summary || c.charge),
      u: `/vu-an-tieu-bieu/${c.slug}/`,
      g: c.category || "Vụ án",
      k: "Vụ án" as const,
    })),
  ];

  return new Response(JSON.stringify(entries), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Chỉ mục đổi theo mỗi lần deploy. Đặt max-age dài sẽ khiến trình duyệt
      // giữ bản cũ tới hàng giờ — đổi cấu trúc dữ liệu là menu hỏng câm lặng.
      // no-cache vẫn cho phép cache nhưng buộc kiểm lại; khớp ETag thì trả 304.
      "Cache-Control": "no-cache",
    },
  });
};
