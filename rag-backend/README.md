# CNN Legal — RAG backend (Rust / axum)

Trợ lý AI trả lời câu hỏi pháp lý dựa trên bài viết CNN Legal.
Ingest offline → sqlite-vec → truy xuất top-k → OpenRouter (streaming) → SSE.

> ⚠️ **Khác biệt với mô tả ban đầu** (đã xử lý):
> 1. Repo **chưa có** service axum nào — thư mục `rag-backend/` này là backend
>    Rust **mới**, độc lập với app Astro.
> 2. Bài viết hiện nằm trong `src/data/articles.ts` + `cases.ts`, **không phải**
>    content collection `.md`. Script `scripts/export-content.mjs` xuất chúng ra
>    `src/content/articles/*.md` để pipeline có dữ liệu thật. Về lâu dài nên soạn
>    bài trực tiếp dưới dạng `.md` (chuẩn Astro content collection).
> 3. App Astro build **tĩnh** (host-agnostic, không còn phụ thuộc Vercel); backend
>    này chạy sau **Nginx** (xem dưới).

---

## Kiến trúc

```
src/
├── lib.rs           # khai báo module + SYSTEM_PROMPT_TEMPLATE (cố định)
├── config.rs        # đọc env; Debug che api_key + ingest_secret
├── state.rs         # AppState: config, reqwest client, sqlite pool, embedder, ingest_lock
├── db.rs            # sqlite-vec: schema (source/url), insert, KNN cosine, delete theo doc
├── embed.rs         # client embedding OpenAI-compatible (OpenAI hoặc bge-m3/TEI)
├── chunk.rs         # cắt Markdown thành chunk theo heading (dùng chung)
├── html.rs          # HTML → Markdown thô (nội dung bài CMS) — không thêm dep, có unit test
├── pipeline.rs      # IngestDoc + store_doc: LÕI ingest dùng chung (file & CMS push)
├── openrouter.rs    # call_openrouter (đúng model/provider) + parse SSE
├── rag.rs           # build_rag_context -> build_prompt (trích dẫn nguồn theo url thật)
├── error.rs         # lỗi API đã che chi tiết (không lộ ra client)
├── routes.rs        # POST /api/chat (SSE), /api/ingest, /api/ingest/delete, GET /api/health
├── main.rs          # bin `serve`: axum + rate-limit /api/chat; /api/ingest xác thực secret
└── bin/ingest.rs    # bin `ingest`: nạp file .md cục bộ (nguồn "file") qua cùng store_doc
```

Tách hàm đúng yêu cầu: `build_rag_context()` → `build_prompt()` →
`call_openrouter()` → `stream_response()` (SSE trong `routes::chat`).

**Bảo mật đã kiểm thử runtime:**
- `OPENROUTER_API_KEY` chỉ ở header `Authorization`; `Debug` của `Config` in
  `***redacted***`; không có tiền tố `PUBLIC_/VITE_` nên không lọt bundle frontend.
- Lỗi nội bộ → body generic (`{"error":"Hệ thống đang bận..."}`), chi tiết chỉ
  vào log server. Đã test: không rò `endpoint / path / sqlite / refused`.
- Rate limit theo IP (tower-governor). Câu hỏi trống → 400; quá dài → 400.

---

## Cài đặt & chạy

### 0. Phụ thuộc hệ thống
sqlite-vec được **biên dịch tĩnh** vào binary qua crate `sqlite-vec` + rusqlite
`bundled` — **không cần** cài SQLite hệ thống hay `.load` extension thủ công.

### 1. Chuẩn bị dữ liệu (.md)
```bash
# Bridge: xuất articles.ts + cases.ts hiện có ra Markdown.
npm i -D tsx                     # nếu chưa có
cd rag-backend
npx tsx scripts/export-content.mjs      # -> ../src/content/articles/*.md
```

### 2. Cấu hình
```bash
cp .env.example .env
# Điền OPENROUTER_API_KEY. Chọn embedding:
#   - bge-m3 self-host (khuyên dùng cho tiếng Việt): chạy HuggingFace TEI,
#     EMBED_BASE_URL=http://127.0.0.1:8080/v1  EMBED_MODEL=bge-m3  EMBED_DIM=1024
#   - hoặc OpenAI: EMBED_BASE_URL=https://api.openai.com/v1
#     EMBED_MODEL=text-embedding-3-small  EMBED_DIM=1536  EMBED_API_KEY=sk-...
```
> Đổi model embedding ⇒ đổi `EMBED_DIM` ⇒ **phải xoá DB và ingest lại** (số chiều
> vec0 cố định lúc tạo bảng).

### 3. Ingest (offline)
```bash
cargo run --release --bin ingest              # chỉ bài mới/mới hơn
cargo run --release --bin ingest -- --force   # ingest lại tất cả
cargo run --release --bin ingest -- --prune   # xoá bài không còn file
```

### 4. Chạy service
```bash
cargo run --release --bin serve               # nghe 127.0.0.1:8787
```

---

## Nạp liệu real-time từ WordPress / Ghost (PUSH)

**Mô hình PUSH.** RAG mở một endpoint nhận nội dung **đã chuẩn hoá**; phía CMS
(glue của bạn) gọi vào đó mỗi khi luật sư publish/sửa/gỡ bài. RAG **không** chứa
client WordPress/Ghost → CMS-agnostic, dễ kiểm thử, đúng ranh giới bàn giao
(RAG một phía, code CMS một phía).

> ⚠️ **Đổi schema:** bản này thêm cột `source`, `url` vào `chunks` và khoá
> `(source, slug)` cho `ingest_state`. Có di trú nhẹ (ALTER) cho DB cũ, nhưng
> khuyến nghị **xoá DB + ingest lại** khi nâng cấp (giống lưu ý đổi `EMBED_DIM`).

### `POST /api/ingest` — nạp/cập nhật một bài

- **Bật & xác thực:** đặt `INGEST_SECRET` trong `.env`. Chưa đặt ⇒ endpoint trả
  **404** (tắt hẳn). Gửi kèm `Authorization: Bearer <INGEST_SECRET>` (hoặc header
  `X-Ingest-Secret`); sai/thiếu ⇒ **401**.
- **Body JSON:**

  | field | bắt buộc | ý nghĩa |
  |---|---|---|
  | `slug` | ✅ | = slug trang trên website (AskBox gửi lên khi hỏi "bài này") |
  | `html` **hoặc** `markdown` | ✅ (một trong hai) | nội dung bài. Có `markdown` thì ưu tiên (chất lượng cao hơn); `html` sẽ được đổi sang markdown thô. |
  | `title` | – | mặc định = slug |
  | `category` | – | lĩnh vực (Hình sự / Dân sự / …) |
  | `url` | – | URL công khai của bài — dùng để **trích dẫn nguồn** cho người đọc |
  | `updated_at` | – | RFC3339 (`2025-09-28T10:00:00Z`). Incremental: không mới hơn bản trong kho ⇒ bỏ qua. Nhận cả alias `updatedAt`/`modified`/`updated`. |
  | `source` | – | `"wordpress"` \| `"ghost"` \| … (mặc định `"cms"`) — namespacing & gỡ đúng nguồn |
  | `force` | – | `true` ⇒ ép nạp lại kể cả không mới hơn |

- **Trả về:** `{"status":"ingested","slug":…,"chunks":N}` /
  `{"status":"skipped",…}` (không mới hơn) / `{"status":"empty",…}` (không tách
  được chunk). **Idempotent** — gọi lại cùng nội dung ⇒ thay thế sạch, không nhân đôi.

```bash
curl -X POST http://127.0.0.1:8787/api/ingest \
  -H "Authorization: Bearer $INGEST_SECRET" -H "Content-Type: application/json" \
  -d '{"source":"wordpress","slug":"luat-dat-dai-2025",
       "title":"Luật Đất đai 2025","category":"Dân sự",
       "url":"https://cnnlegal.vn/bai-viet/luat-dat-dai-2025",
       "updated_at":"2025-09-28T10:00:00Z",
       "html":"<h2>Điểm mới</h2><p>Cơ chế thu hồi đất…</p>"}'
```

### `POST /api/ingest/delete` — gỡ bài (khi unpublish/xoá)
```bash
curl -X POST http://127.0.0.1:8787/api/ingest/delete \
  -H "Authorization: Bearer $INGEST_SECRET" -H "Content-Type: application/json" \
  -d '{"source":"wordpress","slug":"luat-dat-dai-2025"}'
```

### Glue phía CMS (phần dev CMS phụ trách)

> ⚠️ **Các đoạn dưới là THAM KHẢO — CHƯA kiểm thử với WordPress/Ghost thật.**
> Lõi RAG (`/api/ingest`) đã được test runtime end-to-end (auth 401/404,
> HTML→markdown→chunk→embed→store, incremental skip, delete). Phần glue này cần
> dev CMS kiểm thử trên môi trường thật.

**WordPress** — WP **không có webhook gốc**; dùng `mu-plugin` hook
`transition_post_status` (đặt `wp-content/mu-plugins/cnn-rag.php`):

```php
<?php // mu-plugins/cnn-rag.php — đẩy bài sang RAG khi publish/sửa/gỡ.
add_action('transition_post_status', function ($new, $old, $post) {
    if ($post->post_type !== 'post') return;         // đổi nếu "dự án" là custom post type
    $url = getenv('CNN_RAG_URL'); $secret = getenv('CNN_RAG_SECRET');
    $h = ['Authorization' => "Bearer $secret", 'Content-Type' => 'application/json'];
    if ($new === 'publish') {
        $cats = wp_get_post_categories($post->ID, ['fields' => 'names']);
        wp_remote_post("$url/api/ingest", ['headers' => $h, 'timeout' => 20, 'body' => wp_json_encode([
            'source' => 'wordpress', 'slug' => $post->post_name,
            'title' => get_the_title($post), 'category' => $cats[0] ?? '',
            'url' => get_permalink($post),
            'updated_at' => get_post_modified_time('c', true, $post),  // ISO 8601
            'html' => apply_filters('the_content', $post->post_content),
        ])]);
    } elseif ($old === 'publish') {                  // publish -> draft/trash = gỡ
        wp_remote_post("$url/api/ingest/delete", ['headers' => $h, 'timeout' => 20,
            'body' => wp_json_encode(['source' => 'wordpress', 'slug' => $post->post_name])]);
    }
}, 10, 3);
```

**Ghost** — Ghost **có webhook** nhưng payload theo định dạng riêng và không gắn
sẵn secret của bạn → cần một bộ chuyển tiếp nhỏ (serverless/worker) map payload
sang body chuẩn + thêm header auth:

```js
// Cloudflare Worker / Node: nhận webhook Ghost -> POST /api/ingest
export default async function (req) {
  const { post } = await req.json();               // Ghost: { post: { current, previous } }
  const p = post.current;
  const gone = !p || p.status !== 'published';     // unpublished/deleted
  const body = gone
    ? { source: 'ghost', slug: post.previous?.slug || p?.slug }
    : { source: 'ghost', slug: p.slug, title: p.title,
        category: p.primary_tag?.name || '', url: p.url,
        updated_at: p.updated_at, html: p.html };
  await fetch(`${RAG_URL}/api/ingest${gone ? '/delete' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RAG_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return new Response('ok');
}
```
> Ghost Admin → **Settings → Integrations → Custom integration → Add webhook**
> cho các event *Post published / updated / unpublished / deleted*, trỏ tới URL worker.

### Backfill & file cục bộ
- **Backfill lần đầu:** dev CMS lặp qua mọi bài đã publish và gọi `/api/ingest`
  cho từng bài (script chạy một lần). RAG incremental nên chạy lại vô hại.
- **File `.md` vẫn dùng được:** `cargo run --release --bin ingest` nạp file cục
  bộ (nguồn `"file"`) qua **cùng** `store_doc`. Prune của bin `ingest` **chỉ**
  đụng nguồn `"file"`, không bao giờ xoá nội dung CMS đã push.

---

## Nginx (reverse proxy + SSE)

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;

    # SSE: tắt buffering để token tới ngay.
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;

    # Rate-limit theo IP dùng SmartIpKeyExtractor -> PHẢI set header này,
    # và CHỈ tin proxy nội bộ (đừng để client tự giả X-Forwarded-For).
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
}
```
> Nếu không đặt sau proxy tin cậy, đổi `SmartIpKeyExtractor` →
> `PeerIpKeyExtractor` trong `main.rs` để lấy IP thật của kết nối.

---

## Lịch re-ingest (hook vào CI/CD build Astro)

Bài viết luật không đổi liên tục ⇒ không cần watch realtime. Chạy `ingest` mỗi
lần deploy bài mới:

**a) Trong pipeline build (khuyên dùng):**
```yaml
# ví dụ GitHub Actions — thêm sau bước build Astro
- name: Export content -> markdown
  run: cd rag-backend && npx tsx scripts/export-content.mjs
- name: Re-ingest RAG
  run: cd rag-backend && cargo run --release --bin ingest
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    EMBED_BASE_URL: ${{ secrets.EMBED_BASE_URL }}
    EMBED_MODEL: ${{ vars.EMBED_MODEL }}
    EMBED_DIM: ${{ vars.EMBED_DIM }}
    DB_PATH: /srv/cnn-rag/data/cnn_rag.db
    CONTENT_DIR: ./_content    # hoặc đường dẫn tới src/content/articles đã export
```

**b) Cron dự phòng (nếu deploy thủ công):**
```cron
# /etc/cron.d/cnn-rag  — 02:00 mỗi ngày, chỉ ingest bài mới hơn
0 2 * * *  deploy  cd /srv/cnn-rag && ./ingest >> /var/log/cnn-rag-ingest.log 2>&1
```
`ingest` là **incremental** (so `updatedAt` với bảng `ingest_state`) nên chạy lại
nhiều lần rất rẻ — chỉ bài mới/sửa mới bị re-embed.

---

## Nối với frontend (AskBox.astro)

Component `AskBox` đã có sẵn hàm `askQuestion(question)`. Thay phần gọi bằng:

```js
async function askQuestion(question) {
  openPanel();
  addUserMessage(question);
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question }),
  });
  // Đọc SSE thủ công (fetch stream) để hiển thị token dần.
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", answerEl = addAssistantMessage("");
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith("data:")) answerEl.textContent += line.slice(5).trim();
    }
  }
}
```

---

## Đã kiểm thử (trong lúc build)

- `cargo check` / `cargo build`: **pass**, 0 warning; cả 2 binary link được
  (SQLite bundled + sqlite-vec biên dịch tĩnh).
- Boot server → `GET /api/health` = `{"status":"ok"}`; 3 bảng (`chunks`,
  `vec_chunks` vec0 cosine, `ingest_state`) tạo đúng ở **runtime**.
- E2E với embedding + OpenRouter giả: ingest 2 file `.md` → 3 chunk → truy vấn
  `POST /api/chat` trả về stream SSE **"Đã nhận 3 tài liệu tham khảo"** ⇒ toàn bộ
  đường đi (chunk → embed → sqlite-vec insert/KNN → prompt → stream) chạy thật.
- Bảo mật: 500 → body generic, không rò chi tiết; câu hỏi trống → 400; rate-limit
  trả 429 sau burst. `api_key` bị che trong log.
- **Ingest push (`/api/ingest`) — test runtime end-to-end** (embed giả 8 chiều):
  thiếu/sai secret → **401**; đúng secret + `html` → **200 `ingested`** (HTML đổi
  sang markdown, giữ heading); push lại không mới hơn → **`skipped`**; DB lưu đúng
  `source`+`url`; `/api/ingest/delete` → xoá sạch chunk. `html.rs`: **4/4 unit test pass**.

## Điểm cần bạn xác nhận / lưu ý

- **Model `deepseek/deepseek-v4-flash` + provider `parasail`**: mình dùng **đúng
  chuỗi bạn đưa**, chưa thể xác minh model id này còn tồn tại trên OpenRouter
  (id model thay đổi theo thời gian). Nếu OpenRouter trả 400/404, kiểm tra lại id
  ở dashboard OpenRouter — chỉ cần sửa `OPENROUTER_MODEL` trong `.env`, không đụng code.
- **Nguồn trích dẫn**: ✅ đã sửa tổng quát — `chunks` có cột `url`, `rag.rs`
  trích dẫn theo URL thật của bài (WP/Ghost gửi lên). Dữ liệu cũ/file không có
  `url` thì fallback về `/bai-viet/{slug}` như trước.
- **Glue phía CMS CHƯA test với WP/Ghost thật** (xem cảnh báo ở mục "Glue phía
  CMS"): mu-plugin WordPress và worker chuyển tiếp Ghost là mã tham khảo, dev CMS
  cần chạy thử trên môi trường thật. Lõi RAG `/api/ingest` thì đã test runtime.
- **`html.rs` là bộ chuyển HTML→Markdown thô** (không thêm dependency), đủ cho
  việc cắt chunk. Muốn chất lượng cao hơn thì phía CMS gửi thẳng `markdown` (được
  ưu tiên), hoặc thay `html.rs` bằng crate parser HTML đầy đủ.
- **serde_yaml** đã deprecated (vẫn chạy tốt). Muốn crate còn bảo trì thì đổi
  sang `serde_yml`.
