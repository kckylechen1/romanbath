//! Chat API — character-driven conversation endpoint (REST + SSE).
//!
//! `POST /api/chat` accepts a list of messages and an optional character name.
//! When a character is specified, the card's system prompt and lorebook are
//! injected before calling the model provider. Relevant memories from past
//! conversations are also injected via `zeroclaw-memory-sigil`.
//!
//! Supports both non-streaming (returns full text) and SSE streaming
//! (`stream: true` → `text/event-stream` with token deltas).
//!
//! Prompt assembly lives in `crate::chat_prompt` so the WS handler can share
//! it. This module owns only the HTTP/SSE plumbing and the response type.

use super::AppState;
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{
        IntoResponse,
        sse::{Event, KeepAlive, Sse},
    },
};
use futures_util::StreamExt;
use serde::Serialize;
use std::convert::Infallible;
use zeroclaw_api::model_provider::{ModelProvider, StreamOptions};
use zeroclaw_memory_sigil::ChatMemoryStore;

pub use crate::chat_prompt::{ChatRequest, RequestLorebookEntry};
use crate::chat_prompt::build_messages;

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub text: String,
}

/// Deprecated — use `/ws/chat` for production chat; kept for internal tests.
pub async fn handle_chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChatRequest>,
) -> impl IntoResponse {
    // Auth check
    if state.pairing.require_pairing() {
        let token = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|auth| auth.strip_prefix("Bearer "))
            .unwrap_or("");

        if !state.pairing.is_authenticated(token) {
            return (
                StatusCode::UNAUTHORIZED,
                "Unauthorized — provide Authorization: Bearer <token>",
            )
                .into_response();
        }
    }

    if req.stream {
        handle_streaming_chat(&state, req).await
    } else {
        match process_chat(&state, req).await {
            Ok(text) => (StatusCode::OK, Json(ChatResponse { text })).into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        }
    }
}

async fn handle_streaming_chat(state: &AppState, req: ChatRequest) -> axum::response::Response {
    let char_name = req.character_name.clone();
    let uname = req.user_name.clone().unwrap_or_else(|| "User".to_string());
    let memory_dir = state.config.read().data_dir.clone();

    // Per-request max_tokens override (ephemeral — applies to this call only).
    // Set unconditionally: the provider holds this in shared state, so guarding
    // on `is_some()` would leave a previous request's override in place for any
    // later request that omits the field. Passing None clears it.
    state
        .model_provider
        .set_per_request_max_tokens(req.max_tokens);
    let request_temperature = req.temperature;

    let messages = match build_messages(state, req).await {
        Ok(m) => m,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    };

    let model = state.model.clone();
    let temperature = request_temperature.or(state.temperature);

    // Thread-safe accumulator to reconstruct the final assistant reply for memory persistence
    let reply_accumulator = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));
    let reply_accumulator_clone = reply_accumulator.clone();

    let upstream = state.model_provider.stream_chat_with_history(
        &messages,
        &model,
        temperature,
        StreamOptions::new(true),
    );

    let stream = futures_util::stream::unfold(
        (
            upstream,
            false,
            reply_accumulator_clone,
            char_name,
            uname,
            memory_dir,
        ),
        |(mut upstream, error_seen, reply_acc, char_name, uname, memory_dir)| async move {
            if error_seen {
                return None;
            }
            let result = upstream.next().await?;
            match result {
                Ok(chunk) => {
                    if chunk.is_final {
                        let final_text = reply_acc.lock().await.clone();
                        if let Some(ref cn) = char_name {
                            let ft = final_text.clone();
                            let uname_c = uname.clone();
                            let mem_dir = memory_dir.clone();
                            let cn_c = cn.clone();
                            tokio::task::spawn_blocking(move || {
                                let mem_store = ChatMemoryStore::new(&mem_dir.join("chat_memory"));
                                let _ =
                                    mem_store.save_chat_memory(&cn_c, &uname_c, "assistant", &ft);
                            });
                        }
                        let event = Event::default().data("[DONE]");
                        Some((
                            Ok::<_, Infallible>(event),
                            (
                                upstream, error_seen, reply_acc, char_name, uname, memory_dir,
                            ),
                        ))
                    } else {
                        reply_acc.lock().await.push_str(&chunk.delta);
                        let json = serde_json::json!({"token": chunk.delta});
                        let event = Event::default().data(json.to_string());
                        Some((
                            Ok(event),
                            (
                                upstream, error_seen, reply_acc, char_name, uname, memory_dir,
                            ),
                        ))
                    }
                }
                Err(e) => {
                    let json = serde_json::json!({"error": e.to_string()});
                    let event = Event::default().data(json.to_string());
                    Some((
                        Ok(event),
                        (upstream, true, reply_acc, char_name, uname, memory_dir),
                    ))
                }
            }
        },
    );

    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

/// Non-streaming chat — returns the full response text.
async fn process_chat(state: &AppState, req: ChatRequest) -> anyhow::Result<String> {
    let char_name = req.character_name.clone();
    let uname = req.user_name.clone().unwrap_or_else(|| "User".to_string());

    // Per-request max_tokens override (ephemeral — applies to this call only).
    // Set unconditionally: the provider holds this in shared state, so guarding
    // on `is_some()` would leave a previous request's override in place for any
    // later request that omits the field. Passing None clears it.
    state
        .model_provider
        .set_per_request_max_tokens(req.max_tokens);
    let request_temperature = req.temperature;

    let messages = build_messages(state, req).await?;

    let model = state.model.clone();
    let temperature = request_temperature.or(state.temperature);

    let reply = state
        .model_provider
        .chat_with_history(&messages, &model, temperature)
        .await
        .map_err(|e| anyhow::Error::msg(format!("Model provider error: {e}")))?;

    if let Some(ref name) = char_name {
        let memory_dir = state.config.read().data_dir.clone();
        let mem_store = ChatMemoryStore::new(&memory_dir.join("chat_memory"));
        let _ = mem_store.save_chat_memory(name, &uname, "assistant", &reply);
    }

    Ok(reply)
}
