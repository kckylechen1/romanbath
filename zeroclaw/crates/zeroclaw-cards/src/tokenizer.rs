//! Token counting and context truncation for SillyTavern-style prompt management.
//!
//! Uses tiktoken-rs to count tokens against model-appropriate encodings and
//! truncate conversation history to fit within a token budget.

use tiktoken_rs::CoreBPE;

/// A lightweight message representation for token counting.
/// Avoids depending on zeroclaw-api's ChatMessage type — callers convert
/// their message type into this at the call site.
#[derive(Debug, Clone)]
pub struct TokenMessage {
    pub role: String,
    pub content: String,
}

impl TokenMessage {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self { role: role.into(), content: content.into() }
    }
}

/// Select the tiktoken encoding appropriate for the given model name.
///
/// - `gpt-4*` → o200k_base (GPT-4o / GPT-4-turbo family)
/// - `gpt-3.5*` → cl100k_base
/// - `claude*` → cl100k_base (Anthropic models approximate with cl100k)
/// - everything else → cl100k_base (safe default)
fn get_bpe(model: &str) -> CoreBPE {
    let lower = model.to_lowercase();
    if lower.starts_with("gpt-4") || lower.starts_with("gpt4") {
        tiktoken_rs::o200k_base().unwrap_or_else(|_| tiktoken_rs::cl100k_base().expect("cl100k_base must load"))
    } else {
        tiktoken_rs::cl100k_base().expect("cl100k_base must load")
    }
}

/// Count the number of tokens in a plain text string for the given model.
pub fn count_tokens(text: &str, model: &str) -> usize {
    let bpe = get_bpe(model);
    bpe.encode_with_special_tokens(text).len()
}

/// Count the total tokens across a slice of chat messages.
///
/// Adds 4 tokens overhead per message (SillyTavern convention for
/// role/formatting overhead).
pub fn count_message_tokens(messages: &[TokenMessage], model: &str) -> usize {
    let bpe = get_bpe(model);
    let mut total: usize = 0;
    for msg in messages {
        total += bpe.encode_with_special_tokens(&msg.content).len();
        total += bpe.encode_with_special_tokens(&msg.role).len();
        total += 4; // per-message overhead (ST convention)
    }
    total
}

/// Truncate a message list to fit within `max_tokens`.
///
/// Removes the oldest non-system messages from the front of the list until
/// the total token count fits within `max_tokens`. Always keeps at least
/// `min_messages` messages from the end of the list (default 2: last user
/// message + space for assistant reply). Never removes system messages.
///
/// The caller must ensure `messages` is ordered oldest-first.
pub fn truncate_messages(
    messages: &mut Vec<TokenMessage>,
    max_tokens: usize,
    model: &str,
    min_messages: usize,
) {
    if messages.is_empty() {
        return;
    }

    // Fast path: already within budget
    if count_message_tokens(messages, model) <= max_tokens {
        return;
    }

    loop {
        if count_message_tokens(messages, model) <= max_tokens {
            break;
        }

        // Find the first non-system message to remove
        let idx = messages
            .iter()
            .position(|m| m.role != "system");

        match idx {
            Some(i) => {
                // Don't remove if we'd go below preserved count
                let non_system_count = messages.iter().filter(|m| m.role != "system").count();
                if non_system_count <= min_messages.max(1) {
                    break;
                }
                messages.remove(i);
            }
            None => break, // only system messages left
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_tokens_non_empty() {
        let count = count_tokens("Hello, world!", "gpt-3.5-turbo");
        assert!(count > 0, "token count should be positive");
    }

    #[test]
    fn test_count_tokens_model_mapping() {
        // Both should succeed without panicking
        let _ = count_tokens("test", "gpt-4");
        let _ = count_tokens("test", "gpt-3.5-turbo");
        let _ = count_tokens("test", "claude-3-opus");
        let _ = count_tokens("test", "unknown-model");
    }

    #[test]
    fn test_count_message_tokens_overhead() {
        let msgs = vec![
            TokenMessage::new("system", "You are helpful."),
            TokenMessage::new("user", "Hello"),
        ];
        let total = count_message_tokens(&msgs, "gpt-3.5-turbo");
        // Should be > sum of individual content tokens due to 4-token overhead per msg
        let content_only = count_tokens("You are helpful.", "gpt-3.5-turbo")
            + count_tokens("system", "gpt-3.5-turbo")
            + count_tokens("Hello", "gpt-3.5-turbo")
            + count_tokens("user", "gpt-3.5-turbo");
        assert!(total > content_only, "should include overhead");
    }

    #[test]
    fn test_truncate_removes_oldest_non_system() {
        let mut msgs = vec![
            TokenMessage::new("system", "system prompt"),
            TokenMessage::new("user", "msg 1"),
            TokenMessage::new("assistant", "reply 1 with some extra text to add tokens"),
            TokenMessage::new("user", "msg 2"),
            TokenMessage::new("assistant", "reply 2 with even more text to ensure we have tokens to count"),
            TokenMessage::new("user", "msg 3"),
        ];

        // Use a very small budget that should trigger truncation
        truncate_messages(&mut msgs, 20, "gpt-3.5-turbo", 2);

        // System messages should be preserved
        assert!(msgs[0].role == "system");
        assert!(msgs[0].content == "system prompt");

        // Last 2 messages should be preserved (min_messages = 2)
        assert!(msgs.len() >= 3); // at least system + 2 preserved
    }

    #[test]
    fn test_truncate_noop_when_within_budget() {
        let mut msgs = vec![
            TokenMessage::new("system", "hi"),
            TokenMessage::new("user", "hello"),
        ];
        let len_before = msgs.len();
        truncate_messages(&mut msgs, 100_000, "gpt-3.5-turbo", 2);
        assert_eq!(msgs.len(), len_before, "no messages should be removed");
    }
}
