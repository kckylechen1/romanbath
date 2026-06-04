//! TTS API — xAI Grok TTS endpoint.
//!
//! `POST /api/tts` accepts text, voice_id, and optional language,
//! calls the xAI Grok TTS API, and returns the audio as binary.

use super::AppState;
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct TtsRequest {
    pub text: String,
    #[serde(default = "default_voice")]
    pub voice_id: String,
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_voice() -> String {
    "ara".to_string()
}

fn default_language() -> String {
    "en-US".to_string()
}

pub async fn handle_tts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<TtsRequest>,
) -> impl IntoResponse {
    if state.pairing.require_pairing() {
        let token = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|auth| auth.strip_prefix("Bearer "))
            .unwrap_or("");

        if !state.pairing.is_authenticated(token) {
            return (
                StatusCode::UNAUTHORIZED,
                [(header::CONTENT_TYPE, "application/json")],
                Json(serde_json::json!({"error": "Unauthorized"})).to_string(),
            )
                .into_response();
        }
    }

    if req.text.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            [(header::CONTENT_TYPE, "application/json")],
            Json(serde_json::json!({"error": "Text is required"})).to_string(),
        )
            .into_response();
    }

    let api_key = state
        .config
        .read()
        .first_model_provider()
        .and_then(|e| e.api_key.clone());

    match generate_xai_tts(&req.text, &req.voice_id, &req.language, api_key.as_deref()).await {
        Ok(audio_bytes) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "audio/mpeg")],
            audio_bytes,
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "application/json")],
            Json(serde_json::json!({"error": e})).to_string(),
        )
            .into_response(),
    }
}

async fn generate_xai_tts(
    text: &str,
    voice_id: &str,
    language: &str,
    api_key: Option<&str>,
) -> Result<Vec<u8>, String> {
    let (auth_token, base_url) = resolve_xai_credentials(api_key)?;

    let url = format!("{}/tts", base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {auth_token}"))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "text": text,
            "voice_id": voice_id,
            "language": language
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("xAI TTS error ({status}): {error_body}"));
    }

    response
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read response: {e}"))
}

fn resolve_xai_credentials(api_key: Option<&str>) -> Result<(String, String), String> {
    if let Some(key) = api_key {
        let key = key.trim();
        if !key.is_empty() {
            return Ok((key.to_string(), "https://api.x.ai/v1".to_string()));
        }
    }
    if let Ok(token) = std::env::var("XAI_OAUTH_TOKEN") {
        return Ok((token, "https://api.x.ai/v1".to_string()));
    }
    if let Ok(key) = std::env::var("XAI_API_KEY") {
        return Ok((key, "https://api.x.ai/v1".to_string()));
    }
    Err("XAI_OAUTH_TOKEN or XAI_API_KEY not set".to_string())
}
