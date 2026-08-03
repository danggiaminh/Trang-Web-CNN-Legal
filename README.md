# Trang-Web-CNN-Legal

Trang tĩnh dựng bằng Astro, kèm một endpoint API không giao diện phục vụ trợ lý
hỏi đáp trong bài viết.

## Chạy máy

```bash
npm install
cp .env.example .env      # rồi điền OPENROUTER_API_KEY
npm run dev               # http://localhost:4321
```

Không có `.env` thì trang vẫn chạy bình thường; chỉ ô hỏi đáp trả lời "hệ thống
đang bận".

## API

Endpoint máy-gọi-máy, không có giao diện. Đã chặn khỏi `robots.txt`.

### `POST /api/v1/chat`

Trả lời theo luồng SSE (`text/event-stream`). Mỗi dòng là một JSON:

| Dòng | Nghĩa |
| --- | --- |
| `data: {"t":"..."}` | một mẩu chữ của câu trả lời |
| `data: {"r":1,"m":5}` | đang thử lại lần `r` trên tổng `m` |
| `data: {"e":"..."}` | lỗi cuối cùng, hiển thị nguyên văn cho người dùng |

Thân yêu cầu:

```jsonc
{
  "message": "Luật sư bào chữa cho ai trong vụ này?",  // bắt buộc, ≤ 2000 ký tự
  "slug": "dai-an-van-thinh-phat-giai-doan-1",          // tuỳ chọn, bài đang mở
  "history": [{ "role": "user", "content": "..." }]     // tuỳ chọn, giữ 6 lượt gần nhất
}
```

```bash
curl -N -X POST https://cnnlegal.vn/api/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Tóm tắt bài này giúp mình","slug":"dai-an-van-thinh-phat-giai-doan-1"}'
```

### `GET /api/v1/health`

Kiểm tra biến môi trường đã vào chưa — dùng ngay sau mỗi lần deploy:

```bash
curl -s https://cnnlegal.vn/api/v1/health
# {"ok":true,"keyPresent":true,"docs":33,"sections":133}
```

`keyPresent: false` nghĩa là Vercel chưa thấy `OPENROUTER_API_KEY`. Endpoint chỉ
báo có hay không, không bao giờ trả giá trị khoá.

## Deploy lên Vercel

Khoá **không** đi kèm mã nguồn. Vào **Project Settings → Environment Variables**,
thêm từng biến, tick cả ba môi trường Production / Preview / Development:

| Biến | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | có | đọc lúc chạy, không bị nhúng vào file build |
| `OPENROUTER_MODEL` | không | mặc định `deepseek/deepseek-v4-flash` |
| `OPENROUTER_PROVIDER` | không | ghim nhà cung cấp; để trống thì OpenRouter tự chọn |
| `OPENROUTER_MAX_TOKENS` | không | mặc định `1200` |
| `OPENROUTER_REFERER` | không | mặc định `https://cnnlegal.vn` |
| `OPENROUTER_TITLE` | không | mặc định `CNN Legal Assistant` |
| `CHAT_ALLOWED_ORIGINS` | không | danh sách Origin được gọi, phân cách bằng dấu phẩy |

Đổi bất kỳ biến nào ngoài `OPENROUTER_API_KEY` thì phải deploy lại — chúng được
nhúng vào bundle máy chủ lúc build. Sau khi deploy, gọi `/api/v1/health` để xác
nhận.

## Vì sao thêm API không đụng tới điểm PageSpeed

`output` vẫn là `"static"`. Adapter Vercel chỉ đóng gói những route khai báo
`export const prerender = false` — hiện chỉ có hai file trong `src/pages/api/v1/`.
Mọi trang giao diện vẫn dựng sẵn thành HTML lúc build và nằm trên CDN; trong bảng
route sinh ra, `handle: filesystem` đứng trước mọi thứ nên chúng không bao giờ
chạm tới serverless function.

Đã đo bằng cách so từng byte HTML trước và sau khi thêm adapter: **19/19 trang
giống hệt nhau**. Thay đổi duy nhất trên toàn site là 3 byte trong script của ô
hỏi đáp, do đường dẫn `/api/chat` đổi thành `/api/v1/chat`.

`src/pages/404.astro` tồn tại vì lý do này: thiếu nó, adapter trỏ route bắt-tất-cả
về function và mọi URL sai — phần lớn do bot quét — đều tốn một lượt gọi. Khi sửa
trang đó, chỉ dùng lại class Tailwind đã có ở nơi khác; class mới sẽ làm phình
CSS chung vốn được nhúng thẳng vào mọi trang.

## Chặn đốt hạn mức

Mỗi lượt gọi `/api/v1/chat` đều trừ vào hạn mức OpenRouter, nên có sẵn các chốt:

- câu hỏi vô nghĩa (dưới 3 ký tự, hoặc lặp một ký tự) trả lời sẵn, không gọi model;
- Origin ngoài `CHAT_ALLOWED_ORIGINS` bị từ chối;
- giới hạn 1 lượt/giây, dồn tối đa 6, tính theo IP;
- câu trả lời quá 4000 ký tự hoặc rơi vào vòng lặp lặp chữ thì cắt luồng giữa chừng;
- người dùng đóng tab hoặc hỏi câu mới thì kết nối tới OpenRouter bị đóng ngay.

> **Giới hạn tần suất là gờ giảm tốc, không phải hàng rào.** Đã kiểm chứng hai lỗ
> hổng, cả hai đều không vá được từ trong function: (1) định danh dựa trên header
> chuyển tiếp mà bên gọi tự khai được — gửi mười yêu cầu với `X-Forwarded-For`
> khác nhau thì cả mười đều lọt; (2) bộ đếm nằm trong bộ nhớ từng instance, tải
> rải ra nhiều instance là mỗi chỗ chỉ thấy một phần. Nó chặn được người bấm liên
> tục hoặc script chạy vòng lặp ngây thơ, chứ không chặn được kẻ cố tình.
>
> Muốn chặn cứng thì đặt luật ở **Vercel Firewall → Rate Limiting** cho đường dẫn
> `/api/v1/chat`. Chỗ đó chạy trước function và dùng IP thật.

Nếu câu trả lời dài bị cắt giữa chừng trên production, đó là trần `maxDuration`
của gói Vercel. Bật **Fluid compute** trong project settings, hoặc khai
`maxDuration` trong `vercel()` ở `astro.config.mjs` — nhưng khai vượt trần của gói
thì hỏng deploy.

## Vì sao package.json ghim `path-to-regexp`

```json
"overrides": { "path-to-regexp": "6.3.0" }
```

`@vercel/routing-utils` kéo theo `path-to-regexp@6.1.0`, dính
[GHSA-9wv6-86v2-598j](https://github.com/advisories/GHSA-9wv6-86v2-598j) — regex
sinh ra có backtracking, mở đường cho ReDoS. Không gỡ được bằng cách nâng cấp:
bản `@vercel/routing-utils` mới nhất vẫn khai đúng hai phụ thuộc đó, vì Vercel
đang chạy song song bản vá `6.3.0` dưới bí danh `path-to-regexp-updated` chỉ để
ghi log khác biệt, còn kết quả thật vẫn lấy từ `6.1.0`.

Nên ghim thẳng lên `6.3.0` — đúng bản mà Vercel vốn đã chạy song song. Đã kiểm
chứng sau khi ghim: `npm audit` sạch, `.vercel/output/config.json` sinh ra **giống
hệt từng byte**, 20/20 trang HTML **giống hệt từng byte**, build không phát cảnh
báo `[vc] PATH TO REGEXP PATH DIFF`. Tức luật định tuyến không đổi.

Đừng chạy `npm audit fix --force`: nó hạ `@astrojs/vercel` xuống v8, vốn không
chạy được Astro 7.

## Kho tri thức

Trợ lý đọc thẳng từ `src/data/articles.ts` và `src/data/cases.ts`, đúng nguồn mà
các trang đang hiển thị, nên không có chuyện hai bên lệch nhau. Thêm bài mới vào
`src/data` là trợ lý biết ngay sau lần deploy kế tiếp, không cần bước nạp riêng.

Thư mục `src/content/articles/` **không** liên quan tới endpoint này. Nó nằm trong
`.gitignore`, sinh ra bởi `rag-backend/scripts/export-content.mjs`, và chỉ dùng cho
backend Rust.

## Backend Rust (`rag-backend/`)

Bản truy xuất đầy đủ, có embedding và tìm kiếm vector bằng sqlite-vec. Không tham
gia vào đường chạy production của trang web — giữ lại để nạp dữ liệu và thử nghiệm
chất lượng truy xuất. Cấu hình riêng ở `rag-backend/.env`.
