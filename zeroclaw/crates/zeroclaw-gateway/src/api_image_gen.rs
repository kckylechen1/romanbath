//! Image generation API — xAI Grok Imagine endpoint.
//!
//! `POST /api/image-gen` accepts a prompt and optional resolution,
//! calls the xAI Grok Imagine API, and returns the image inline as a
//! base64 data URL (no disk storage).

use super::AppState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
    Json,
};
use base64::Engine as _;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct ImageGenRequest {
    pub prompt: String,
    #[serde(default = "default_resolution")]
    pub resolution: String,
}

fn default_resolution() -> String {
    "1k".to_string()
}

#[derive(Debug, Serialize)]
pub struct ImageGenResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn handle_image_gen(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ImageGenRequest>,
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
                Json(ImageGenResponse {
                    success: false,
                    image_data_url: None,
                    error: Some("Unauthorized".to_string()),
                }),
            )
                .into_response();
        }
    }

    if req.prompt.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ImageGenResponse {
                success: false,
                image_data_url: None,
                error: Some("Prompt is required".to_string()),
            }),
        )
            .into_response();
    }

    let resolution = if req.resolution == "2k" { "2k" } else { "1k" };

    let api_key = state.config.read().first_model_provider().and_then(|e| e.api_key.clone());

    match generate_xai_image(&req.prompt, resolution, api_key.as_deref()).await {
        Ok(data_url) => (
            StatusCode::OK,
            Json(ImageGenResponse {
                success: true,
                image_data_url: Some(data_url),
                error: None,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ImageGenResponse {
                success: false,
                image_data_url: None,
                error: Some(e),
            }),
        )
            .into_response(),
    }
}

async fn generate_xai_image(prompt: &str, resolution: &str, api_key: Option<&str>) -> Result<String, String> {
    let (auth_token, base_url) = resolve_xai_credentials(api_key)?;

    let url = format!("{}/images/generations", base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {auth_token}"))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "grok-imagine-image",
            "prompt": prompt,
            "resolution": resolution
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("xAI API error ({status}): {error_body}"));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    let data = body["data"]
        .as_array()
        .ok_or("Missing 'data' array in response")?;

    if data.is_empty() {
        return Err("Empty data array in response".to_string());
    }

    let first = &data[0];

    if let Some(b64) = first["b64_json"].as_str() {
        Ok(format!("data:image/png;base64,{b64}"))
    } else if let Some(img_url) = first["url"].as_str() {
        let image_bytes = reqwest::get(img_url)
            .await
            .map_err(|e| format!("Failed to download image: {e}"))?
            .bytes()
            .await
            .map_err(|e| format!("Failed to read image data: {e}"))?;

        let b64 = base64::engine::general_purpose::STANDARD.encode(&image_bytes);
        Ok(format!("data:image/png;base64,{b64}"))
    } else {
        Err("Response missing both b64_json and url".to_string())
    }
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
