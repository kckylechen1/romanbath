//! Session inspection endpoints.
//!
//! Read-only views over the `SessionBackend` conversation trees. Used by:
//! - RomanBath migration verification (POST /api/sessions/migrate then GET tree)
//! - Debugging / inspection when WS is not connected
//! - Future REST-only clients (curl scripts, dashboards)
//!
//! Live chat history load for the WS path goes through the `history_snapshot`
//! frame in `ws.rs`, NOT these endpoints.

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};

use crate::api::require_auth;
use crate::AppState;
use zeroclaw_infra::session_backend::ConversationNode;

#[derive(Debug, Serialize)]
pub struct SessionTreeResponse {
    pub session_key: String,
    pub nodes: Vec<SessionTreeNode>,
    pub active_leaf: Option<String>,
    pub session_persistence: bool,
}

#[derive(Debug, Serialize)]
pub struct SessionTreeNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub role: String,
    pub content: String,
    pub author_id: Option<String>,
    pub status: Option<String>,
    pub meta: Option<serde_json::Value>,
    pub timestamp: Option<String>,
}

pub async fn handle_session_tree(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let Some(ref backend) = state.session_backend else {
        return Json(SessionTreeResponse {
            session_key: key,
            nodes: vec![],
            active_leaf: None,
            session_persistence: false,
        })
        .into_response();
    };

    let nodes = backend.load_tree(&key);
    let active_leaf = backend.get_active_leaf(&key);

    let nodes: Vec<SessionTreeNode> = nodes
        .into_iter()
        .map(|n| SessionTreeNode {
            id: n.msg_id,
            parent_id: n.parent_id,
            role: n.role,
            content: n.content,
            author_id: n.author_id,
            status: n.status,
            meta: n.meta,
            timestamp: n.created_at.map(|dt| dt.to_rfc3339()),
        })
        .collect();

    Json(SessionTreeResponse {
        session_key: key,
        nodes,
        active_leaf,
        session_persistence: true,
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct SessionMigrateRequest {
    pub session_key: String,
    pub nodes: Vec<SessionMigrateNode>,
    #[serde(default)]
    pub active_leaf: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SessionMigrateNode {
    pub id: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub author_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct SessionMigrateResponse {
    pub session_key: String,
    pub inserted: usize,
    pub skipped: usize,
    pub active_leaf: Option<String>,
    pub session_persistence: bool,
}

pub async fn handle_sessions_migrate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SessionMigrateRequest>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let session_key = body.session_key.clone();

    if session_key.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "session_key must not be empty"})),
        )
            .into_response();
    }

    let Some(ref backend) = state.session_backend else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "Session persistence is disabled; cannot migrate",
                "session_persistence": false,
            })),
        )
            .into_response();
    };

    for node in &body.nodes {
        if node.id.trim().is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("Node has empty id"),
                })),
            )
                .into_response();
        }
        if node.content.trim().is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("Node {} has empty content", node.id),
                })),
            )
                .into_response();
        }
        match node.role.as_str() {
            "user" | "assistant" | "system" => {}
            other => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": format!("Node {} has invalid role '{}'", node.id, other),
                    })),
                )
                    .into_response();
            }
        }
    }

    let existing: std::collections::HashSet<String> = backend
        .load_tree(&session_key)
        .into_iter()
        .map(|n| n.msg_id)
        .collect();

    let mut known_ids = existing.clone();
    let mut inserted = 0usize;
    let mut skipped = 0usize;

    for node in &body.nodes {
        if known_ids.contains(&node.id) {
            skipped += 1;
            continue;
        }
        if let Some(ref parent_id) = node.parent_id {
            if !known_ids.contains(parent_id) {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": format!(
                            "Node {} references parent {} that is neither already persisted nor earlier in this request",
                            node.id, parent_id
                        ),
                    })),
                )
                    .into_response();
            }
        }

        let created_at = node.timestamp.as_ref().and_then(|ts| {
            chrono::DateTime::parse_from_rfc3339(ts)
                .ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
        });

        let conv = ConversationNode {
            msg_id: node.id.clone(),
            parent_id: node.parent_id.clone(),
            role: node.role.clone(),
            content: node.content.clone(),
            author_id: node.author_id.clone(),
            status: node.status.clone(),
            meta: node.meta.clone(),
            created_at,
        };

        if let Err(e) = backend.append_node(&session_key, &conv) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to append node {}: {e}", node.id),
                    "inserted_before_failure": inserted,
                })),
            )
                .into_response();
        }
        known_ids.insert(node.id.clone());
        inserted += 1;
    }

    let mut final_active_leaf = None;
    if let Some(ref leaf) = body.active_leaf {
        if known_ids.contains(leaf) {
            let _ = backend.set_active_leaf(&session_key, leaf);
            final_active_leaf = Some(leaf.clone());
        }
    }

    if let Some(ref name) = body.name {
        if !name.trim().is_empty() {
            let _ = backend.set_session_name(&session_key, name);
        }
    }

    Json(SessionMigrateResponse {
        session_key,
        inserted,
        skipped,
        active_leaf: final_active_leaf,
        session_persistence: true,
    })
    .into_response()
}
