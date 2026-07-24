use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("rate limited")]
    RateLimited,

    #[error("internal error")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {

        let (status, client_msg) = match &self {
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.as_str()),
            ApiError::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                "Bạn thao tác quá nhanh, vui lòng thử lại sau giây lát.",
            ),
            ApiError::Internal(err) => {

                tracing::error!(error = ?err, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Hệ thống đang bận, vui lòng thử lại sau.",
                )
            }
        };
        (status, Json(json!({ "error": client_msg }))).into_response()
    }
}
