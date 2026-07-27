import type { APIRoute } from "astro";
import { articles } from "../data/articles";
import { notableCases } from "../data/cases";
import { services } from "../data/services";
import { navigationItems } from "../data/navigation";

type Entry = {
  t: string;
  d: string;
  u: string;
  /** Nhãn lĩnh vực hiện bên phải mỗi dòng (Hình sự, Dân sự…). */
  g: string;
  /** Loại nội dung, dùng để gom nhóm trong menu. */
  k: "Trang" | "Dịch vụ" | "Bài viết" | "Vụ án";
};

const trim = (s: string, n = 120) => {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n).trimEnd() + "…" : clean;
};

export const GET: APIRoute = () => {
  const entries: Entry[] = [
    ...navigationItems.map((n) => ({
      t: n.label,
      d: "",
      u: n.href,
      g: "Trang",
      k: "Trang" as const,
    })),
    { t: "Liên hệ", d: "", u: "/lien-he/", g: "Trang", k: "Trang" as const },

    ...services.map((s) => ({
      t: s.title,
      d: trim(s.summary),
      u: `/dich-vu/${s.slug}/`,
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
