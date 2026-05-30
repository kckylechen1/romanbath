# Completion Report: zeroclaw-memory-sigil crate creation

## Summary

Created `crates/zeroclaw-memory-sigil` — a chat-focused memory system for RomanBath, ported and simplified from Sigil's `memory-core`. Integrated into `zeroclaw-gateway` for automatic memory injection during character-driven chat.

All compilation and tests pass:
- `cargo check -p zeroclaw-memory-sigil` ✅
- `cargo check -p zeroclaw-gateway` ✅
- `cargo test -p zeroclaw-memory-sigil` — 20/20 tests pass ✅

## Files Changed

### New files (crate)
- `crates/zeroclaw-memory-sigil/Cargo.toml` — crate manifest with rusqlite 0.37 bundled, serde, uuid v4, thiserror 2, chrono, regex, tokio
- `crates/zeroclaw-memory-sigil/src/lib.rs` — pub mod declarations + re-exports
- `crates/zeroclaw-memory-sigil/src/types.rs` — simplified MemoryEntry, RetentionPolicy, MemoryCategory, MemorySource, MemoryScope, HybridScore, SearchResult, MemoryEdge, DreamingReport
- `crates/zeroclaw-memory-sigil/src/schema.rs` — SQLite schema (memories, memories_fts, memory_edges, access_history, embedding_cache) with CHECK constraints
- `crates/zeroclaw-memory-sigil/src/memory_crud.rs` — upsert, get_by_id, list_by_path, delete, search_fts, fetch_by_ids, record_access, get_all + MemoryError type
- `crates/zeroclaw-memory-sigil/src/noise.rs` — is_noise_text (with role-based filtering), should_skip_query, scrub_think_tags, is_cjk
- `crates/zeroclaw-memory-sigil/src/scorer.rs` — ACT-R decay_score, tier_half_life, cosine_similarity, symbolic_score, tokenize, hybrid_score
- `crates/zeroclaw-memory-sigil/src/dreaming.rs` — DreamingPipeline with light_sleep (dedup/merge), deep_sleep (raw→consolidated promotion), rem_sleep (pattern discovery)
- `crates/zeroclaw-memory-sigil/src/chat_memory.rs` — ChatMemoryStore with save_chat_memory, recall_memories, inject_memories_into_prompt

### Modified files
- `Cargo.toml` (workspace) — added `crates/zeroclaw-memory-sigil` to workspace members + workspace.dependencies
- `crates/zeroclaw-gateway/Cargo.toml` — added `zeroclaw-memory-sigil.workspace = true`
- `crates/zeroclaw-gateway/src/api_chat.rs` — integrated ChatMemoryStore: saves user messages, injects recalled memories into system prompt

## Commands Run

```bash
cargo check -p zeroclaw-memory-sigil     # compile check
cargo check -p zeroclaw-gateway           # gateway integration check
cargo test -p zeroclaw-memory-sigil       # 20 tests pass
```

## Key Design Decisions

1. **Tokenizer**: Used `unicode61` (built-in FTS5) instead of `simple` (requires `libsimple` C library). This avoids a native C dependency but loses CJK-specific segmentation. Can be upgraded later if needed.

2. **Per-character DB files**: Each character gets its own SQLite DB (`{character_name}_memory.db`), providing natural isolation and allowing independent backup/deletion.

3. **Path namespace**: All memories stored under `/chat/{character_name}/memories/{role}`, enabling path-prefix filtering during FTS search.

4. **No vector search**: Omitted sqlite-vec dependency for simplicity. The `embedding_cache` table is provisioned for future vector support. Hybrid scoring uses FTS + symbolic + decay channels only.

5. **Memory source of truth**: `data_dir/chat_memory/` — resolved on-demand from `state.config.read().data_dir`, never cached in a struct field (per AGENTS.md absolute rule).

## Remaining Risks or Blockers

1. **FTS5 AND semantics**: FTS5 MATCH uses AND logic by default. Multi-word queries that don't share all terms with stored text may miss results. A future enhancement could use OR queries or tokenizer-based query expansion.

2. **No libsimple/CJK tokenization**: The `unicode61` tokenizer handles basic tokenization but doesn't provide Chinese word segmentation. For heavy Chinese-language use, `libsimple` should be added as a dependency.

3. **Dreaming pipeline is async but untested end-to-end**: The three sleep stages compile and the logic is tested through unit tests, but there's no scheduler integration yet. A cron-like trigger should be added to the gateway or runtime.

4. **Category inference is heuristic-based**: `infer_category()` uses simple keyword matching. For production, an LLM-based classification step would improve accuracy.

5. **Gateway integration is best-effort**: Memory save failures are silently ignored (the chat proceeds regardless). This is intentional for resilience but means memory writes could be lost silently.
