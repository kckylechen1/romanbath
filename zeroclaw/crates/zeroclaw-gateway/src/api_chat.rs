//! Chat API — character-driven conversation endpoint.
//!
//! `POST /api/chat` accepts a list of messages and an optional character name.
//! When a character is specified, the card's system prompt and lorebook are
//! injected before calling the model provider. Relevant memories from past
//! conversations are also injected via `zeroclaw-memory-sigil`.
//!
//! Supports both non-streaming (returns full text) and SSE streaming
//! (`stream: true` → `text/event-stream` with token deltas).

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
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use zeroclaw_api::model_provider::{ModelProvider, StreamOptions};
use zeroclaw_cards::CardManager;
use zeroclaw_cards::tokenizer;
use zeroclaw_memory_sigil::ChatMemoryStore;
use zeroclaw_providers::ChatMessage;

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    /// Conversation messages (role: "user" | "assistant" | "system").
    pub messages: Vec<ChatMessage>,
    /// Optional character name to load from the card library.
    #[serde(default)]
    pub character_name: Option<String>,
    /// Character mode: "play" (full immersion), "soul" (personality + assistant),
    /// or "chat" (light flavor). Defaults to "play".
    #[serde(default = "default_mode")]
    pub mode: String,
    /// When true, the response is streamed as SSE with token deltas.
    #[serde(default)]
    pub stream: bool,
    /// Per-request temperature override. When Some, takes precedence over
    /// the gateway's default temperature.
    #[serde(default)]
    pub temperature: Option<f64>,
    /// Per-request max output tokens override.
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Nucleus sampling threshold.
    #[serde(default)]
    pub top_p: Option<f64>,
    /// Top-k sampling parameter.
    #[serde(default)]
    pub top_k: Option<u32>,
    /// Frequency penalty for token repetition.
    #[serde(default)]
    pub frequency_penalty: Option<f64>,
    /// Presence penalty for token repetition.
    #[serde(default)]
    pub presence_penalty: Option<f64>,
    /// Stop sequences.
    #[serde(default)]
    pub stop: Option<Vec<String>>,
    /// Random seed for reproducible generation.
    #[serde(default)]
    pub seed: Option<i64>,
    /// User name override for character card prompt building.
    #[serde(default)]
    pub user_name: Option<String>,
    /// User persona / description injected into the character prompt.
    #[serde(default)]
    pub user_description: Option<String>,
    /// Maximum context window tokens. When set, conversation history is
    /// truncated from the front to fit within this budget (system messages
    /// are preserved).
    #[serde(default)]
    pub max_context_tokens: Option<u32>,
    /// When true, append the scene-mode system prompt fragment after the
    /// card's system prompt.
    #[serde(default)]
    pub scene_mode: Option<bool>,
}

fn default_mode() -> String {
    "play".to_string()
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub text: String,
}

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
    if req.max_tokens.is_some() {
        state
            .model_provider
            .set_per_request_max_tokens(req.max_tokens);
    }
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
    let reply_accumulator = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let reply_accumulator_clone = reply_accumulator.clone();

    let stream = state
        .model_provider
        .stream_chat_with_history(&messages, &model, temperature, StreamOptions::new(true))
        .map(move |result| match result {
            Ok(chunk) => {
                if chunk.is_final {
                    let final_text = {
                        let lock = reply_accumulator_clone.lock().unwrap();
                        lock.clone()
                    };
                    if let Some(cn) = char_name.clone() {
                        let uname = uname.clone();
                        let memory_dir = memory_dir.clone();
                        let final_text = final_text.clone();
                        tokio::task::spawn_blocking(move || {
                            let mem_store = ChatMemoryStore::new(&memory_dir.join("chat_memory"));
                            let _ =
                                mem_store.save_chat_memory(&cn, &uname, "assistant", &final_text);
                        });
                    }
                    Ok::<_, Infallible>(Event::default().data("[DONE]"))
                } else {
                    {
                        let mut lock = reply_accumulator_clone.lock().unwrap();
                        lock.push_str(&chunk.delta);
                    }
                    let json = serde_json::json!({"token": chunk.delta});
                    Ok(Event::default().data(json.to_string()))
                }
            }
            Err(e) => {
                let json = serde_json::json!({"error": e.to_string()});
                Ok(Event::default().data(json.to_string()))
            }
        });

    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

/// Build the final messages array with character card injection.
async fn build_messages(state: &AppState, req: ChatRequest) -> anyhow::Result<Vec<ChatMessage>> {
    let max_context_tokens = req.max_context_tokens;
    let model = state.model.clone();
    let mut messages = req.messages;

    if let Some(ref name) = req.character_name {
        let mgr = CardManager::default()?;
        let card = mgr
            .load(name)
            .map_err(|e| anyhow::Error::msg(format!("Character '{name}' not found: {e}")))?;

        let user_name = req.user_name.as_deref().unwrap_or("User");

        // Build conversation text for lorebook keyword matching
        let conversation_text: String = messages
            .iter()
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n");

        // ── Memory injection ──────────────────────────────────────────────
        // Source of truth for the memory DB directory: the top-level data_dir
        // from the config. Resolved on-demand, never cached in a struct field.
        let memory_dir = state.config.read().data_dir.clone();
        let mem_store = ChatMemoryStore::new(&memory_dir.join("chat_memory"));

        // Save the last user message as a memory (best-effort)
        if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
            let _ = mem_store.save_chat_memory(name, user_name, "user", &last_user_msg.content);
        }

        // Inject relevant memories into prompt
        let memory_context = mem_store.inject_memories_into_prompt(name, &conversation_text);

        // Build ST-style prompt fragments
        let mut fragments = card.build_prompt(
            &req.mode,
            user_name,
            &conversation_text,
            req.user_description.as_deref(),
        );

        // Remove any existing system messages from the caller
        messages.retain(|m| m.role != "system");

        // Append memory context as a system prompt fragment if non-empty
        if !memory_context.is_empty() {
            fragments.push(zeroclaw_cards::PromptFragment {
                role: "system".to_string(),
                content: memory_context,
            });
        }

        // Prepend all prompt fragments as system messages in order
        for frag in fragments.into_iter().rev() {
            messages.insert(0, ChatMessage::system(frag.content));
        }

        // ── Scene Mode injection ────────────────────────────────────────
        if req.scene_mode.unwrap_or(false) {
            let scene_template_path = std::path::Path::new("characters/scene_template.txt");
            if scene_template_path.exists() {
                if let Ok(template) = std::fs::read_to_string(scene_template_path) {
                    if !template.is_empty() {
                        // Insert after the card's system prompt fragments
                        // (which were just prepended at index 0+). Find the
                        // first non-system message and insert before it.
                        let insert_at = messages
                            .iter()
                            .position(|m| m.role != "system")
                            .unwrap_or(messages.len());
                        messages.insert(insert_at, ChatMessage::system(template));
                    }
                }
            }
        }
    }

    // ── Context truncation ────────────────────────────────────────────
    // When a max_context_tokens budget is provided, trim the oldest
    // non-system messages to fit. System messages (character card prompt,
    // memory context, etc.) are always preserved.
    if let Some(budget) = max_context_tokens {
        let mut token_msgs: Vec<zeroclaw_cards::TokenMessage> = messages
            .iter()
            .map(|m| zeroclaw_cards::TokenMessage::new(&m.role, &m.content))
            .collect();
        tokenizer::truncate_messages(
            &mut token_msgs,
            budget as usize,
            &model,
            2, // keep at least last 2 messages (user + space for assistant)
        );
        // Rebuild ChatMessage vec from truncated token messages
        // Preserve original ChatMessage for messages that survived truncation
        messages.retain(|m| {
            token_msgs
                .iter()
                .any(|tm| tm.role == m.role && tm.content == m.content)
        });
    }

    Ok(messages)
}

/// Non-streaming chat — returns the full response text.
async fn process_chat(state: &AppState, req: ChatRequest) -> anyhow::Result<String> {
    let char_name = req.character_name.clone();
    let uname = req.user_name.clone().unwrap_or_else(|| "User".to_string());

    // Per-request max_tokens override (ephemeral — applies to this call only).
    if req.max_tokens.is_some() {
        state
            .model_provider
            .set_per_request_max_tokens(req.max_tokens);
    }
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
