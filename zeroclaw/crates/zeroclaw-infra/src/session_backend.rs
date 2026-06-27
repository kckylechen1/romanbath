//! Trait abstraction for session persistence backends.
//!
//! Backends store per-sender conversation histories. The trait is intentionally
//! minimal — load, append, remove_last, clear_messages, list — so that JSONL
//! and SQLite (and future backends) share a common interface.

use chrono::{DateTime, Utc};
use zeroclaw_api::model_provider::ChatMessage;

/// Metadata about a persisted session.
#[derive(Debug, Clone)]
pub struct SessionMetadata {
    /// Session key (e.g. `telegram_user123`).
    pub key: String,
    /// Optional human-readable name (e.g. `eyrie-commander-briefing`).
    pub name: Option<String>,
    /// When the session was first created.
    pub created_at: DateTime<Utc>,
    /// When the last message was appended.
    pub last_activity: DateTime<Utc>,
    /// Total number of messages in the session.
    pub message_count: usize,
    /// Alias of the agent that owned this session (HashMap key in
    /// `config.agents`). `None` for sessions persisted before per-agent
    /// attribution landed, or for backends that don't track it.
    pub agent_alias: Option<String>,
    /// Dotted ChannelRef the session belongs to (`<type>.<alias>`,
    /// e.g. `discord.clamps`). `None` for non-channel sessions (CLI,
    /// internal cron runs) or backends without routing columns.
    pub channel_id: Option<String>,
    /// Platform-side room / thread identifier (Discord channel id,
    /// Matrix room id, Slack thread ts, ...). `None` for direct messages
    /// or backends that don't track it.
    pub room_id: Option<String>,
    /// Inbound sender id verbatim (Discord username, phone number, ...).
    /// Not an FK — sessions can survive deletion of the upstream user.
    pub sender_id: Option<String>,
}

/// Structured routing context recorded alongside a session. Mirrors the
/// `ChannelMessage` fields the orchestrator uses to compose
/// `conversation_history_key` so the session row can be queried by
/// channel / room / sender without re-parsing the synthetic key.
#[derive(Debug, Clone, Default)]
pub struct SessionContext<'a> {
    /// `<type>.<alias>` ChannelRef (`discord.clamps`).
    pub channel_id: Option<&'a str>,
    /// Platform-side room / thread id.
    pub room_id: Option<&'a str>,
    /// Inbound sender id (channel-native username, phone, ...).
    pub sender_id: Option<&'a str>,
}

/// Query parameters for listing sessions.
#[derive(Debug, Clone, Default)]
pub struct SessionQuery {
    /// Keyword to search in session messages (FTS5 if available).
    pub keyword: Option<String>,
    /// Maximum number of sessions to return.
    pub limit: Option<usize>,
}

/// One persisted message with the optional `created_at` the backend
/// stamped on it. JSONL / in-memory backends return `None`; SQLite
/// returns the row's `created_at` column.
#[derive(Debug, Clone)]
pub struct TimestampedMessage {
    pub message: ChatMessage,
    pub created_at: Option<DateTime<Utc>>,
}

/// One node in a conversation TREE (companion-chat branching model).
///
/// The linear `ChatMessage` only carries `{role, content}`; a tree node adds
/// the client-minted stable `msg_id`, its `parent_id` (None = root), an
/// optional `author_id` (group chat: which character spoke), a streaming
/// `status`, and a `meta` blob for purely-presentational fields (tool calls,
/// media URLs) that have no column of their own. Backends that don't model a
/// tree (JSONL, in-memory) leave the tree fields untouched via the trait's
/// default methods and behave linearly.
#[derive(Debug, Clone)]
pub struct ConversationNode {
    /// Client-minted stable id (the tree's identity; not the SQLite rowid).
    pub msg_id: String,
    /// Parent node's `msg_id`. `None` marks a root.
    pub parent_id: Option<String>,
    pub role: String,
    pub content: String,
    /// Group chat: the answering character's id. `None` for single-character
    /// or user nodes.
    pub author_id: Option<String>,
    /// `"complete"` | `"streaming"` | `"interrupted"`. `None` == complete.
    pub status: Option<String>,
    /// JSON blob for presentational fields that have no dedicated column
    /// (e.g. `toolCalls`, media). `None` when there are none.
    pub meta: Option<serde_json::Value>,
    /// Stamp the backend recorded, when it has one.
    pub created_at: Option<DateTime<Utc>>,
}

/// Trait for session persistence backends.
///
/// Implementations must be `Send + Sync` for sharing across async tasks.
pub trait SessionBackend: Send + Sync {
    /// Load all messages for a session. Returns empty vec if session doesn't exist.
    fn load(&self, session_key: &str) -> Vec<ChatMessage>;

    /// Same as `load`, but each row carries its persisted `created_at`
    /// when the backend has one. Default impl falls back to `load`
    /// without timestamps so non-SQLite backends keep working.
    fn load_with_timestamps(&self, session_key: &str) -> Vec<TimestampedMessage> {
        self.load(session_key)
            .into_iter()
            .map(|message| TimestampedMessage {
                message,
                created_at: None,
            })
            .collect()
    }

    /// Append a single message to a session.
    fn append(&self, session_key: &str, message: &ChatMessage) -> std::io::Result<()>;

    /// Remove the last message from a session. Returns `true` if a message was removed.
    fn remove_last(&self, session_key: &str) -> std::io::Result<bool>;

    /// Update the content of the last message in a session. Used for incremental
    /// persistence of streaming responses — append a placeholder first, then
    /// update_last periodically as more content arrives. Returns `false` if
    /// the session is empty. Default implementation is remove_last + append
    /// (backends can override for efficiency).
    fn update_last(&self, session_key: &str, message: &ChatMessage) -> std::io::Result<bool> {
        if self.remove_last(session_key)? {
            self.append(session_key, message)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// List all session keys.
    fn list_sessions(&self) -> Vec<String>;

    /// List sessions with metadata.
    fn list_sessions_with_metadata(&self) -> Vec<SessionMetadata> {
        // Default: construct metadata from messages (backends can override for efficiency)
        self.list_sessions()
            .into_iter()
            .map(|key| {
                let messages = self.load(&key);
                SessionMetadata {
                    key,
                    name: None,
                    created_at: Utc::now(),
                    last_activity: Utc::now(),
                    message_count: messages.len(),
                    agent_alias: None,
                    channel_id: None,
                    room_id: None,
                    sender_id: None,
                }
            })
            .collect()
    }

    /// Compact a session file (remove duplicates/corruption). No-op by default.
    fn compact(&self, _session_key: &str) -> std::io::Result<()> {
        Ok(())
    }

    /// Remove sessions that haven't been active within the given TTL hours.
    fn cleanup_stale(&self, _ttl_hours: u32) -> std::io::Result<usize> {
        Ok(0)
    }

    /// Search sessions by keyword. Default returns empty (backends with FTS override).
    fn search(&self, _query: &SessionQuery) -> Vec<SessionMetadata> {
        Vec::new()
    }

    /// Clear all messages from a session, keeping the session itself alive.
    /// Returns the number of messages removed.
    ///
    /// Override for production use. The default is O(n²) via iterative
    /// `remove_last` — acceptable for tests but may cause latency on
    /// sessions with >100 messages.
    fn clear_messages(&self, session_key: &str) -> std::io::Result<usize> {
        let mut count = 0;
        while self.remove_last(session_key)? {
            count += 1;
        }
        Ok(count)
    }

    /// Delete all messages for a session. Returns `true` if the session existed.
    fn delete_session(&self, _session_key: &str) -> std::io::Result<bool> {
        Ok(false)
    }

    /// Set or update the human-readable name for a session.
    fn set_session_name(&self, _session_key: &str, _name: &str) -> std::io::Result<()> {
        Ok(())
    }

    /// Get the human-readable name for a session (if set).
    fn get_session_name(&self, _session_key: &str) -> std::io::Result<Option<String>> {
        Ok(None)
    }

    /// Record the agent alias that owns a session. Called on WebSocket
    /// handshake when the alias is known. No-op for backends that don't
    /// track per-agent attribution.
    fn set_session_agent_alias(
        &self,
        _session_key: &str,
        _agent_alias: &str,
    ) -> std::io::Result<()> {
        Ok(())
    }

    /// Get the agent alias associated with a session, if recorded.
    fn get_session_agent_alias(&self, _session_key: &str) -> std::io::Result<Option<String>> {
        Ok(None)
    }

    /// Record the channel / room / sender routing context for a session.
    /// Called by channel orchestrators right before the LLM dispatch so
    /// the session row can be filtered by platform attribute in the
    /// dashboard. No-op default; SQLite override fills the columns added
    /// in the structured-routing migration.
    fn set_session_context(
        &self,
        _session_key: &str,
        _context: SessionContext<'_>,
    ) -> std::io::Result<()> {
        Ok(())
    }

    /// Look up metadata for a single session by key.
    ///
    /// The default impl loads all messages to derive the count and calls
    /// `get_session_name` for the name. `created_at` and `last_activity` are
    /// set to `Utc::now()` at call time — backends with stored timestamps
    /// (e.g. SQLite) should override this method.
    fn get_session_metadata(&self, session_key: &str) -> Option<SessionMetadata> {
        let messages = self.load(session_key);
        if messages.is_empty() {
            return None;
        }
        Some(SessionMetadata {
            key: session_key.to_string(),
            name: self.get_session_name(session_key).ok().flatten(),
            created_at: Utc::now(),
            last_activity: Utc::now(),
            message_count: messages.len(),
            agent_alias: None,
            channel_id: None,
            room_id: None,
            sender_id: None,
        })
    }

    /// Set the session state (e.g. "idle", "running", "error").
    /// `turn_id` identifies the current turn (set when running, cleared on idle).
    fn set_session_state(
        &self,
        _session_key: &str,
        _state: &str,
        _turn_id: Option<&str>,
    ) -> std::io::Result<()> {
        Ok(())
    }

    /// Get the current session state. Returns `None` if the backend doesn't track state.
    fn get_session_state(&self, _session_key: &str) -> std::io::Result<Option<SessionState>> {
        Ok(None)
    }

    /// List sessions currently in "running" state.
    fn list_running_sessions(&self) -> Vec<SessionMetadata> {
        Vec::new()
    }

    /// List sessions stuck in "running" state longer than `threshold_secs`.
    fn list_stuck_sessions(&self, _threshold_secs: u64) -> Vec<SessionMetadata> {
        Vec::new()
    }

    // ── Conversation-tree API (companion branching) ───────────────────
    //
    // Every method below has a linear-fallback default so JSONL / in-memory
    // backends keep compiling and behave linearly. Only a tree-aware backend
    // (SQLite) overrides them. None of these are wired into the chat path yet
    // (Phase 0 is dark infra); they exist so later phases can build on them.

    /// Append a node carrying tree fields. Default drops the tree fields and
    /// appends a plain message (linear behavior).
    fn append_node(&self, session_key: &str, node: &ConversationNode) -> std::io::Result<()> {
        self.append(
            session_key,
            &ChatMessage {
                role: node.role.clone(),
                content: node.content.clone(),
            },
        )
    }

    /// Update an existing node (by `msg_id`) — used for streaming content +
    /// status/meta finalization. Default falls back to `update_last` (linear
    /// backends have no node identity, so they update the tail).
    fn update_node(&self, session_key: &str, node: &ConversationNode) -> std::io::Result<bool> {
        self.update_last(
            session_key,
            &ChatMessage {
                role: node.role.clone(),
                content: node.content.clone(),
            },
        )
    }

    /// Load the full conversation tree. Default wraps `load()` as one linear
    /// chain (each node's parent is the previous message), with synthesized
    /// ids so a linear backend still answers tree queries coherently.
    fn load_tree(&self, session_key: &str) -> Vec<ConversationNode> {
        let mut prev: Option<String> = None;
        self.load(session_key)
            .into_iter()
            .enumerate()
            .map(|(i, m)| {
                let msg_id = format!("lin-{i}");
                let parent_id = prev.take();
                prev = Some(msg_id.clone());
                ConversationNode {
                    msg_id,
                    parent_id,
                    role: m.role,
                    content: m.content,
                    author_id: None,
                    status: None,
                    meta: None,
                    created_at: None,
                }
            })
            .collect()
    }

    /// Load the active conversation path (root → active leaf) as a flat message
    /// list — exactly what gets seeded into the model. Default: the linear
    /// `load()` (a linear backend has only one path).
    fn load_active_path(&self, session_key: &str) -> Vec<ChatMessage> {
        self.load(session_key)
    }

    /// Load the path from a specific leaf back to the root, flattened. Default
    /// ignores the leaf and returns the linear `load()`.
    fn load_path(&self, session_key: &str, _leaf_id: &str) -> Vec<ChatMessage> {
        self.load(session_key)
    }

    /// The currently-selected leaf `msg_id` (which branch the client last
    /// rendered). Default: none.
    fn get_active_leaf(&self, _session_key: &str) -> Option<String> {
        None
    }

    /// Record the selected leaf. Default: no-op (linear backends have one leaf).
    fn set_active_leaf(&self, _session_key: &str, _msg_id: &str) -> std::io::Result<()> {
        Ok(())
    }

    /// Delete a node and its entire subtree, returning the removed `msg_id`s.
    /// Default: no-op (linear backends don't model subtrees; tree-aware
    /// backends override).
    fn delete_subtree(&self, _session_key: &str, _msg_id: &str) -> std::io::Result<Vec<String>> {
        Ok(Vec::new())
    }

    /// The leaf a new turn should extend: the explicit active leaf if set,
    /// else the tree's deepest leaf. For a legacy purely-linear session this
    /// resolves to the tail, so appending a new turn under this tip keeps the
    /// old history connected to the new branch (no orphaned roots on resume).
    /// Default: the active leaf (or `None`).
    fn conversation_tip(&self, session_key: &str) -> Option<String> {
        self.get_active_leaf(session_key)
    }
}

/// Session state information.
#[derive(Debug, Clone)]
pub struct SessionState {
    /// Current state: "idle", "running", or "error".
    pub state: String,
    /// Turn ID of the active or last turn.
    pub turn_id: Option<String>,
    /// When the current state was entered.
    pub turn_started_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_metadata_is_constructible() {
        let meta = SessionMetadata {
            key: "test".into(),
            name: None,
            created_at: Utc::now(),
            last_activity: Utc::now(),
            message_count: 5,
            agent_alias: None,
            channel_id: None,
            room_id: None,
            sender_id: None,
        };
        assert_eq!(meta.key, "test");
        assert_eq!(meta.message_count, 5);
    }

    #[test]
    fn session_query_defaults() {
        let q = SessionQuery::default();
        assert!(q.keyword.is_none());
        assert!(q.limit.is_none());
    }
}
