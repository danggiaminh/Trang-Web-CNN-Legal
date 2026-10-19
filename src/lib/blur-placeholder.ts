import sharp from "sharp";

// Ảnh xem trước cho ảnh đầu trang: chính ảnh đó thu về cạnh dài 32px, làm mờ sẵn rồi nhúng
// thẳng vào HTML (~0,3–0,5 KB). Nó hiện ngay khung hình đầu cùng với chữ; ảnh thật tải xong
// thì vẽ đè lên. Trước đây khung ảnh chỉ có nền màu phẳng nên trang hiện trước, ảnh "bật" ra
// sau 0,4–1 s (đo 4G điện thoại). Làm mờ lúc build chứ không dùng bộ lọc SVG lúc chạy: bộ lọc
// phải tính lại mỗi lần vẽ lại banner, đo trên desktop ảnh thật hiện chậm thêm ~45 ms.
// WebP q80 vì ở q40 phóng to lên thấy rõ ô vuông nén. Trả về giá trị url(...) cho background-image.
// Ảnh gốc 3840px mất ~200 ms mỗi lần nên nhớ kết quả: banner dịch vụ dùng chung cho 5 trang.
const cache = new Map<string, Promise<string>>();

/** `image`: ảnh import trong frontmatter, hoặc đường dẫn ảnh trong public/ ("/images/…"). */
export function blurPlaceholder(image: ImageMetadata | string): Promise<string> {
  // Ảnh import mang fsPath, thuộc tính ẩn Astro dùng để đọc file gốc.
  const file = typeof image === "string" ? `public${image}` : (image as ImageMetadata & { fsPath: string }).fsPath;
  let result = cache.get(file);
  if (!result) cache.set(file, (result = render(file)));
  return result;
}

async function render(file: string): Promise<string> {
  const data = await sharp(file, { autoOrient: true })
    .resize(32, 32, { fit: "inside" })
    .blur(1)
    .webp({ quality: 80 })
    .toBuffer();
  return `url(data:image/webp;base64,${data.toString("base64")})`;
}
