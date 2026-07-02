// chat_memory.rs — High-level chat memory integration for RomanBath.
//
// Provides ChatMemoryStore that partitions memories by character_name,
// with save/recall/inject operations for the chat pipeline.

use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
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
        let safe_name =
            character_name.replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
        self.db_path.join(format!("{safe_name}_memory.db"))
    }

    fn open(&self, character_name: &str) -> Result<Connection, MemoryError> {
        // Always route through `schema::open` so an existing DB still gets its
        // per-connection PRAGMAs and any pending migrations — not just freshly
        // created files.
        crate::schema::open(&self.db_path_for(character_name))
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
        // Scrub think tags first so they don't pollute the noise checks or DB
        let cleaned_content = crate::noise::scrub_think_tags(content);

        // Filter noise
        if is_noise_text(&cleaned_content, Some(role)) {
            return Ok(None);
        }

        let mut conn = self.open_mut(character_name)?;

        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = memory_crud::now_utc_iso();

        // Determine category based on content heuristics
        let category = infer_category(&cleaned_content);
        let importance = infer_importance(&cleaned_content);

        // Extract entities: user name + any mentioned names
        let mut entities = vec![user_name.to_string(), character_name.to_string()];
        entities.extend(extract_mentions(&cleaned_content));

        let path = format!("/chat/{character_name}/memories/{role}");

        let entry = MemoryEntry {
            id,
            path,
            summary: cleaned_content.chars().take(100).collect(),
            text: cleaned_content,
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
        self.recall_memories_with_vector(character_name, query, None, top_k)
    }

    /// Search for memories relevant to a query, optionally unioning vector hits.
    pub fn recall_memories_with_vector(
        &self,
        character_name: &str,
        query: &str,
        query_vec: Option<&[f32]>,
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
        let vec_scores = if let Some(qv) = query_vec {
            memory_crud::search_vec_brute(&conn, qv, top_k * 2, Some(&path_prefix))?
        } else {
            HashMap::new()
        };

        if fts_scores.is_empty() && vec_scores.is_empty() {
            return Ok(vec![]);
        }
        if query_vec.is_none() && fts_scores.is_empty() {
            return Ok(vec![]);
        }

        let ids: Vec<String> = if query_vec.is_some() {
            let mut seen: HashSet<String> = HashSet::new();
            seen.extend(fts_scores.keys().cloned());
            seen.extend(vec_scores.keys().cloned());
            seen.into_iter().collect()
        } else {
            fts_scores.keys().cloned().collect()
        };
        let entries = memory_crud::fetch_by_ids(&conn, &ids)?;

        // Compute symbolic scores
        let mut symbolic_scores = HashMap::new();
        for (id, entry) in &entries {
            let score =
                scorer::symbolic_score(query, &entry.text, &entry.keywords, &entry.entities);
            symbolic_scores.insert(id.clone(), score);
        }

        // Build hybrid scores
        let entries_ref: HashMap<String, &MemoryEntry> =
            entries.iter().map(|(k, v)| (k.clone(), v)).collect();
        let weights = if query_vec.is_some() {
            scorer::HybridWeights {
                use_rrf: true,
                ..Default::default()
            }
        } else {
            scorer::HybridWeights::default()
        };
        let access_times = memory_crud::get_access_times(&conn, &ids).unwrap_or_default();
        let scores = scorer::hybrid_score(
            &entries_ref,
            &vec_scores,
            &fts_scores,
            &symbolic_scores,
            &weights,
            &access_times,
        );

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

    /// List a character's memories, newest first, scoped to
    /// `/chat/{character_name}/memories`.
    ///
    /// Unlike [`recall_memories`](Self::recall_memories) this is a plain browse:
    /// no query, no FTS ranking, no ACT-R access accounting. It backs the
    /// read-only "what does this character remember" view, and reads the same
    /// per-character store the chat pipeline writes to — so the UI and the
    /// model see the same memories.
    pub fn list_memories(
        &self,
        character_name: &str,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>, MemoryError> {
        let conn = self.open(character_name)?;
        let path_prefix = format!("/chat/{character_name}/memories");
        memory_crud::list_by_path(&conn, &path_prefix, limit)
    }

    /// Hard-delete a single memory by id from this character's store.
    ///
    /// User-initiated and explicit (gated behind a UI confirm) — unlike the
    /// `archived` soft-delete the GC uses, this removes the row, its FTS mirror,
    /// edges, and access history. Returns `true` if a row was found and deleted.
    /// Opens the same per-character connection [`list_memories`](Self::list_memories)
    /// reads from, so the model and the UI agree on what is gone.
    pub fn delete_memory(&self, character_name: &str, id: &str) -> Result<bool, MemoryError> {
        let mut conn = self.open_mut(character_name)?;
        memory_crud::delete(&mut conn, id)
    }

    /// Apply a user edit to one memory: replace `text` (and recompute the
    /// summary as its first ~100 chars), set `category`, and/or pin it.
    /// `None` fields are left untouched. Pinning sets `retention_policy` to
    /// `"pinned"` (GC-exempt); unpinning sets it to `"durable"`.
    ///
    /// Returns the re-read entry (so the caller sees normalized/clamped values
    /// from `upsert`), or `None` if no memory with that id exists. Opens the
    /// per-character connection exactly like [`list_memories`](Self::list_memories).
    pub fn update_memory(
        &self,
        character_name: &str,
        id: &str,
        text: Option<String>,
        category: Option<String>,
        pinned: Option<bool>,
    ) -> Result<Option<MemoryEntry>, MemoryError> {
        let mut conn = self.open_mut(character_name)?;
        let mut entry = match memory_crud::get_by_id(&conn, id)? {
            Some(e) => e,
            None => return Ok(None),
        };

        if let Some(t) = text {
            entry.summary = t.chars().take(100).collect();
            entry.text = t;
        }
        if let Some(c) = category {
            entry.category = c;
        }
        if let Some(p) = pinned {
            entry.retention_policy = Some(if p {
                "pinned".to_string()
            } else {
                "durable".to_string()
            });
        }

        memory_crud::upsert(&mut conn, &entry)?;
        memory_crud::get_by_id(&conn, id)
    }

    /// Move a character's memory when the card is renamed, so a rename doesn't
    /// orphan everything the companion has learned. No-op if the source DB
    /// doesn't exist yet or the names collide.
    ///
    /// Two things have to move, not one: the DB *file* is named by the
    /// (sanitized) character name, and every row's `path`/`entities` *embed*
    /// the (raw) character name (`/chat/{name}/memories/...`). Moving only the
    /// file would leave the rows keyed to the old name — `list_memories(new)`
    /// would query `/chat/{new}/...` and find nothing. So we move the file
    /// (plus WAL/SHM sidecars) and then rewrite the embedded name in place,
    /// reusing the tested `upsert` so the FTS mirror stays in sync.
    ///
    /// Lives here because this type owns both the `{safe_name}_memory.db`
    /// filename and the `/chat/{name}/memories` path convention.
    pub fn rename_character(&self, old_name: &str, new_name: &str) -> Result<(), MemoryError> {
        let old_path = self.db_path_for(old_name);
        let new_path = self.db_path_for(new_name);
        if old_path == new_path || !old_path.exists() {
            return Ok(());
        }

        // 1. Move the DB file and its WAL/SHM sidecars to the new filename.
        std::fs::rename(&old_path, &new_path)?;
        for suffix in ["-wal", "-shm"] {
            let from = append_suffix(&old_path, suffix);
            if from.exists() {
                let _ = std::fs::rename(&from, append_suffix(&new_path, suffix));
            }
        }

        // 2. Rewrite the embedded character name in every row's path + entities.
        let mut conn = crate::schema::open(&new_path)?;
        let old_seg = format!("/chat/{old_name}/");
        let new_seg = format!("/chat/{new_name}/");
        let old_prefix = format!("/chat/{old_name}/memories");
        let entries = memory_crud::list_by_path(&conn, &old_prefix, 1_000_000)?;
        for mut entry in entries {
            entry.path = entry.path.replacen(&old_seg, &new_seg, 1);
            for ent in entry.entities.iter_mut() {
                if ent == old_name {
                    *ent = new_name.to_string();
                }
            }
            memory_crud::upsert(&mut conn, &entry)?;
        }
        Ok(())
    }

    /// Inject relevant memories into a prompt. Returns formatted text block.
    ///
    /// Default path is byte-identical to pre-continuity behavior: learned
    /// patterns are NOT appended unless `ROMANBATH_PATTERN_INJECTION` is set
    /// (Slice 3c, off by default — the over-fit surface stays closed until the
    /// projection/labeler substrate has proven itself). See
    /// [`inject_memories_into_prompt_with`](Self::inject_memories_into_prompt_with)
    /// for the explicit-flag variant used by tests.
    pub fn inject_memories_into_prompt(
        &self,
        character_name: &str,
        conversation_text: &str,
    ) -> String {
        self.inject_memories_into_prompt_with_vector_options(
            character_name,
            conversation_text,
            pattern_injection_enabled(),
            None,
        )
    }

    /// Inject relevant memories into a prompt using an optional query vector.
    pub fn inject_memories_into_prompt_with_vector(
        &self,
        character_name: &str,
        conversation_text: &str,
        query_vec: Option<&[f32]>,
    ) -> String {
        self.inject_memories_into_prompt_with_vector_options(
            character_name,
            conversation_text,
            pattern_injection_enabled(),
            query_vec,
        )
    }

    /// Same as `inject_memories_into_prompt` with an explicit pattern-injection
    /// flag, so tests can exercise both paths without mutating the process env.
    pub fn inject_memories_into_prompt_with(
        &self,
        character_name: &str,
        conversation_text: &str,
        inject_patterns: bool,
    ) -> String {
        self.inject_memories_into_prompt_with_vector_options(
            character_name,
            conversation_text,
            inject_patterns,
            None,
        )
    }

    fn inject_memories_into_prompt_with_vector_options(
        &self,
        character_name: &str,
        conversation_text: &str,
        inject_patterns: bool,
        query_vec: Option<&[f32]>,
    ) -> String {
        // Use the last user message as the recall query
        let query = extract_last_user_message(conversation_text);
        let query = match query {
            Some(q) => q,
            None => return String::new(),
        };

        let memories_block =
            match self.recall_memories_with_vector(character_name, &query, query_vec, 5) {
                Ok(results) if results.is_empty() => String::new(),
                Ok(results) => format_memories_block(&results),
                Err(_) => String::new(),
            };

        // Slice 3c: learned patterns are an OPTIONAL appendix, off by default.
        // When off, `pattern_block` is empty and the return value is
        // byte-identical to the pre-continuity `inject_memories_into_prompt`.
        let pattern_block = if inject_patterns {
            self.pattern_context_block(character_name, 5)
        } else {
            String::new()
        };

        match (memories_block.is_empty(), pattern_block.is_empty()) {
            (true, true) => String::new(),
            (false, true) => memories_block,
            (true, false) => pattern_block,
            (false, false) => format!("{memories_block}\n{pattern_block}"),
        }
    }

    /// Read projected pattern memories for this character (under
    /// `/user/patterns/`), most-mature first. Continuity read-model (Slice 3b).
    /// Additive — nothing injects it until pattern injection is enabled.
    ///
    /// Per-character scope follows the existing ChatMemoryStore partition; the
    /// "global vs per-character pattern memory" question is left open (design
    /// doc open-question #4).
    pub fn pattern_context(
        &self,
        character_name: &str,
        top_k: usize,
    ) -> Result<Vec<MemoryEntry>, MemoryError> {
        let conn = self.open(character_name)?;
        let mut entries = memory_crud::list_by_path(&conn, "/user/patterns", top_k.max(1))?;
        entries.sort_by_key(|e| std::cmp::Reverse(pattern_priority(e)));
        Ok(entries)
    }

    fn pattern_context_block(&self, character_name: &str, top_k: usize) -> String {
        match self.pattern_context(character_name, top_k) {
            Ok(patterns) if patterns.is_empty() => String::new(),
            Ok(patterns) => {
                let mut lines =
                    vec!["[Learned patterns — observed judgment structures]".to_string()];
                for p in &patterns {
                    let seen = counter_i64_metadata(&p.metadata, "seen");
                    let hit = counter_i64_metadata(&p.metadata, "hit");
                    lines.push(format!(
                        "- ({}, seen={}, hit={}) {}",
                        p.tier, seen, hit, p.summary
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

/// Append a raw suffix to a path's filename (e.g. `x.db` + `-wal` → `x.db-wal`),
/// matching how SQLite names its WAL/SHM sidecar files.
fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
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

fn format_memories_block(results: &[SearchResult]) -> String {
    let mut lines = vec!["[Relevant memories from past conversations]".to_string()];
    for r in results {
        let ts = &r.entry.timestamp[..10.min(r.entry.timestamp.len())];
        lines.push(format!("- ({}, {}) {}", ts, r.entry.category, r.entry.text));
    }
    lines.join("\n")
}

// ─── Continuity projection helpers (Slice 3) ────────────────────────────────

/// Read a `counters.<key>` i64 from a memory's metadata, defaulting to 0.
fn counter_i64_metadata(metadata: &serde_json::Value, key: &str) -> i64 {
    metadata
        .get("counters")
        .and_then(|c| c.get(key))
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default()
}

/// Maturity ranking for pattern surfacing: tier first (pattern > consolidated
/// > raw), then sighting count. Higher = surfaced earlier.
fn pattern_priority(entry: &MemoryEntry) -> (i64, i64) {
    let tier_rank = match entry.tier.as_str() {
        "pattern" => 3,
        "consolidated" => 2,
        _ => 1,
    };
    (tier_rank, counter_i64_metadata(&entry.metadata, "seen"))
}

/// Whether learned patterns may be appended to injected prompt context.
/// Off by default; enable with `ROMANBATH_PATTERN_INJECTION=1|true|on|yes`.
fn pattern_injection_enabled() -> bool {
    let value = std::env::var("ROMANBATH_PATTERN_INJECTION").unwrap_or_default();
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "on" | "yes"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (tempfile::TempDir, ChatMemoryStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ChatMemoryStore::new(dir.path());
        (dir, store)
    }

    fn store_test_embedding(store: &ChatMemoryStore, character: &str, id: &str, embedding: &[f32]) {
        let conn = crate::schema::open(&store.db_path_for(character)).unwrap();
        memory_crud::store_embedding(&conn, id, "test-model", embedding).unwrap();
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
        assert!(
            result.is_ok(),
            "save_chat_memory failed: {:?}",
            result.err()
        );

        // Now test via recall_memories (query must be >= 10 chars for non-CJK, and FTS AND semantics)
        let memories = store
            .recall_memories("test_char", "prefer dark mode everything", 5)
            .unwrap();
        assert!(!memories.is_empty(), "Should recall saved memory");
    }

    #[test]
    fn vector_channel_surfaces_semantic_matches_without_keywords() {
        let (_dir, store) = temp_store();
        let character = "vec_semantic";
        let a_id = store
            .save_chat_memory(character, "Alice", "user", "工作压力很大想辞职")
            .unwrap()
            .expect("memory A should be stored");
        let b_id = store
            .save_chat_memory(character, "Alice", "user", "今天天气不错")
            .unwrap()
            .expect("memory B should be stored");
        store_test_embedding(&store, character, &a_id, &[1.0, 0.0, 0.0, 0.0]);
        store_test_embedding(&store, character, &b_id, &[0.0, 1.0, 0.0, 0.0]);

        let query = "被老板批评了";
        let control = store.recall_memories(character, query, 5).unwrap();
        assert!(
            control.is_empty(),
            "legacy recall should remain FTS-gated for zero-overlap query"
        );

        let qv = [1.0, 0.0, 0.0, 0.0];
        let results = store
            .recall_memories_with_vector(character, query, Some(&qv), 5)
            .unwrap();

        assert!(!results.is_empty(), "vector path should return memory A");
        assert_eq!(results[0].entry.id, a_id);
        assert!(
            !results.iter().any(|r| r.entry.id == b_id),
            "orthogonal memory B should not be surfaced"
        );
    }

    #[test]
    fn dual_channel_hit_outranks_fts_only() {
        let (_dir, store) = temp_store();
        let character = "dual_channel";
        let a_id = store
            .save_chat_memory(
                character,
                "Alice",
                "user",
                "shared zephyrcucumber token belongs to alpha memory",
            )
            .unwrap()
            .expect("memory A should be stored");
        let b_id = store
            .save_chat_memory(
                character,
                "Alice",
                "user",
                "shared zephyrcucumber token belongs to beta memory",
            )
            .unwrap()
            .expect("memory B should be stored");
        store_test_embedding(&store, character, &a_id, &[1.0, 0.0, 0.0, 0.0]);
        store_test_embedding(&store, character, &b_id, &[0.0, 1.0, 0.0, 0.0]);

        let qv = [1.0, 0.0, 0.0, 0.0];
        let results = store
            .recall_memories_with_vector(character, "shared zephyrcucumber token", Some(&qv), 5)
            .unwrap();

        let a_score = results
            .iter()
            .find(|r| r.entry.id == a_id)
            .expect("A should be recalled")
            .score
            .final_score;
        let b_score = results
            .iter()
            .find(|r| r.entry.id == b_id)
            .expect("B should be recalled")
            .score
            .final_score;

        assert!(
            a_score > b_score,
            "dual-channel A should outrank FTS-only B: A={a_score} B={b_score}"
        );
    }

    #[test]
    fn none_vector_path_byte_identical() {
        let (_dir, store) = temp_store();
        let character = "legacy_none_vector";
        let id = store
            .save_chat_memory(character, "Alice", "user", "工作压力很大想辞职")
            .unwrap()
            .expect("memory should be stored");
        store_test_embedding(&store, character, &id, &[1.0, 0.0, 0.0, 0.0]);

        let results = store.recall_memories(character, "被老板批评了", 5).unwrap();

        assert!(
            results.is_empty(),
            "legacy recall must not read embedding_cache when query_vec is None"
        );
    }

    #[test]
    fn list_memories_is_scoped_to_character() {
        let (_dir, store) = temp_store();
        store
            .save_chat_memory(
                "ada",
                "Alice",
                "user",
                "I prefer using dark mode for everything",
            )
            .unwrap()
            .expect("not noise");
        store
            .save_chat_memory(
                "ada",
                "Alice",
                "assistant",
                "Noted — I'll keep things in dark mode",
            )
            .unwrap()
            .expect("not noise");
        store
            .save_chat_memory(
                "bob",
                "Alice",
                "user",
                "I take my coffee black, no sugar at all",
            )
            .unwrap()
            .expect("not noise");

        // ada sees only ada's memories (both roles, no FTS query needed).
        let ada = store.list_memories("ada", 200).unwrap();
        assert_eq!(ada.len(), 2, "ada should see exactly its own two memories");
        assert!(ada.iter().all(|m| m.path.starts_with("/chat/ada/memories")));

        // A character that has never spoken has an empty (freshly-created) store.
        let ghost = store.list_memories("ghost", 200).unwrap();
        assert!(ghost.is_empty());
    }

    #[test]
    fn rename_character_moves_memories() {
        let (_dir, store) = temp_store();
        store
            .save_chat_memory(
                "ada",
                "Alice",
                "user",
                "I prefer using dark mode for everything",
            )
            .unwrap()
            .expect("not noise");

        store.rename_character("ada", "ada_renamed").unwrap();

        // Memory followed the rename; the old name is now empty.
        assert_eq!(store.list_memories("ada_renamed", 200).unwrap().len(), 1);
        assert!(store.list_memories("ada", 200).unwrap().is_empty());

        // Renaming a character with no memory DB yet is a harmless no-op.
        store
            .rename_character("never_existed", "still_nothing")
            .unwrap();
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

        let injected =
            store.inject_memories_into_prompt("test_char4", "User: TypeScript new projects");
        assert!(!injected.is_empty());
        assert!(injected.contains("TypeScript"));
    }

    #[test]
    fn save_scrubs_think_tags() {
        let (_dir, store) = temp_store();
        let result = store.save_chat_memory(
            "test_char_think",
            "Alice",
            "user",
            "<think>Analyzing the user preference...</think>I like using Rust for coding",
        );
        let _id = result.unwrap().expect("Should not be filtered as noise");
        let memories = store
            .recall_memories("test_char_think", "like using Rust coding", 5)
            .unwrap();
        assert!(!memories.is_empty());
        let entry = &memories[0].entry;
        assert_eq!(entry.text, "I like using Rust for coding");
        assert!(!entry.text.contains("<think>"));
    }

    #[test]
    fn delete_memory_removes_from_list() {
        let (_dir, store) = temp_store();
        let id = store
            .save_chat_memory(
                "del",
                "Alice",
                "user",
                "I prefer dark mode for everything always",
            )
            .unwrap()
            .expect("not noise");
        assert_eq!(store.list_memories("del", 200).unwrap().len(), 1);

        let deleted = store.delete_memory("del", &id).unwrap();
        assert!(deleted, "delete_memory returns true when a row is removed");
        assert!(
            store.list_memories("del", 200).unwrap().is_empty(),
            "deleted memory must not appear in list_memories"
        );

        // Deleting a non-existent id is a harmless false.
        assert!(!store.delete_memory("del", "nope").unwrap());
    }

    #[test]
    fn update_memory_edits_text_category_and_pins() {
        let (_dir, store) = temp_store();
        let id = store
            .save_chat_memory(
                "upd",
                "Alice",
                "user",
                "I prefer dark mode for everything always",
            )
            .unwrap()
            .expect("not noise");

        let updated = store
            .update_memory(
                "upd",
                &id,
                Some("I actually love light mode in the mornings now".to_string()),
                Some("fact".to_string()),
                Some(true),
            )
            .unwrap()
            .expect("entry exists");

        assert_eq!(
            updated.text,
            "I actually love light mode in the mornings now"
        );
        assert_eq!(
            updated.summary,
            "I actually love light mode in the mornings now"
        );
        assert_eq!(updated.category, "fact");
        assert_eq!(updated.retention_policy.as_deref(), Some("pinned"));

        // The change is durable in the store and visible to the read path.
        let listed = store.list_memories("upd", 200).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(
            listed[0].text,
            "I actually love light mode in the mornings now"
        );
        assert_eq!(listed[0].retention_policy.as_deref(), Some("pinned"));

        // Unpin flips retention_policy to durable; None fields stay untouched.
        let unpinned = store
            .update_memory("upd", &id, None, None, Some(false))
            .unwrap()
            .expect("entry exists");
        assert_eq!(unpinned.retention_policy.as_deref(), Some("durable"));
        assert_eq!(unpinned.category, "fact", "category untouched when None");

        // Updating a missing id yields None, not an error.
        assert!(
            store
                .update_memory("upd", "nope", None, None, Some(true))
                .unwrap()
                .is_none()
        );
    }

    /// Seed a pattern memory under /user/patterns/ directly for testing.
    fn seed_pattern(store: &ChatMemoryStore, character: &str, id: &str, tier: &str, seen: i64) {
        let mut conn = crate::schema::open(&store.db_path_for(character)).unwrap();
        memory_crud::upsert(
            &mut conn,
            &MemoryEntry {
                id: id.to_string(),
                path: format!("/user/patterns/general/{id}"),
                summary: format!("pattern summary {id}"),
                text: format!("pattern text {id}"),
                importance: 0.72,
                timestamp: memory_crud::now_utc_iso(),
                category: "preference".to_string(),
                keywords: vec![],
                entities: vec![],
                source: "external:tachi_event_projection".to_string(),
                scope: "user".to_string(),
                archived: false,
                access_count: 0,
                last_access: None,
                retention_policy: None,
                metadata: serde_json::json!({
                    "projection_kind": "pattern",
                    "counters": {"seen": seen, "hit": 1},
                }),
                recall_count: 0,
                query_diversity: 0,
                tier: tier.to_string(),
            },
        )
        .unwrap();
    }

    /// 3a — recall is path-scoped to /chat/, so a projection whose text WOULD
    /// match the query must still be excluded. Regression-locks the isolation.
    #[test]
    fn recall_excludes_projection_paths() {
        let (_dir, store) = temp_store();
        store
            .save_chat_memory(
                "iso",
                "Alice",
                "user",
                "I prefer dark mode for everything always",
            )
            .unwrap();
        // A projection whose text matches the recall query — must be excluded
        // by the /chat/ path_prefix filter, not by FTS non-match.
        let mut conn = crate::schema::open(&store.db_path_for("iso")).unwrap();
        memory_crud::upsert(
            &mut conn,
            &MemoryEntry {
                id: "pat-leak".to_string(),
                path: "/user/patterns/general/pat-leak".to_string(),
                summary: "prefer dark mode everything".to_string(),
                text: "prefer dark mode everything".to_string(),
                importance: 0.9,
                timestamp: memory_crud::now_utc_iso(),
                category: "preference".to_string(),
                keywords: vec![],
                entities: vec![],
                source: "external:tachi_event_projection".to_string(),
                scope: "user".to_string(),
                archived: false,
                access_count: 0,
                last_access: None,
                retention_policy: None,
                metadata: serde_json::json!({"projection_kind": "pattern"}),
                recall_count: 0,
                query_diversity: 0,
                tier: "pattern".to_string(),
            },
        )
        .unwrap();

        let recalled = store
            .recall_memories("iso", "prefer dark mode everything", 5)
            .unwrap();
        assert!(
            !recalled.iter().any(|r| r.entry.id == "pat-leak"),
            "projection under /user/patterns/ must not leak into /chat/-scoped recall"
        );
        assert!(
            recalled.iter().all(|r| r.entry.path.starts_with("/chat/")),
            "recall must stay within the /chat/ path_prefix"
        );
    }

    /// 3b — pattern_context reads /user/patterns/ rows, most-mature first.
    #[test]
    fn pattern_context_returns_projections_mature_first() {
        let (_dir, store) = temp_store();
        seed_pattern(&store, "pc", "p-mature", "pattern", 5);
        seed_pattern(&store, "pc", "p-raw", "raw", 1);

        let patterns = store.pattern_context("pc", 10).unwrap();
        assert_eq!(patterns.len(), 2);
        assert_eq!(
            patterns[0].id, "p-mature",
            "mature (pattern-tier) projection surfaces first"
        );
        assert!(patterns[0].path.starts_with("/user/patterns/"));
    }

    /// 3c — default-off injection must be byte-identical: patterns in the DB
    /// do NOT appear when the flag is false (CLAUDE.md: keep the off/default
    /// path byte-identical).
    #[test]
    fn injection_off_excludes_patterns() {
        let (_dir, store) = temp_store();
        store
            .save_chat_memory(
                "inj",
                "Alice",
                "user",
                "I prefer dark mode everywhere always",
            )
            .unwrap();
        seed_pattern(&store, "inj", "pat-secret", "pattern", 9);

        let out =
            store.inject_memories_into_prompt_with("inj", "User: dark mode everywhere", false);
        assert!(out.contains("dark mode"), "chat memory still injected");
        assert!(
            !out.contains("pat-secret"),
            "patterns must NOT appear when injection is off"
        );
        assert!(
            !out.contains("Learned patterns"),
            "pattern block header must not appear when off"
        );
    }

    /// 3c — when the flag is on, the learned-pattern block is appended.
    #[test]
    fn injection_on_appends_pattern_block() {
        let (_dir, store) = temp_store();
        store
            .save_chat_memory(
                "inj2",
                "Alice",
                "user",
                "I prefer dark mode everywhere always",
            )
            .unwrap();
        seed_pattern(&store, "inj2", "pat-on", "pattern", 9);

        let out =
            store.inject_memories_into_prompt_with("inj2", "User: dark mode everywhere", true);
        assert!(
            out.contains("Relevant memories"),
            "chat block still present"
        );
        assert!(
            out.contains("Learned patterns"),
            "pattern block appended when on"
        );
        assert!(out.contains("pat-on"), "pattern content present when on");
    }
}
