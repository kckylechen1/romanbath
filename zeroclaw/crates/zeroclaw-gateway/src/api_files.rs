//! Serve generated images and audio files from the workspace.
//!
//! `GET /api/files/{*path}` — serves files from `<workspace>/images/` and
//! `<workspace>/audio/` subdirectories only. Auth required.

use super::AppState;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
};
use tokio::fs;

static ALLOWED_SUBDIRS: &[&str] = &["images", "audio", "videos"];

fn mime_for_path(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

pub async fn handle_serve_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(file_path): Path<String>,
) -> impl IntoResponse {
    // Auth
    if state.pairing.require_pairing() {
        let token = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|auth| auth.strip_prefix("Bearer "))
            .unwrap_or("");
        if !state.pairing.is_authenticated(token) {
            return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
        }
    }

    // Validate the path starts with an allowed subdir
    let path = std::path::Path::new(&file_path);
    let first_component = path.components().next();
    let allowed = match first_component {
        Some(std::path::Component::Normal(c)) => c
            .to_str()
            .map(|s| ALLOWED_SUBDIRS.contains(&s))
            .unwrap_or(false),
        _ => false,
    };
    if !allowed {
        return (StatusCode::FORBIDDEN, "Path outside allowed directories").into_response();
    }

    // Clone data_dir while holding the lock, release before any await
    let base = {
        let config = state.config.read();
        std::path::PathBuf::from(&config.data_dir)
    };
    let full_path = base.join(path);

    // Canonicalize to prevent traversal
    let canonical = match fs::canonicalize(&full_path).await {
        Ok(p) => p,
        Err(_) => return (StatusCode::NOT_FOUND, "File not found").into_response(),
    };
    let canonical_base = match fs::canonicalize(&base).await {
        Ok(p) => p,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Workspace error").into_response(),
    };
    if !canonical.starts_with(&canonical_base) {
        return (StatusCode::FORBIDDEN, "Path traversal denied").into_response();
    }

    let data = match fs::read(&canonical).await {
        Ok(d) => d,
        Err(_) => return (StatusCode::NOT_FOUND, "File not found").into_response(),
    };

    let mime = mime_for_path(&canonical);
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, mime)],
        data,
    )
        .into_response()
}
