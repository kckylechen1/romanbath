// chat_memory.rs — High-level chat memory integration for RomanBath.
//
// Provides ChatMemoryStore that partitions memories by character_name,
// with save/recall/inject operations for the chat pipeline.

use rusqlite::Connection;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::memory_crud::{self, MemoryError};
use crate::noise::{is_noise_text, should_skip_query};
use crate::scorer;
use crate::types::{MemoryEntry, SearchResult};

/// Manages chat memory storage, partitioned by character_name.
pub struct ChatMemoryStore {
    db_path: PathBuf,
}

impl ChatMemoryStore {
    /// Create a new store. DB file is `{base_dir}/{character_name}_memory.db`.
    /// Each character gets its own SQLite database.
    pub fn new(base_dir: &Path) -> Self {
        Self {
            db_path: base_dir.to_path_buf(),
        }
    }

    fn db_path_for(&self, character_name: &str) -> PathBuf {
        let safe_name = character_name
            .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
        self.db_path.join(format!("{safe_name}_memory.db"))
    }

    fn open(&self, character_name: &str) -> Result<Connection, MemoryError> {
        let path = self.db_path_for(character_name);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = if path.exists() {
            Connection::open(&path)?
        } else {
            let conn = Connection::open(&path)?;
            crate::schema::init_schema(&conn)?;
            conn
        };
        Ok(conn)
    }

    fn open_mut(&self, character_name: &str) -> Result<Connection, MemoryError> {
        self.open(character_name)
    }

    /// Save a chat message as a memory entry.
    pub fn save_chat_memory(
        &self,
        character_name: &str,
        user_name: &str,
        role: &str,
        content: &str,
    ) -> Result<Option<String>, MemoryError> {
        // Filter noise
        if is_noise_text(content, Some(role)) {
            return Ok(None);
        }

        let mut conn = self.open_mut(character_name)?;

        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = memory_crud::now_utc_iso();

        // Determine category based on content heuristics
        let category = infer_category(content);
        let importance = infer_importance(content);

        // Extract entities: user name + any mentioned names
        let mut entities = vec![user_name.to_string(), character_name.to_string()];
        entities.extend(extract_mentions(content));

        let path = format!("/chat/{character_name}/memories/{role}");

        let entry = MemoryEntry {
            id,
            path,
            summary: content.chars().take(100).collect(),
            text: content.to_string(),
            importance,
            timestamp,
            category,
            keywords: vec![],
            entities,
            source: "chat".to_string(),
            scope: "user".to_string(),
            archived: false,
            access_count: 0,
            last_access: None,
            retention_policy: None,
            metadata: serde_json::json!({
                "role": role,
                "user_name": user_name,
            }),
            recall_count: 0,
            query_diversity: 0,
            tier: "raw".to_string(),
        };

        let entry_id = entry.id.clone();
        memory_crud::upsert(&mut conn, &entry)?;
        Ok(Some(entry_id))
    }

    /// Search for memories relevant to a query.
    pub fn recall_memories(
        &self,
        character_name: &str,
        query: &str,
        top_k: usize,
    ) -> Result<Vec<SearchResult>, MemoryError> {
        if should_skip_query(query) {
            return Ok(vec![]);
        }

        let conn = match self.open(character_name) {
            Ok(c) => c,
            Err(e) => {
                return Err(e);
            }
        };

        let path_prefix = format!("/chat/{character_name}/memories");
        let fts_scores = memory_crud::search_fts(&conn, query, top_k * 2, Some(&path_prefix))?;

        if fts_scores.is_empty() {
            return Ok(vec![]);
        }

        let ids: Vec<String> = fts_scores.keys().cloned().collect();
        let entries = memory_crud::fetch_by_ids(&conn, &ids)?;

        // Compute symbolic scores
        let mut symbolic_scores = HashMap::new();
        for (id, entry) in &entries {
            let score = scorer::symbolic_score(query, &entry.text, &entry.keywords, &entry.entities);
            symbolic_scores.insert(id.clone(), score);
        }

        // Build hybrid scores
        let entries_ref: HashMap<String, &MemoryEntry> =
            entries.iter().map(|(k, v)| (k.clone(), v)).collect();
        let weights = scorer::HybridWeights::default();
        let scores = scorer::hybrid_score(&entries_ref, &fts_scores, &symbolic_scores, &weights);

        // Record access for ACT-R tracking
        let fts_hit_ids: Vec<String> = fts_scores.keys().cloned().collect();
        let all_hit_ids: Vec<String> = scores.keys().cloned().collect();
        let _ = memory_crud::record_access(&conn, &all_hit_ids, &fts_hit_ids, Some(query));

        // Sort by final score, take top_k
        let mut ranked: Vec<(String, crate::types::HybridScore)> = scores.into_iter().collect();
        ranked.sort_by(|a, b| b.1.final_score.total_cmp(&a.1.final_score));
        ranked.truncate(top_k);

        let mut results = Vec::new();
        for (id, hs) in ranked {
            if let Some(entry) = entries.get(&id) {
                results.push(SearchResult {
                    entry: entry.clone(),
                    score: hs,
                });
            }
        }

        Ok(results)
    }

    /// Inject relevant memories into a prompt. Returns formatted text block.
    pub fn inject_memories_into_prompt(
        &self,
        character_name: &str,
        conversation_text: &str,
    ) -> String {
        // Use the last user message as the recall query
        let query = extract_last_user_message(conversation_text);
        let query = match query {
            Some(q) => q,
            None => return String::new(),
        };

        match self.recall_memories(character_name, &query, 5) {
            Ok(results) if results.is_empty() => String::new(),
            Ok(results) => {
                let mut lines = vec!["[Relevant memories from past conversations]".to_string()];
                for r in &results {
                    let ts = &r.entry.timestamp[..10.min(r.entry.timestamp.len())];
                    lines.push(format!(
                        "- ({}, {}) {}",
                        ts, r.entry.category, r.entry.text
                    ));
                }
                lines.join("\n")
            }
            Err(_) => String::new(),
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn infer_category(content: &str) -> String {
    let lower = content.to_ascii_lowercase();
    if lower.contains("i prefer") || lower.contains("i like") || lower.contains("i hate") {
        "preference".to_string()
    } else if lower.contains("let's ") || lower.contains("决定") || lower.contains("我们") {
        "decision".to_string()
    } else if lower.contains("remember") || lower.contains("记住") || lower.contains("forgot") {
        "fact".to_string()
    } else {
        "experience".to_string()
    }
}

fn infer_importance(content: &str) -> f64 {
    let lower = content.to_ascii_lowercase();
    if lower.contains("important") || lower.contains("关键") || lower.contains("必须") {
        0.9
    } else if lower.contains("remember") || lower.contains("记住") || lower.contains("prefer") {
        0.8
    } else if lower.contains("maybe") || lower.contains("也许") || lower.contains("大概") {
        0.5
    } else {
        0.7
    }
}

fn extract_mentions(content: &str) -> Vec<String> {
    // Simple @mention extraction
    let mut mentions = Vec::new();
    for word in content.split_whitespace() {
        if word.starts_with('@') && word.len() > 1 {
            mentions.push(word[1..].to_string());
        }
    }
    mentions
}

fn extract_last_user_message(conversation_text: &str) -> Option<String> {
    // Find the last "user: " line in the conversation
    let mut last_user = None;
    for line in conversation_text.lines() {
        if let Some(content) = line.strip_prefix("user: ") {
            last_user = Some(content.to_string());
        } else if let Some(content) = line.strip_prefix("User: ") {
            last_user = Some(content.to_string());
        }
    }
    last_user
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (tempfile::TempDir, ChatMemoryStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ChatMemoryStore::new(dir.path());
        (dir, store)
    }

    #[test]
    fn save_and_recall() {
        let (_dir, store) = temp_store();
        let result = store.save_chat_memory(
            "test_char",
            "Alice",
            "user",
            "I prefer using dark mode for everything",
        );
        assert!(result.is_ok(), "save_chat_memory failed: {:?}", result.err());

        // Now test via recall_memories (query must be >= 10 chars for non-CJK, and FTS AND semantics)
        let memories = store
            .recall_memories("test_char", "prefer dark mode everything", 5)
            .unwrap();
        assert!(!memories.is_empty(), "Should recall saved memory");
    }

    #[test]
    fn filters_noise() {
        let (_dir, store) = temp_store();
        let result = store.save_chat_memory("test_char2", "Bob", "user", "ok");
        assert_eq!(result.unwrap(), None);
    }

    #[test]
    fn filters_system_messages() {
        let (_dir, store) = temp_store();
        let result = store.save_chat_memory(
            "test_char3",
            "Bob",
            "system",
            "The user is talking about something",
        );
        assert_eq!(result.unwrap(), None);
    }

    #[test]
    fn inject_into_prompt() {
        let (_dir, store) = temp_store();
        store
            .save_chat_memory(
                "test_char4",
                "Alice",
                "user",
                "I prefer using TypeScript for all new projects",
            )
            .unwrap();

        let injected = store.inject_memories_into_prompt(
            "test_char4",
            "User: TypeScript new projects",
        );
        assert!(!injected.is_empty());
        assert!(injected.contains("TypeScript"));
    }
}
