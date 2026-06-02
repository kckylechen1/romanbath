//! Character listing API — returns available character cards from the library.
//!
//! `GET /api/characters` lists all imported character cards, returning name and
//! metadata for each. Source of truth: `CardManager` reads from
//! `~/.zeroclaw/characters/*.json` on every call — no cached state.

use axum::{
    Json,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use zeroclaw_cards::{CardManager, CharacterCard, CharacterData};

use super::AppState;
use super::api::require_auth;

#[derive(Debug, Serialize)]
pub struct CharacterSummary {
    pub name: String,
    pub description: String,
    pub personality: String,
    pub scenario: String,
    pub first_mes: String,
    pub tags: Vec<String>,
    pub creator: String,
    pub character_version: String,
    pub has_avatar: bool,
}

#[derive(Debug, Serialize)]
pub struct CharactersResponse {
    pub characters: Vec<CharacterSummary>,
}

pub async fn handle_list_characters(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    match list_characters() {
        Ok(chars) => (
            StatusCode::OK,
            Json(CharactersResponse { characters: chars }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn list_characters() -> anyhow::Result<Vec<CharacterSummary>> {
    let mgr = CardManager::default()?;
    let names = mgr.list()?;

    let mut summaries = Vec::with_capacity(names.len());
    for name in names {
        let has_avatar = mgr.avatar_path(&name).is_some();
        match mgr.load(&name) {
            Ok(card) => {
                summaries.push(summary_from_card(&card, has_avatar));
            }
            Err(_) => {
                summaries.push(CharacterSummary {
                    name,
                    description: String::new(),
                    personality: String::new(),
                    scenario: String::new(),
                    first_mes: String::new(),
                    tags: Vec::new(),
                    creator: String::new(),
                    character_version: String::new(),
                    has_avatar,
                });
            }
        }
    }

    Ok(summaries)
}

fn summary_from_card(card: &CharacterCard, has_avatar: bool) -> CharacterSummary {
    CharacterSummary {
        name: card.data.name.clone(),
        description: card.data.description.clone(),
        personality: card.data.personality.clone(),
        scenario: card.data.scenario.clone(),
        first_mes: card.data.first_mes.clone(),
        tags: card.data.tags.clone(),
        creator: card.data.creator.clone(),
        character_version: card.data.character_version.clone(),
        has_avatar,
    }
}

// ── Import endpoint (server path) ────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResponse {
    pub success: bool,
    pub name: String,
}

pub async fn handle_import_character(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ImportRequest>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    let path = std::path::Path::new(&body.path);
    match import_character(path) {
        Ok(name) => (
            StatusCode::OK,
            Json(ImportResponse {
                success: true,
                name,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn import_character(path: &std::path::Path) -> anyhow::Result<String> {
    let mgr = CardManager::default()?;
    let name = mgr.import(path)?;
    Ok(name)
}

// ── Upload endpoint (browser file upload) ───────────────────────

#[derive(Debug, Deserialize)]
pub struct UploadRequest {
    pub filename: String,
    pub data_base64: String,
}

pub async fn handle_upload_character(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UploadRequest>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    let bytes = match base64::engine::general_purpose::STANDARD.decode(&body.data_base64) {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Invalid base64: {e}")})),
            )
                .into_response();
        }
    };

    match upload_character(&bytes, &body.filename) {
        Ok(name) => (
            StatusCode::OK,
            Json(ImportResponse {
                success: true,
                name,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn upload_character(bytes: &[u8], filename: &str) -> anyhow::Result<String> {
    let mgr = CardManager::default()?;
    let name = mgr.import_bytes(bytes, filename)?;
    Ok(name)
}

// ── Get / delete / export / duplicate ─────────────────────────────

pub async fn handle_get_character(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    match get_character(&name) {
        Ok(data) => (StatusCode::OK, Json(data)).into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn get_character(name: &str) -> anyhow::Result<CharacterData> {
    let mgr = CardManager::default()?;
    let card = mgr.load(name)?;
    Ok(card.data)
}

pub async fn handle_delete_character(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    match delete_character(&name) {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn delete_character(name: &str) -> anyhow::Result<()> {
    let mgr = CardManager::default()?;
    mgr.delete(name)?;
    Ok(())
}

pub async fn handle_export_character(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    match export_character(&name) {
        Ok(json) => {
            // Sanitize before interpolation: a CR/LF or `"` in the name would
            // let an authenticated operator inject a new response header.
            let safe_name = sanitize_attachment_name(&name);
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"{safe_name}.json\""),
                )
                .body(Body::from(json))
                .unwrap()
                .into_response()
        }
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn export_character(name: &str) -> anyhow::Result<String> {
    let mgr = CardManager::default()?;
    let card = mgr.load(name)?;
    Ok(serde_json::to_string_pretty(&card)?)
}

pub async fn handle_duplicate_character(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    match duplicate_character(&name) {
        Ok(new_name) => (
            StatusCode::OK,
            Json(ImportResponse {
                success: true,
                name: new_name,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn duplicate_character(name: &str) -> anyhow::Result<String> {
    let mgr = CardManager::default()?;
    let mut card = mgr.load(name)?;
    card.data.name = format!("{} (Copy)", card.data.name);
    let new_name = mgr.save(&card)?;
    Ok(new_name)
}

// ── Create / update ───────────────────────────────────────────────

fn default_card(data: CharacterData) -> CharacterCard {
    CharacterCard {
        spec: "chara_card_v2".into(),
        spec_version: "2.0".into(),
        data,
    }
}

pub async fn handle_create_character(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(data): Json<CharacterData>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    match save_character_data(data) {
        Ok(name) => (
            StatusCode::OK,
            Json(ImportResponse {
                success: true,
                name,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

pub async fn handle_update_character(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(data): Json<CharacterData>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    match update_character_data(&name, data) {
        Ok(new_name) => (
            StatusCode::OK,
            Json(ImportResponse {
                success: true,
                name: new_name,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn save_character_data(data: CharacterData) -> anyhow::Result<String> {
    let mgr = CardManager::default()?;
    let card = default_card(data);
    mgr.save(&card)
        .map_err(|e| anyhow::Error::msg(format!("{e}")))
}

fn update_character_data(previous_name: &str, data: CharacterData) -> anyhow::Result<String> {
    let mgr = CardManager::default()?;
    if previous_name != data.name {
        let _ = mgr.delete(previous_name);
    }
    let card = default_card(data);
    mgr.save(&card)
        .map_err(|e| anyhow::Error::msg(format!("{e}")))
}

pub async fn handle_character_avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    let mgr = match CardManager::default() {
        Ok(m) => m,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    };

    match mgr.avatar_path(&name) {
        Some(path) => match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let mime = mime_guess::from_path(&path)
                    .first_or_octet_stream()
                    .to_string();
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, mime)
                    .body(Body::from(bytes))
                    .unwrap()
                    .into_response()
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        },
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No avatar for this character"})),
        )
            .into_response(),
    }
}

/// Make a string safe to drop into a `Content-Disposition: filename="..."`
/// header value. Strips CR/LF, control bytes, `"`, `\`, `/`, `;` and anything
/// outside printable ASCII; truncates to 128 chars. Returns `"unknown"` when
/// the input is empty or sanitizes to empty.
fn sanitize_attachment_name(name: &str) -> String {
    const MAX: usize = 128;
    let sanitized: String = name
        .chars()
        .filter(|&c| {
            let b = c as u32;
            (0x20..=0x7e).contains(&b) && !matches!(c, '"' | '\\' | '/' | ';')
        })
        .take(MAX)
        .collect();
    if sanitized.trim().is_empty() {
        "unknown".to_owned()
    } else {
        sanitized.trim().to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize_attachment_name;

    #[test]
    fn strips_header_injection_payloads() {
        // CR/LF stripped — the rest is printable ASCII that the filter
        // passes through. The point of sanitization is to prevent the
        // *injection vector* (CR/LF and the surrounding quote), not to
        // strip every character that looks like a header.
        assert_eq!(
            sanitize_attachment_name("foo\r\nSet-Cookie: x"),
            "fooSet-Cookie: x"
        );
        assert_eq!(sanitize_attachment_name("a\"b"), "ab");
        assert_eq!(sanitize_attachment_name("a/b\\c"), "abc");
        assert_eq!(sanitize_attachment_name("semi;colon"), "semicolon");
        // Pure CRLF input falls back to the "unknown" placeholder.
        assert_eq!(sanitize_attachment_name("\r\n"), "unknown");
    }

    #[test]
    fn truncates_long_names() {
        let long = "a".repeat(200);
        assert_eq!(sanitize_attachment_name(&long).len(), 128);
    }

    #[test]
    fn empty_or_all_unsafe_falls_back() {
        assert_eq!(sanitize_attachment_name(""), "unknown");
        assert_eq!(sanitize_attachment_name("\r\n\";\\"), "unknown");
        assert_eq!(sanitize_attachment_name("   "), "unknown");
    }

    #[test]
    fn preserves_normal_names() {
        assert_eq!(sanitize_attachment_name("Suwan Ning"), "Suwan Ning");
        assert_eq!(sanitize_attachment_name("character_v2"), "character_v2");
        assert_eq!(sanitize_attachment_name("テスト"), "unknown");
    }
}
