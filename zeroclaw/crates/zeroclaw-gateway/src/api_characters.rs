//! Character listing API — returns available character cards from the library.
//!
//! `GET /api/characters` lists all imported character cards, returning name and
//! metadata for each. Source of truth: `CardManager` reads from
//! `~/.zeroclaw/characters/*.json` on every call — no cached state.

use axum::{
    Json,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use zeroclaw_cards::{
    CardManager, CharacterBook, CharacterBookEntry, CharacterCard, CharacterData,
};

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

    // V3-aware summary fields. All `#[serde(default)]` so clients that
    // haven't upgraded still parse the response without error.
    #[serde(default)]
    pub nickname: String,
    #[serde(default)]
    pub has_character_book: bool,
    #[serde(default)]
    pub has_assets: bool,
    #[serde(default)]
    pub alternate_greeting_count: u32,
    #[serde(default)]
    pub creator_notes_badge: Option<String>,
    #[serde(default)]
    pub modification_date: Option<String>,

    /// Sort key for `CREATED` ordering. Not serialized — the public summary
    /// only exposes `modification_date`; creation date is reserved for
    /// server-side sort and is the source of truth from the card JSON.
    #[serde(skip)]
    pub creation_date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CharactersResponse {
    pub characters: Vec<CharacterSummary>,
}

/// Query parameters for `GET /api/characters`. Every field is optional and
/// defaults to "no filter" / "name sort" so the unparameterized call keeps
/// its old behavior.
#[derive(Debug, Default, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub creator: Option<String>,
    /// Sort mode. Accepted values: `NAME` (default), `RECENT`, `CREATED`.
    /// Unrecognized values fall back to `NAME` so a typo never breaks listing.
    #[serde(default)]
    pub sort: Option<String>,
}

pub async fn handle_list_characters(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    match list_characters(&query) {
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

fn list_characters(query: &ListQuery) -> anyhow::Result<Vec<CharacterSummary>> {
    let mgr = CardManager::default()?;
    let dir = mgr.cards_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    // Resolve filters once per call — source of truth for "did the operator
    // ask for filtering?" lives in the query string, not in a cached field.
    let search = query.search.as_deref().map(str::to_lowercase);
    let tag = query.tag.as_deref();
    let creator_filter = query.creator.as_deref().map(str::to_lowercase);
    let sort_mode = match query
        .sort
        .as_deref()
        .map(str::to_ascii_uppercase)
        .as_deref()
    {
        Some("RECENT") => SortMode::Recent,
        Some("CREATED") => SortMode::Created,
        _ => SortMode::Name,
    };

    let mut summaries: Vec<CharacterSummary> = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let card: CharacterCard = match serde_json::from_slice(&bytes) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Filter before materializing the summary so we skip the avatar
        // stat-lookup work for cards the client will never see.
        if let Some(search) = &search
            && !card_matches_search(&card, search)
        {
            continue;
        }
        if let Some(tag) = tag
            && !card.data.tags.iter().any(|t| t == tag)
        {
            continue;
        }
        if let Some(creator) = &creator_filter
            && card.data.creator.to_lowercase() != *creator
        {
            continue;
        }

        let has_avatar = mgr.avatar_path(&card.data.name).is_some();
        summaries.push(summary_from_card(&card, has_avatar));
    }

    match sort_mode {
        SortMode::Name => summaries.sort_by(|a, b| a.name.cmp(&b.name)),
        SortMode::Recent => summaries.sort_by(|a, b| {
            // modification_date desc; entries without a date sink to the
            // bottom but retain NAME ordering as the secondary key.
            b.modification_date
                .as_deref()
                .unwrap_or("")
                .cmp(a.modification_date.as_deref().unwrap_or(""))
                .then_with(|| a.name.cmp(&b.name))
        }),
        SortMode::Created => summaries.sort_by(|a, b| {
            // creation_date asc; entries without a date fall back to NAME.
            // The `creation_date` field on the summary is internal-only
            // (not serialized) so older clients don't see it.
            a.creation_date
                .as_deref()
                .unwrap_or("")
                .cmp(b.creation_date.as_deref().unwrap_or(""))
                .then_with(|| a.name.cmp(&b.name))
        }),
    }
    Ok(summaries)
}

#[derive(Debug, Clone, Copy)]
enum SortMode {
    Name,
    Recent,
    Created,
}

/// Case-insensitive substring match across the operator-visible identity
/// fields. Touches only the textual identity the search is meant to find
/// — name, description, tags, creator — never prompt content or lorebook
/// entries (those would surface spoilers in a search box).
fn card_matches_search(card: &CharacterCard, needle: &str) -> bool {
    if needle.is_empty() {
        return true;
    }
    if card.data.name.to_lowercase().contains(needle) {
        return true;
    }
    if card.data.description.to_lowercase().contains(needle) {
        return true;
    }
    if card.data.creator.to_lowercase().contains(needle) {
        return true;
    }
    if card
        .data
        .tags
        .iter()
        .any(|t| t.to_lowercase().contains(needle))
    {
        return true;
    }
    false
}

fn summary_from_card(card: &CharacterCard, has_avatar: bool) -> CharacterSummary {
    let creator_notes_badge = {
        let notes = card.data.creator_notes.trim();
        if notes.is_empty() {
            None
        } else {
            Some(notes.to_string())
        }
    };
    let modification_date = {
        let s = card.data.modification_date.trim();
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    };
    let creation_date = {
        let s = card.data.creation_date.trim();
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    };
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
        nickname: card.data.nickname.clone(),
        has_character_book: card
            .data
            .character_book
            .as_ref()
            .is_some_and(|b| !b.entries.is_empty()),
        has_assets: !card.data.assets.is_empty(),
        alternate_greeting_count: card.data.alternate_greetings.len() as u32,
        creator_notes_badge,
        modification_date,
        creation_date,
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

    match import_character(&body.path) {
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

fn import_character(body_path: &str) -> anyhow::Result<String> {
    let path = std::path::Path::new(body_path);

    // Security: reject path traversal and absolute paths
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        anyhow::bail!("Path traversal not allowed");
    }
    if path.is_absolute() {
        anyhow::bail!("Absolute paths not allowed");
    }

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

#[derive(Deserialize)]
pub struct CharacterMemoriesQuery {
    /// Max entries to return (default 200, capped at 1000).
    pub limit: Option<usize>,
}

/// GET /api/characters/{name}/memories — what this character remembers.
///
/// Reads the *per-character* sigil store (`ChatMemoryStore` →
/// `{data_dir}/chat_memory/{name}_memory.db`) that the chat pipeline actually
/// writes to. This is deliberately NOT `/api/memory`, which resolves the
/// install-wide `zeroclaw_memory` backend and has no per-character scope — the
/// two are different stores, and the companion UI must read the one the model
/// learns from.
pub async fn handle_character_memories(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Query(params): Query<CharacterMemoriesQuery>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    let data_dir = state.config.read().data_dir.clone();
    let limit = params.limit.unwrap_or(200).min(1000);

    let result = tokio::task::spawn_blocking(move || {
        let store =
            zeroclaw_memory_sigil::ChatMemoryStore::new(&data_dir.join("chat_memory"));
        store.list_memories(&name, limit)
    })
    .await;

    match result {
        Ok(Ok(entries)) => {
            (StatusCode::OK, Json(serde_json::json!({ "entries": entries }))).into_response()
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("memory task failed: {e}") })),
        )
            .into_response(),
    }
}

// ── Per-character companion settings ──────────────────────────────────
//
// Server-owned store so a thin client (web today, native later) persists its
// generation / prompt-shaping settings server-side instead of re-sending them
// every request. Settings are an opaque JSON object (the frontend's persistable
// ChatConfig subset). The gateway does NOT interpret the fields here — later
// phases read specific keys when applying them to the prompt; storing a blob
// lets the client add fields without a backend change. Keyed by the same
// sanitized name as the avatar/card so rename and delete move both together.

fn companion_settings_path(data_dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    data_dir
        .join("companion_settings")
        .join(format!("{}.json", sanitize_filename_safe(name)))
}

/// Read a character's settings blob, or `{}` if none saved yet.
fn read_companion_settings(data_dir: &std::path::Path, name: &str) -> serde_json::Value {
    let path = companion_settings_path(data_dir, name);
    std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

/// Persist a character's settings blob (must be a JSON object).
fn write_companion_settings(
    data_dir: &std::path::Path,
    name: &str,
    settings: &serde_json::Value,
) -> std::io::Result<()> {
    let path = companion_settings_path(data_dir, name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(settings).unwrap_or_default())
}

/// Move a character's settings sidecar on rename (best-effort; no-op if absent).
fn rename_companion_settings(data_dir: &std::path::Path, old_name: &str, new_name: &str) {
    let from = companion_settings_path(data_dir, old_name);
    let to = companion_settings_path(data_dir, new_name);
    if from != to && from.exists() {
        if let Some(parent) = to.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::rename(&from, &to);
    }
}

/// Remove a character's settings sidecar on delete (best-effort).
fn delete_companion_settings(data_dir: &std::path::Path, name: &str) {
    let _ = std::fs::remove_file(companion_settings_path(data_dir, name));
}

/// GET /api/characters/{name}/settings — the character's saved companion
/// settings (generation params, prompt-shaping). Returns `{}` if none saved.
pub async fn handle_get_character_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }
    let data_dir = state.config.read().data_dir.clone();
    let settings = read_companion_settings(&data_dir, &name);
    (StatusCode::OK, Json(settings)).into_response()
}

/// PUT /api/characters/{name}/settings — persist the character's companion
/// settings. Body must be a JSON object.
pub async fn handle_put_character_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }
    if !body.is_object() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "settings body must be a JSON object" })),
        )
            .into_response();
    }
    let data_dir = state.config.read().data_dir.clone();
    match write_companion_settings(&data_dir, &name, &body) {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
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
        Ok(()) => {
            // Clean up the settings sidecar alongside the card (best-effort).
            let data_dir = state.config.read().data_dir.clone();
            delete_companion_settings(&data_dir, &name);
            (StatusCode::OK, Json(serde_json::json!({"success": true}))).into_response()
        }
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
    let mut card = mgr.load(name)?;
    // The on-disk card is already canonical at save time, but legacy cards
    // written before spec detection may carry a V2 envelope alongside V3
    // fields. Re-detect on export so strict ST parsers receive the right
    // envelope. Mutating only the in-memory clone — the file on disk is
    // left untouched (we don't write on read).
    card.sync_spec();
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
    // Find a free name so duplicating twice doesn't overwrite the first copy.
    let base = card.data.name.clone();
    let mut candidate = format!("{base} (Copy)");
    let mut n = 2;
    while mgr.exists(&candidate) {
        candidate = format!("{base} (Copy {n})");
        n += 1;
    }
    card.data.name = candidate;
    let new_name = mgr.save_new(&card)?;
    Ok(new_name)
}

// ── Create / update ───────────────────────────────────────────────

fn default_card(data: CharacterData) -> CharacterCard {
    let mut card = CharacterCard {
        spec: "chara_card_v2".into(),
        spec_version: "2.0".into(),
        data,
    };
    // Source of truth for the envelope is the V3 fields the operator
    // supplied in the request body. `sync_spec` rewrites the envelope to
    // match — pure V2 cards stay V2, cards with any V3 field become V3.
    card.sync_spec();
    card
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

    let data_dir = state.config.read().data_dir.clone();
    match update_character_data(&name, data, &data_dir) {
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
    // Create, never clobber: a name that sanitizes onto an existing card's
    // file must fail loudly, not silently replace it.
    mgr.save_new(&card)
        .map_err(|e| anyhow::Error::msg(format!("{e}")))
}

fn update_character_data(
    previous_name: &str,
    data: CharacterData,
    data_dir: &std::path::Path,
) -> anyhow::Result<String> {
    let mgr = CardManager::default()?;
    if previous_name != data.name {
        // Move the avatar file from the old safe name to the new one (if any)
        // so a rename doesn't strand the avatar. `mgr.delete(previous_name)`
        // after this only removes the old JSON; the avatar is now under the
        // new safe name and survives.
        if let Some(old_avatar) = mgr.avatar_path(previous_name) {
            let safe_name = sanitize_filename_safe(&data.name);
            let new_avatar = mgr.cards_dir().join(format!("{safe_name}.png"));
            if old_avatar != new_avatar {
                let _ = std::fs::rename(&old_avatar, &new_avatar);
            }
        }
        // Move the per-character memory DB too, so a rename doesn't orphan
        // everything the companion has learned (the whole point of a
        // remembering companion). The store owns its own filename sanitizer.
        let store = zeroclaw_memory_sigil::ChatMemoryStore::new(&data_dir.join("chat_memory"));
        if let Err(e) = store.rename_character(previous_name, &data.name) {
            ::zeroclaw_log::record!(
                WARN,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                    .with_outcome(::zeroclaw_log::EventOutcome::Failure)
                    .with_attrs(::serde_json::json!({
                        "from": previous_name, "to": &data.name, "error": e.to_string(),
                    })),
                "character rename: memory DB migration failed (card renamed anyway)"
            );
        }
        // Settings sidecar follows the rename too, like the avatar and memory.
        rename_companion_settings(data_dir, previous_name, &data.name);
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

// ── Avatar upload (POST /api/characters/{name}/avatar) ───────────
//
// Mirrors the shape of `handle_upload_character` (base64-in-JSON) so the
// frontend can reuse the same FileReader path. Writes a `<safe_name>.png`
// next to the card JSON. We always write `.png` regardless of the source
// file extension so the avatar MIME type is stable for `handle_character_avatar`'s
// `mime_guess` lookup; the existing PNG bytes are what we store.

#[derive(Debug, Deserialize)]
pub struct UploadAvatarRequest {
    /// Base64-encoded image bytes. PNG, JPEG, WebP and GIF are accepted by
    /// the browser via FileReader; we write them verbatim to disk.
    pub data_base64: String,
}

#[derive(Debug, Serialize)]
pub struct UploadAvatarResponse {
    pub success: bool,
    pub has_avatar: bool,
}

pub async fn handle_upload_character_avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<UploadAvatarRequest>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }

    const MAX_AVATAR_SIZE: usize = 10 * 1024 * 1024; // 10MB

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

    if bytes.len() > MAX_AVATAR_SIZE {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("Avatar too large: {} bytes. Max: 10MB", bytes.len())})),
        )
            .into_response();
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

    // Write directly to the canonical avatar path. We don't load the card
    // first: an avatar upload is valid even when the JSON is still being
    // edited, and we want the avatar to land atomically.
    let avatar_path = match mgr.avatar_path(&name) {
        Some(existing) => existing,
        None => {
            // No existing avatar — derive a fresh path. `avatar_path` only
            // returns `Some` when the file already exists, so for a brand
            // new avatar we build the path manually.
            let safe_name = sanitize_filename_safe(&name);
            mgr.cards_dir().join(format!("{safe_name}.png"))
        }
    };

    if let Err(e) = std::fs::write(&avatar_path, &bytes) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(UploadAvatarResponse {
            success: true,
            has_avatar: true,
        }),
    )
        .into_response()
}

pub async fn handle_delete_character_avatar(
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

    if let Some(path) = mgr.avatar_path(&name) {
        if let Err(e) = std::fs::remove_file(&path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e.to_string()})),
                )
                    .into_response();
            }
        }
    }

    (
        StatusCode::OK,
        Json(UploadAvatarResponse {
            success: true,
            has_avatar: false,
        }),
    )
        .into_response()
}

/// Filename-safe copy of the character name (matches `CardManager`'s internal
/// `sanitize_filename` so the avatar lands next to the card JSON).
fn sanitize_filename_safe(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .replace(' ', "_")
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

// ── Lorebook independent CRUD ────────────────────────────────────
//
// The book is logically independent of the surrounding card data; editing
// one entry should not require the client to round-trip the whole card.
// These routes treat `data.character_book` as the single source of truth
// for "what entries exist", and persist by saving the full card through
// `CardManager::save` (which handles entry-id back-fill, timestamp
// refresh, and spec detection in one place).

#[derive(Debug, Serialize)]
pub struct BookResponse {
    pub book: Option<CharacterBook>,
}

#[derive(Debug, Deserialize)]
pub struct BookBody {
    pub book: CharacterBook,
}

#[derive(Debug, Deserialize)]
pub struct EntryBody {
    pub entry: CharacterBookEntry,
}

#[derive(Debug, Serialize)]
pub struct EntryResponse {
    pub entry: CharacterBookEntry,
}

pub async fn handle_get_book(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }
    match load_book(&name) {
        Ok(book) => (StatusCode::OK, Json(BookResponse { book })).into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn load_book(name: &str) -> anyhow::Result<Option<CharacterBook>> {
    let mgr = CardManager::default()?;
    let card = mgr.load(name)?;
    Ok(card.data.character_book.clone())
}

pub async fn handle_put_book(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<BookBody>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }
    match put_book(&name, body.book) {
        Ok(book) => (StatusCode::OK, Json(BookResponse { book: Some(book) })).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn put_book(name: &str, mut book: CharacterBook) -> anyhow::Result<CharacterBook> {
    let mgr = CardManager::default()?;
    let mut card = mgr.load(name)?;
    // Normalize incoming entries: any entry without a stable id gets one
    // here so the returned book always carries canonical ids. The same
    // back-fill runs again inside `mgr.save` against the embedded book;
    // both paths are idempotent so running twice is safe.
    normalize_entry_ids(&mut book);
    card.data.character_book = Some(book.clone());
    mgr.save(&card)?;
    Ok(book)
}

pub async fn handle_create_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<EntryBody>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }
    match create_entry(&name, body.entry) {
        Ok(entry) => (StatusCode::CREATED, Json(EntryResponse { entry })).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn create_entry(name: &str, mut entry: CharacterBookEntry) -> anyhow::Result<CharacterBookEntry> {
    let mgr = CardManager::default()?;
    let mut card = mgr.load(name)?;
    let book = card
        .data
        .character_book
        .get_or_insert_with(CharacterBook::default);
    if entry.id.is_empty() {
        entry.id = uuid_v4_string();
    }
    book.entries.push(entry.clone());
    mgr.save(&card)?;
    Ok(entry)
}

pub async fn handle_update_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((name, entry_id)): Path<(String, String)>,
    Json(body): Json<EntryBody>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }
    match update_entry(&name, &entry_id, body.entry) {
        Ok(entry) => (StatusCode::OK, Json(EntryResponse { entry })).into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn update_entry(
    name: &str,
    entry_id: &str,
    mut incoming: CharacterBookEntry,
) -> anyhow::Result<CharacterBookEntry> {
    let mgr = CardManager::default()?;
    let mut card = mgr.load(name)?;
    let book = card
        .data
        .character_book
        .as_mut()
        .ok_or_else(|| anyhow::Error::msg("character has no lorebook"))?;
    // Source of truth for the entry identity is the path parameter, not
    // the request body. Forcing the body's `id` to match prevents an
    // accidental rename that would orphan the entry from its history.
    incoming.id = entry_id.to_string();
    let target = book
        .entries
        .iter_mut()
        .find(|e| e.id == entry_id)
        .ok_or_else(|| anyhow::Error::msg(format!("lorebook entry not found: {entry_id}")))?;
    *target = incoming.clone();
    mgr.save(&card)?;
    Ok(incoming)
}

pub async fn handle_delete_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((name, entry_id)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers) {
        return resp.into_response();
    }
    match delete_entry(&name, &entry_id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

fn delete_entry(name: &str, entry_id: &str) -> anyhow::Result<()> {
    let mgr = CardManager::default()?;
    let mut card = mgr.load(name)?;
    let book = card
        .data
        .character_book
        .as_mut()
        .ok_or_else(|| anyhow::Error::msg("character has no lorebook"))?;
    let before = book.entries.len();
    book.entries.retain(|e| e.id != entry_id);
    if book.entries.len() == before {
        anyhow::bail!("lorebook entry not found: {entry_id}");
    }
    mgr.save(&card)?;
    Ok(())
}

/// Back-fill UUID v4 for any entry lacking a stable id. Mirrors
/// `CardManager`'s save-time normalization but lets us echo canonical
/// ids back to the client from PUT /book before persistence finishes.
fn normalize_entry_ids(book: &mut CharacterBook) {
    for entry in &mut book.entries {
        if entry.id.is_empty() {
            entry.id = uuid_v4_string();
        }
    }
}

/// Generate a fresh UUID v4 string. Thin wrapper so the uuid crate is
/// only touched in one place; if we ever switch id formats (e.g. ULID)
/// this is the single call site to update.
fn uuid_v4_string() -> String {
    uuid::Uuid::new_v4().to_string()
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

    #[test]
    fn uuid_v4_string_is_canonical_form() {
        let id = super::uuid_v4_string();
        // UUID v4 string is 36 chars including dashes; just sanity-check
        // the shape so a future format swap is caught here.
        assert_eq!(id.len(), 36);
        assert_eq!(id.chars().filter(|c| *c == '-').count(), 4);
    }

    #[test]
    fn companion_settings_round_trip_rename_and_delete() {
        use super::{
            delete_companion_settings, read_companion_settings, rename_companion_settings,
            write_companion_settings,
        };
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path();

        // Unsaved → empty object, never an error.
        assert_eq!(
            read_companion_settings(data_dir, "Aria"),
            serde_json::json!({})
        );

        // Round-trip.
        let settings = serde_json::json!({ "temperature": 0.8, "promptOrder": "scenario_last" });
        write_companion_settings(data_dir, "Aria", &settings).unwrap();
        assert_eq!(read_companion_settings(data_dir, "Aria"), settings);

        // Rename moves the sidecar; the old name reads empty again.
        rename_companion_settings(data_dir, "Aria", "Aria Prime");
        assert_eq!(read_companion_settings(data_dir, "Aria Prime"), settings);
        assert_eq!(
            read_companion_settings(data_dir, "Aria"),
            serde_json::json!({})
        );

        // Delete removes it.
        delete_companion_settings(data_dir, "Aria Prime");
        assert_eq!(
            read_companion_settings(data_dir, "Aria Prime"),
            serde_json::json!({})
        );
    }
}
