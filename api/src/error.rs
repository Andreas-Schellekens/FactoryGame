//! One error type for every handler: a status and a short English message for the game's UI.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
    pub extra: Option<serde_json::Value>,
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into(), extra: None }
    }
    pub fn bad(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }
    pub fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "Not signed in")
    }
    pub fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "Not found")
    }
    pub fn too_many(message: impl Into<String>) -> Self {
        Self::new(StatusCode::TOO_MANY_REQUESTS, message)
    }
    pub fn with(mut self, extra: serde_json::Value) -> Self {
        self.extra = Some(extra);
        self
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut body = json!({ "error": self.message });
        if let (Some(extra), Some(obj)) = (self.extra, body.as_object_mut()) {
            if let Some(more) = extra.as_object() {
                for (k, v) in more {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
        (self.status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        eprintln!("database error: {e}");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
    }
}
