use crate::{
    config::Config,
    db::delete_doc,
    error::ApiError,
    openrouter::{call_openrouter, retry_after_ms, stream_content},
    pipeline::{store_doc, IngestDoc, StoreOutcome},
    rag::prepare_messages,
    state::AppState,
};
use anyhow::Context;
use axum::{
    extract::State,
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
    response::IntoResponse,
    Json,
};
use futures_util::{Stream, StreamExt};
use serde::Deserialize;
use serde_json::json;
use std::convert::Infallible;

const MAX_QUESTION_CHARS: usize = 2000;
const MAX_SLUG_CHARS: usize = 200;
const MAX_RETRIES: u32 = 5;
const BUSY_MSG: &str = "Xin lỗi hệ thống đang bận, vui lòng thử lại sau.";

fn sse(payload: serde_json::Value) -> Result<Event, Infallible> {
    Ok(Event::default().data(payload.to_string()))
}

#[derive(Deserialize)]
pub struct ChatBody {

    pub message: String,

    #[serde(default)]
    pub slug: Option<String>,
}

pub async fn health() -> impl IntoResponse {

    Json(serde_json::json!({ "status": "ok" }))
}

pub async fn chat(
    State(state): State<AppState>,
    Json(body): Json<ChatBody>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let question = body.message.trim().to_string();
    if question.is_empty() {
        return Err(ApiError::BadRequest("Câu hỏi trống.".into()));
    }
    if question.chars().count() > MAX_QUESTION_CHARS {
        return Err(ApiError::BadRequest("Câu hỏi quá dài.".into()));
    }

    let slug = body.slug.as_deref().map(str::trim).filter(|s| {
        !s.is_empty()
            && s.len() <= MAX_SLUG_CHARS
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    });

    let messages = prepare_messages(&state, &question, slug).await?;

    let http = state.http().clone();
    let cfg = state.config().clone();

    let stream = async_stream::stream! {
        let mut attempt = 0u32;
        loop {
            let resp = match call_openrouter(&http, &cfg, &messages).await {
                Ok(r) => r,
                Err(err) => {
                    tracing::error!(error = ?err, "gọi OpenRouter thất bại");
                    yield sse(json!({ "e": BUSY_MSG }));
                    return;
                }
            };

            let status = resp.status();
            if status.is_success() {
                let mut toks = std::pin::pin!(stream_content(resp));
                while let Some(item) = toks.next().await {
                    match item {
                        Ok(tok) => yield sse(json!({ "t": tok })),
                        Err(err) => {
                            tracing::error!(error = ?err, "lỗi khi stream từ OpenRouter");
                            yield sse(json!({ "e": BUSY_MSG }));
                            return;
                        }
                    }
                }
                return;
            }

            if status.as_u16() == 429 {
                attempt += 1;
                if attempt <= MAX_RETRIES {
                    let wait = retry_after_ms(&resp, attempt);
                    tracing::warn!("OpenRouter 429, thử lại {}/{}", attempt, MAX_RETRIES);
                    yield sse(json!({ "r": attempt, "m": MAX_RETRIES }));
                    tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
                    continue;
                }
                tracing::error!("OpenRouter 429 sau {} lần thử", MAX_RETRIES);
                yield sse(json!({ "e": BUSY_MSG }));
                return;
            }

            tracing::error!(status = ?status, "OpenRouter trả lỗi");
            yield sse(json!({ "e": BUSY_MSG }));
            return;
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ───────────────────────── Ingest (CMS push) ─────────────────────────
// WordPress/Ghost đẩy nội dung bài ĐÃ CHUẨN HOÁ vào đây khi luật sư
// publish/sửa/gỡ bài. Bảo vệ bằng INGEST_SECRET; chưa đặt secret => tắt (404).
// Body: { slug, title?, category?, url?, updated_at?, html? | markdown?, source?, force? }

const MAX_CONTENT_CHARS: usize = 400_000;

#[derive(Deserialize)]
pub struct IngestBody {
    #[serde(default)]
    pub source: Option<String>,
    pub slug: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default, alias = "updatedAt", alias = "modified", alias = "updated")]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub html: Option<String>,
    #[serde(default)]
    pub markdown: Option<String>,
    #[serde(default)]
    pub force: bool,
}

#[derive(Deserialize)]
pub struct DeleteBody {
    #[serde(default)]
    pub source: Option<String>,
    pub slug: String,
}

/// So sánh bí mật theo thời gian gần như hằng số (giảm rò rỉ qua timing).
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Xác thực ingest bằng INGEST_SECRET (`Authorization: Bearer …` hoặc header
/// `X-Ingest-Secret`). Chưa cấu hình secret => coi như endpoint không tồn tại.
fn check_ingest_auth(cfg: &Config, headers: &HeaderMap) -> Result<(), ApiError> {
    let Some(expected) = cfg.ingest_secret.as_deref() else {
        return Err(ApiError::NotFound);
    };
    let provided = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer ").or_else(|| s.strip_prefix("bearer ")))
        .or_else(|| headers.get("x-ingest-secret").and_then(|v| v.to_str().ok()));

    match provided {
        Some(tok) if ct_eq(tok.as_bytes(), expected.as_bytes()) => Ok(()),
        _ => Err(ApiError::Unauthorized),
    }
}

fn clean_slug(raw: &str) -> Result<String, ApiError> {
    let slug = raw.trim().to_string();
    if slug.is_empty() {
        return Err(ApiError::BadRequest("thiếu slug".into()));
    }
    if slug.chars().count() > MAX_SLUG_CHARS || slug.contains('/') {
        return Err(ApiError::BadRequest("slug không hợp lệ".into()));
    }
    Ok(slug)
}

/// POST /api/ingest — nạp/cập nhật một bài. Idempotent + incremental theo
/// `updated_at` (gửi `force: true` để ép nạp lại).
pub async fn ingest(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<IngestBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_ingest_auth(state.config(), &headers)?;

    let slug = clean_slug(&body.slug)?;
    let source = body
        .source
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "cms".to_string());
    let title = body
        .title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| slug.clone());
    let category = body.category.unwrap_or_default();
    let url = body.url.unwrap_or_default();
    let updated_at = body.updated_at.unwrap_or_default();

    let doc = match (body.markdown.as_deref(), body.html.as_deref()) {
        (Some(md), _) if !md.trim().is_empty() => {
            if md.chars().count() > MAX_CONTENT_CHARS {
                return Err(ApiError::BadRequest("nội dung quá dài".into()));
            }
            IngestDoc::from_markdown(source, slug.clone(), title, category, url, updated_at, md)
        }
        (_, Some(html)) if !html.trim().is_empty() => {
            if html.chars().count() > MAX_CONTENT_CHARS {
                return Err(ApiError::BadRequest("nội dung quá dài".into()));
            }
            IngestDoc::from_html(source, slug.clone(), title, category, url, updated_at, html)
        }
        _ => return Err(ApiError::BadRequest("cần 'html' hoặc 'markdown'".into())),
    };

    // Nối tiếp hoá các lần ingest để hai webhook đến cùng lúc không dẫm nhau.
    let _guard = state.ingest_lock().lock().await;
    let outcome = store_doc(
        state.pool(),
        state.embedder(),
        state.config().embed_dim,
        &doc,
        body.force,
    )
    .await?;

    let status = match outcome {
        StoreOutcome::Ingested { chunks } => {
            tracing::info!(%slug, chunks, "ingest ok");
            json!({ "status": "ingested", "slug": slug, "chunks": chunks })
        }
        StoreOutcome::Skipped => json!({ "status": "skipped", "slug": slug }),
        StoreOutcome::Empty => json!({ "status": "empty", "slug": slug }),
    };
    Ok(Json(status))
}

/// POST /api/ingest/delete — gỡ một bài khỏi kho (khi CMS unpublish/xoá).
pub async fn ingest_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<DeleteBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_ingest_auth(state.config(), &headers)?;
    let slug = clean_slug(&body.slug)?;

    let _guard = state.ingest_lock().lock().await;
    let conn = state.pool().get().context("lấy kết nối DB")?;
    delete_doc(&conn, body.source.as_deref(), &slug)?;
    tracing::info!(%slug, "ingest delete ok");
    Ok(Json(json!({ "status": "deleted", "slug": slug })))
}
