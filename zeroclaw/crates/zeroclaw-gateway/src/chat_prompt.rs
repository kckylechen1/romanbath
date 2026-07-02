//! Shared chat prompt assembly for the RomanBath character RP pipeline.
//!
//! Extracted from `api_chat.rs` so that both the REST `/api/chat` handler and
//! the WebSocket `/ws/chat` handler can build the same character-card-aware
//! prompt without duplicating logic. The REST handler keeps ownership of
//! HTTP/SSE plumbing; this module owns:
//!
//! - `ChatRequest` / `RequestLorebookEntry` (request DTOs, serde-compatible)
//! - prompt-order preset resolution
//! - lorebook keyword matching
//! - author-note / scenario / example-dialogue / world-info insertion helpers
//! - `build_messages` — the canonical character-card + memory + lorebook +
//!   context-truncation pipeline
//!
//! JSON wire format is unchanged from the original `api_chat.rs` definitions;
//! `ChatRequest` and `RequestLorebookEntry` are re-exported from `api_chat`
//! for any in-crate or external Rust imports that still use the old path.

use crate::AppState;
use serde::Deserialize;
use zeroclaw_cards::tokenizer;
use zeroclaw_cards::{CardManager, PromptOrder};
use zeroclaw_memory_sigil::ChatMemoryStore;
use zeroclaw_providers::ChatMessage;

/// RomanBath chat request. See `api_chat::handle_chat` for the REST contract.
///
/// All fields beyond `messages` are optional; defaults are applied by the
/// serde `default = ...` attributes so partial JSON from older clients still
/// deserializes cleanly.
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

pub(crate) fn default_true() -> bool {
    true
}

pub(crate) fn default_mode() -> String {
    "play".to_string()
}

pub(crate) fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

pub(crate) fn prompt_order_from_preset(preset: Option<&str>) -> Option<PromptOrder> {
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

pub(crate) fn matching_lorebook_content(
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

pub(crate) fn formatting_note(req: &ChatRequest) -> Option<String> {
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

pub(crate) fn insert_author_note(messages: &mut Vec<ChatMessage>, note: String, depth: usize) {
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

pub(crate) fn insert_system_before_history(messages: &mut Vec<ChatMessage>, content: String) {
    let insert_at = messages
        .iter()
        .position(|msg| msg.role != "system")
        .unwrap_or(messages.len());
    messages.insert(insert_at, ChatMessage::system(content));
}

pub(crate) fn read_first_existing_text(
    paths: impl IntoIterator<Item = std::path::PathBuf>,
) -> Option<String> {
    paths
        .into_iter()
        .find_map(|path| std::fs::read_to_string(path).ok())
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

/// Build the final messages array with character card injection.
///
/// This is the canonical prompt assembly pipeline shared by REST `/api/chat`
/// and WS `/ws/chat`. It:
///
/// 1. Loads the character card (if `character_name` is set) and applies the
///    `mode` (play / soul / chat) via `card.build_prompt_with_order`.
/// 2. Removes caller-supplied system messages and prepends card fragments.
/// 3. Injects sigil memory context (offloaded to a blocking thread).
/// 4. Optionally injects the scene-mode template from disk.
/// 5. Layers on per-request overrides: system_prompt_override, scenario,
///    example_dialogue, lorebook keyword matches, formatting note, negative
///    prompt, frontend system_prompts, author's note.
/// 6. Truncates from the front to fit `max_context_tokens` (system messages
///    preserved).
pub async fn build_messages(
    state: &AppState,
    req: ChatRequest,
) -> anyhow::Result<Vec<ChatMessage>> {
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

        // ── Memory injection (offloaded to blocking thread) ───────────────
        let memory_dir = state.config.read().data_dir.clone();
        let memory_context = {
            let name = name.to_string();
            let user_name = user_name.to_string();
            let last_content = messages
                .iter()
                .rev()
                .find(|m| m.role == "user")
                .map(|m| m.content.clone());
            let conv_text = conversation_text.clone();
            let mem_dir = memory_dir.clone();
            tokio::task::spawn_blocking(move || {
                let mem_store = ChatMemoryStore::new(&mem_dir.join("chat_memory"));
                if let Some(content) = last_content {
                    let _ = mem_store.save_chat_memory(&name, &user_name, "user", &content);
                }
                mem_store.inject_memories_into_prompt(&name, &conv_text)
            })
            .await
            .unwrap_or_default()
        };

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

        // Prepend all prompt fragments as system messages in order (O(n) instead of O(n²))
        let system_msgs: Vec<_> = fragments
            .into_iter()
            .map(|f| ChatMessage::system(f.content))
            .collect();
        let mut new_messages = system_msgs;
        new_messages.append(&mut messages);
        messages = new_messages;

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
        let original_len = token_msgs.len();
        tokenizer::truncate_messages(
            &mut token_msgs,
            budget as usize,
            &model,
            2, // keep at least last 2 messages (user + space for assistant)
        );
        // Align truncated messages with original by index.
        // truncate_messages removes from the front, so the survivors are a suffix.
        let removed = original_len - token_msgs.len();
        if removed > 0 {
            messages.drain(0..removed);
        }
    }

    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zeroclaw_providers::ChatMessage;

    #[test]
    fn non_empty_trims_and_filters() {
        assert_eq!(non_empty(Some("  hi  ")), Some("hi".to_string()));
        assert_eq!(non_empty(Some("   ")), None);
        assert_eq!(non_empty(None), None);
    }

    #[test]
    fn default_mode_is_play() {
        assert_eq!(default_mode(), "play");
    }

    #[test]
    fn default_true_is_true() {
        assert!(default_true());
    }

    #[test]
    fn prompt_order_presets_resolve_known_names() {
        assert!(prompt_order_from_preset(Some("style_first")).is_some());
        assert!(prompt_order_from_preset(Some("scenario_last")).is_some());
        assert!(prompt_order_from_preset(Some("unknown")).is_none());
        assert!(prompt_order_from_preset(None).is_none());
    }

    #[test]
    fn matching_lorebook_filters_disabled_and_missing_keys() {
        let entries = vec![
            RequestLorebookEntry {
                keys: vec!["match".to_string()],
                content: "active entry".to_string(),
                enabled: true,
            },
            RequestLorebookEntry {
                keys: vec!["other".to_string()],
                content: "disabled entry".to_string(),
                enabled: false,
            },
            RequestLorebookEntry {
                keys: vec![],
                content: "no keys".to_string(),
                enabled: true,
            },
            RequestLorebookEntry {
                keys: vec!["match".to_string()],
                content: "   ".to_string(),
                enabled: true,
            },
        ];
        let hits = matching_lorebook_content(&entries, "this match is here");
        assert_eq!(hits, vec!["active entry".to_string()]);
    }

    #[test]
    fn formatting_note_aggregates_all_present_fields() {
        let req = ChatRequest {
            messages: vec![],
            character_name: None,
            mode: "play".to_string(),
            stream: false,
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            frequency_penalty: None,
            presence_penalty: None,
            stop: None,
            seed: None,
            user_name: None,
            user_description: None,
            max_context_tokens: None,
            scene_mode: None,
            system_prompts: vec![],
            scenario: None,
            example_dialogue: None,
            lorebook: vec![],
            system_prompt_override: None,
            authors_note: None,
            authors_note_depth: None,
            prompt_order: None,
            user_prefix: Some("U>".to_string()),
            model_prefix: Some("M>".to_string()),
            context_template: None,
            prompt_template: None,
            negative_prompt: None,
        };
        let note = formatting_note(&req).expect("expected formatting note");
        assert!(note.contains("User speaker prefix: U>"));
        assert!(note.contains("Assistant/character speaker prefix: M>"));
        assert!(note.starts_with("[Formatting instructions]"));
    }

    #[test]
    fn formatting_note_returns_none_when_empty() {
        let req = ChatRequest {
            messages: vec![],
            character_name: None,
            mode: "play".to_string(),
            stream: false,
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            frequency_penalty: None,
            presence_penalty: None,
            stop: None,
            seed: None,
            user_name: None,
            user_description: None,
            max_context_tokens: None,
            scene_mode: None,
            system_prompts: vec![],
            scenario: None,
            example_dialogue: None,
            lorebook: vec![],
            system_prompt_override: None,
            authors_note: None,
            authors_note_depth: None,
            prompt_order: None,
            user_prefix: None,
            model_prefix: None,
            context_template: None,
            prompt_template: None,
            negative_prompt: None,
        };
        assert!(formatting_note(&req).is_none());
    }

    #[test]
    fn insert_system_before_history_places_before_first_non_system() {
        let mut msgs = vec![
            ChatMessage::system("sys1".to_string()),
            ChatMessage::user("hi".to_string()),
            ChatMessage::assistant("hello".to_string()),
        ];
        insert_system_before_history(&mut msgs, "inserted".to_string());
        assert_eq!(msgs[0].content, "sys1");
        assert_eq!(msgs[1].content, "inserted");
        assert_eq!(msgs[1].role, "system");
        assert_eq!(msgs[2].content, "hi");
        assert_eq!(msgs[3].content, "hello");
    }

    #[test]
    fn insert_system_before_history_appends_when_all_system() {
        let mut msgs = vec![ChatMessage::system("sys1".to_string())];
        insert_system_before_history(&mut msgs, "inserted".to_string());
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[1].content, "inserted");
    }

    #[test]
    fn insert_author_note_respects_depth() {
        // 1 system + 4 user/assistant turns; depth=0 means right before the
        // latest message, depth=1 means one before that, etc.
        let mut msgs = vec![
            ChatMessage::system("sys".to_string()),
            ChatMessage::user("u1".to_string()),
            ChatMessage::assistant("a1".to_string()),
            ChatMessage::user("u2".to_string()),
            ChatMessage::assistant("a2".to_string()),
        ];
        insert_author_note(&mut msgs, "note".to_string(), 0);
        // depth=0 → insert before the last non-system message (a2)
        assert_eq!(msgs.last().expect("has last").content, "a2");
        assert_eq!(msgs[msgs.len() - 2].content, "[Author's note]\nnote");
        assert_eq!(msgs[msgs.len() - 2].role, "system");
    }

    #[test]
    fn insert_author_note_clamps_depth_beyond_length() {
        let mut msgs = vec![
            ChatMessage::user("u1".to_string()),
            ChatMessage::assistant("a1".to_string()),
        ];
        insert_author_note(&mut msgs, "note".to_string(), 10);
        // depth=10 clamps to 1 → insert before first non-system (u1)
        assert_eq!(msgs[0].content, "[Author's note]\nnote");
        assert_eq!(msgs[0].role, "system");
        assert_eq!(msgs[1].content, "u1");
    }

    #[test]
    fn read_first_existing_text_returns_first_readable() {
        let dir =
            std::env::temp_dir().join(format!("zeroclaw_chat_prompt_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let p1 = dir.join("missing.txt");
        let p2 = dir.join("present.txt");
        std::fs::write(&p2, "  hello  ").unwrap();
        let got = read_first_existing_text([p1, p2]);
        assert_eq!(got.as_deref(), Some("hello"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_first_existing_text_returns_none_for_empty() {
        let dir = std::env::temp_dir().join(format!(
            "zeroclaw_chat_prompt_test_empty_{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("blank.txt");
        std::fs::write(&p, "   \n  ").unwrap();
        assert!(read_first_existing_text([p]).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn chat_request_deserializes_minimal_payload() {
        // Old-client shape: only messages. All other fields default.
        let json = r#"[{"role":"user","content":"hi"}]"#;
        // Wrap in object for ChatRequest shape:
        let wrapped = format!(r#"{{"messages":{json}}}"#);
        let req: ChatRequest = serde_json::from_str(&wrapped).expect("parses");
        assert_eq!(req.messages.len(), 1);
        assert_eq!(req.mode, "play");
        assert!(!req.stream);
    }

    #[test]
    fn chat_request_deserializes_lorebook_with_default_enabled() {
        let payload = r#"{
            "messages": [],
            "lorebook": [
                {"keys": ["x"], "content": "y"}
            ]
        }"#;
        let req: ChatRequest = serde_json::from_str(payload).expect("parses");
        assert_eq!(req.lorebook.len(), 1);
        assert!(req.lorebook[0].enabled, "enabled should default to true");
    }
}
