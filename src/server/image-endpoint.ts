import type { APIRoute } from "astro";

// Thay endpoint /_image mặc định của Astro (cấu hình ở astro.config.mjs). Mọi ảnh của site đã
// được tạo sẵn trong /_astro lúc build, nên production không cần biến đổi ảnh theo yêu cầu: bản
// mặc định nhận tham số tuỳ ý (w, q, f…), mỗi bộ tham số mới tốn tới vài chục giây CPU của
// function. Ở đây production trả 404 ngay, không đọc, tải hay xử lý gì. Chỉ astro dev còn dùng
// /_image để hiện ảnh; import động nằm trong nhánh DEV nên bản build bỏ hẳn mã xử lý ảnh.
export const GET: APIRoute = async (context) => {
  if (import.meta.env.DEV) {
    const { GET: devEndpoint } = await import("astro/assets/endpoint/dev");
    return devEndpoint(context);
  }
  return new Response(null, { status: 404 });
};
