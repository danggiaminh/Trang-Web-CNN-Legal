use crate::{
    error::ApiError,
    openrouter::{call_openrouter, retry_after_ms, stream_content},
    rag::prepare_messages,
    state::AppState,
};
use axum::{
    extract::State,
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
