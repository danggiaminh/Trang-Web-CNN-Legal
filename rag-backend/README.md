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
├── config.rs        # đọc env; Debug che api_key
├── state.rs         # AppState: config, reqwest client (pool), sqlite pool, embedder
├── db.rs            # sqlite-vec: đăng ký ext, schema, insert, KNN cosine
├── embed.rs         # client embedding OpenAI-compatible (OpenAI hoặc bge-m3/TEI)
├── chunk.rs         # parse frontmatter + Markdown, cắt chunk theo heading
├── openrouter.rs    # call_openrouter (đúng model/provider) + parse SSE
├── rag.rs           # build_rag_context -> build_prompt
├── error.rs         # lỗi API đã che chi tiết (không lộ ra client)
├── routes.rs        # POST /api/chat (SSE), GET /api/health
├── main.rs          # bin `serve`: axum + rate-limit theo IP
└── bin/ingest.rs    # bin `ingest`: offline, incremental theo updatedAt
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

## Điểm cần bạn xác nhận / lưu ý

- **Model `deepseek/deepseek-v4-flash` + provider `parasail`**: mình dùng **đúng
  chuỗi bạn đưa**, chưa thể xác minh model id này còn tồn tại trên OpenRouter
  (id model thay đổi theo thời gian). Nếu OpenRouter trả 400/404, kiểm tra lại id
  ở dashboard OpenRouter — chỉ cần sửa `OPENROUTER_MODEL` trong `.env`, không đụng code.
- **Nguồn trích dẫn**: `rag.rs` render link dạng `/bai-viet/{slug}`. Vụ án thực
  ra ở `/vu-an-tieu-bieu/{slug}` — nếu cần link đúng cho vụ án, thêm cột `url`
  vào frontmatter + schema (một thay đổi nhỏ, mình có thể làm nếu bạn muốn).
- **serde_yaml** đã deprecated (vẫn chạy tốt). Muốn crate còn bảo trì thì đổi
  sang `serde_yml`.
