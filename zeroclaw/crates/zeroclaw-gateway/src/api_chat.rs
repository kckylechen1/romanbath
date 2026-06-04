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
use zeroclaw_cards::tokenizer;
use zeroclaw_cards::{CardManager, PromptOrder};
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
    /// Frontend-authored system prompt fragments, for example group-chat
    /// speaker rules. These are inserted after card/memory context and before
    /// conversation history.
    #[serde(default)]
    pub system_prompts: Vec<String>,
    /// Per-chat scenario override from RomanBath's settings panel.
    #[serde(default)]
    pub scenario: Option<String>,
    /// Per-chat example dialogue from RomanBath's settings panel.
    #[serde(default)]
    pub example_dialogue: Option<String>,
    /// Lightweight global lorebook entries from RomanBath's settings panel.
    #[serde(default)]
    pub lorebook: Vec<RequestLorebookEntry>,
    /// High-priority prompt override/addendum from the settings panel.
    #[serde(default)]
    pub system_prompt_override: Option<String>,
    /// Author's note / depth prompt.
    #[serde(default)]
    pub authors_note: Option<String>,
    /// Number of non-system messages from the end before which to insert the
    /// author's note. `0` means immediately before the latest message.
    #[serde(default)]
    pub authors_note_depth: Option<usize>,
    /// RomanBath prompt-order preset: default, style_first, scenario_last.
    #[serde(default)]
    pub prompt_order: Option<String>,
    /// Optional formatting hints.
    #[serde(default)]
    pub user_prefix: Option<String>,
    #[serde(default)]
    pub model_prefix: Option<String>,
    #[serde(default)]
    pub context_template: Option<String>,
    #[serde(default)]
    pub prompt_template: Option<String>,
    #[serde(default)]
    pub negative_prompt: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RequestLorebookEntry {
    #[serde(default)]
    pub keys: Vec<String>,
    #[serde(default)]
    pub content: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

fn default_mode() -> String {
    "play".to_string()
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub text: String,
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

fn prompt_order_from_preset(preset: Option<&str>) -> Option<PromptOrder> {
    match preset {
        Some("style_first") => Some(PromptOrder {
            sections: vec![
                "main".into(),
                "persona".into(),
                "system_prompt".into(),
                "mode_note".into(),
                "description".into(),
                "personality".into(),
                "world_info_before".into(),
                "scenario".into(),
                "world_info_after".into(),
                "dialogue_examples".into(),
                "post_history".into(),
            ],
        }),
        Some("scenario_last") => Some(PromptOrder {
            sections: vec![
                "main".into(),
                "persona".into(),
                "world_info_before".into(),
                "description".into(),
                "personality".into(),
                "system_prompt".into(),
                "world_info_after".into(),
                "dialogue_examples".into(),
                "post_history".into(),
                "scenario".into(),
                "mode_note".into(),
            ],
        }),
        _ => None,
    }
}

fn matching_lorebook_content(
    entries: &[RequestLorebookEntry],
    conversation_text: &str,
) -> Vec<String> {
    let lower_text = conversation_text.to_lowercase();
    entries
        .iter()
        .filter(|entry| {
            entry.enabled
                && !entry.content.trim().is_empty()
                && entry
                    .keys
                    .iter()
                    .any(|key| !key.trim().is_empty() && lower_text.contains(&key.to_lowercase()))
        })
        .map(|entry| entry.content.trim().to_owned())
        .collect()
}

fn formatting_note(req: &ChatRequest) -> Option<String> {
    let mut lines = Vec::new();
    if let Some(value) = non_empty(req.prompt_template.as_deref()) {
        lines.push(format!("Prompt template preset: {value}"));
    }
    if let Some(value) = non_empty(req.context_template.as_deref()) {
        lines.push(format!("Context template: {value}"));
    }
    if let Some(value) = non_empty(req.user_prefix.as_deref()) {
        lines.push(format!("User speaker prefix: {value}"));
    }
    if let Some(value) = non_empty(req.model_prefix.as_deref()) {
        lines.push(format!("Assistant/character speaker prefix: {value}"));
    }
    if lines.is_empty() {
        None
    } else {
        Some(format!("[Formatting instructions]\n{}", lines.join("\n")))
    }
}

fn insert_author_note(messages: &mut Vec<ChatMessage>, note: String, depth: usize) {
    let non_system_positions: Vec<usize> = messages
        .iter()
        .enumerate()
        .filter_map(|(idx, msg)| (msg.role != "system").then_some(idx))
        .collect();

    let insert_at = if non_system_positions.is_empty() {
        messages.len()
    } else {
        let from_end = depth.min(non_system_positions.len().saturating_sub(1));
        non_system_positions[non_system_positions.len() - 1 - from_end]
    };

    messages.insert(
        insert_at,
        ChatMessage::system(format!("[Author's note]\n{note}")),
    );
}

fn insert_system_before_history(messages: &mut Vec<ChatMessage>, content: String) {
    let insert_at = messages
        .iter()
        .position(|msg| msg.role != "system")
        .unwrap_or(messages.len());
    messages.insert(insert_at, ChatMessage::system(content));
}

fn read_first_existing_text(paths: impl IntoIterator<Item = std::path::PathBuf>) -> Option<String> {
    paths
        .into_iter()
        .find_map(|path| std::fs::read_to_string(path).ok())
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
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
    let mut messages = req.messages.clone();
    let conversation_text: String = messages
        .iter()
        .map(|m| format!("{}: {}", m.role, m.content))
        .collect::<Vec<_>>()
        .join("\n");

    if let Some(ref name) = req.character_name {
        let mgr = CardManager::default()?;
        let card = mgr
            .load(name)
            .map_err(|e| anyhow::Error::msg(format!("Character '{name}' not found: {e}")))?;

        let user_name = req.user_name.as_deref().unwrap_or("User");

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
        let prompt_order = prompt_order_from_preset(req.prompt_order.as_deref());
        let mut fragments = card.build_prompt_with_order(
            &req.mode,
            user_name,
            &conversation_text,
            req.user_description.as_deref(),
            prompt_order.as_ref(),
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
            let data_dir = state.config.read().data_dir.clone();
            if let Some(template) = read_first_existing_text([
                mgr.cards_dir().join("scene_template.txt"),
                data_dir.join("characters").join("scene_template.txt"),
            ]) {
                insert_system_before_history(&mut messages, template);
            }
        }
    }

    if let Some(prompt) = non_empty(req.system_prompt_override.as_deref()) {
        insert_system_before_history(
            &mut messages,
            format!("[RomanBath prompt override]\n{prompt}"),
        );
    }

    if let Some(scenario) = non_empty(req.scenario.as_deref()) {
        insert_system_before_history(&mut messages, format!("[RomanBath scenario]\n{scenario}"));
    }

    if let Some(example) = non_empty(req.example_dialogue.as_deref()) {
        insert_system_before_history(
            &mut messages,
            format!("[Additional example dialogue]\n{example}"),
        );
    }

    for content in matching_lorebook_content(&req.lorebook, &conversation_text) {
        insert_system_before_history(&mut messages, format!("[World info]\n{content}"));
    }

    if let Some(note) = formatting_note(&req) {
        insert_system_before_history(&mut messages, note);
    }

    if let Some(negative) = non_empty(req.negative_prompt.as_deref()) {
        insert_system_before_history(
            &mut messages,
            format!("[Negative prompt]\nAvoid the following in the next reply: {negative}"),
        );
    }

    for prompt in req
        .system_prompts
        .iter()
        .filter_map(|prompt| non_empty(Some(prompt)))
    {
        insert_system_before_history(&mut messages, prompt);
    }

    if let Some(note) = non_empty(req.authors_note.as_deref()) {
        insert_author_note(&mut messages, note, req.authors_note_depth.unwrap_or(4));
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
