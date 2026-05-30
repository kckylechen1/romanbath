//! Chat API — character-driven conversation endpoint.
//!
//! `POST /api/chat` accepts a list of messages and an optional character name.
//! When a character is specified, the card's system prompt and lorebook are
//! injected before calling the model provider. Relevant memories from past
//! conversations are also injected via `zeroclaw-memory-sigil`.

use super::AppState;
use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use zeroclaw_cards::CardManager;
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
    /// or "chat" (light flavor). Defaults to "chat".
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_mode() -> String {
    "chat".to_string()
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub text: String,
}

pub async fn handle_chat(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> impl IntoResponse {
    match process_chat(&state, req).await {
        Ok(text) => (StatusCode::OK, Json(ChatResponse { text })).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn process_chat(state: &AppState, req: ChatRequest) -> anyhow::Result<String> {
    let mut messages = req.messages;

    // Inject character card if specified
    if let Some(ref name) = req.character_name {
        let mgr = CardManager::default()?;
        let card = mgr.load(name).map_err(|e| anyhow::anyhow!("Character '{name}' not found: {e}"))?;

        let user_name = "User";

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
            let _ = mem_store.save_chat_memory(
                name,
                user_name,
                "user",
                &last_user_msg.content,
            );
        }

        // Inject relevant memories into prompt
        let memory_context = mem_store.inject_memories_into_prompt(name, &conversation_text);

        // Build ST-style prompt fragments (main, lorebook, description, personality,
        // scenario, system_prompt, dialogue examples, post-history instructions, mode note)
        let mut fragments = card.build_prompt(&req.mode, user_name, &conversation_text);

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
    }

    let model = state.model.clone();
    let temperature = state.temperature;

    state
        .model_provider
        .chat_with_history(&messages, &model, temperature)
        .await
        .map_err(|e| anyhow::anyhow!("Model provider error: {e}"))
}
