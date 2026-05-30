# Execution Plan: zeroclaw-memory-sigil crate

## Overview
Create `crates/zeroclaw-memory-sigil` — a chat-focused memory system for RomanBath, porting core code from Sigil's `memory-core` and adding chat-specific features (dreaming pipeline, chat memory store).

## Steps

### 1. Create crate structure
- `crates/zeroclaw-memory-sigil/Cargo.toml`
- `crates/zeroclaw-memory-sigil/src/lib.rs`
- Register in workspace `Cargo.toml` (members + workspace.dependencies)

### 2. Create `src/types.rs` (simplified)
- Port `MemoryEntry` minus persons, location, valid_from/until, superseded_by, revision, topic, domain
- Port `RetentionPolicy`, `MemoryCategory` (remove kanban/handoff/ghost/wiki/guide), `MemorySource` (remove foundry/handoff/kanban/wiki/ghost), `HybridScore`, `SearchResult`, `MemoryEdge`
- Keep: id, path, summary, text, importance, timestamp, category, keywords, entities, source, scope, archived, access_count, last_access, recall_count, query_diversity, tier, metadata

### 3. Create `src/schema.rs`
- Simplified SQLite schema: memories, memories_fts, memory_edges, embedding_cache (optional)
- Remove persons, location, valid_from/until, superseded_by columns
- Remove hub/sandbox/pack/vault/foundry/audit tables

### 4. Create `src/memory_crud.rs`
- Port upsert, get_by_id, list_by_path, delete, search_fts
- Remove foundry/agent_state/audit/enrichment functions
- Remove vector search (no sqlite-vec dependency for now)

### 5. Create `src/noise.rs`
- Port is_noise_text, should_skip_query, scrub_think_tags
- Add chat-specific filters: pure emoji, single char replies, system role messages

### 6. Create `src/scorer.rs`
- Port decay_score, tier_half_life, cosine_similarity, symbolic_score, tokenize
- Remove stock-code specific logic (precision_query_multiplier, extract_stock_codes)
- Keep hybrid scoring infrastructure

### 7. Create `src/dreaming.rs`
- DreamingPipeline with three sleep stages: light, deep, REM
- Light sleep: dedup/merge short-term memories
- Deep sleep: promote raw→consolidated (recall>=3, diversity>=3, importance>=0.8)
- REM sleep: cross-domain pattern discovery

### 8. Create `src/chat_memory.rs`
- ChatMemoryStore: wraps SQLite, partitioned by character_name
- save_chat_memory: saves chat message as memory entry
- recall_memories: FTS search for relevant memories
- inject_memories_into_prompt: returns formatted memory text for prompt injection

### 9. Update `crates/zeroclaw-gateway/src/api_chat.rs`
- After loading character card, call ChatMemoryStore::inject_memories_into_prompt
- Append memory context to system prompt fragments

### 10. Compile verification
- `cargo check -p zeroclaw-memory-sigil`
- `cargo check -p zeroclaw-gateway`

## Key Simplifications vs Sigil
- No persons, location, valid_from/until, superseded_by, topic, domain
- No foundry/agent_state/audit/hub/sandbox/pack/vault
- No vault encryption
- Paths use character_name as namespace: `/chat/{character_name}/memories/...`
- All dreaming per character_name
- No sqlite-vec (embedding_cache table only)
