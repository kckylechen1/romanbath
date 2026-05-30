# Execution Plan — LLM Enrichment Module for zeroclaw-memory-sigil

## Summary

Add an `enrichment.rs` module that wraps LLM calls (via `zeroclaw-api`'s `ModelProvider` trait) to power the three-stage dreaming pipeline with AI-driven extraction, verification, and pattern discovery. Integrate as an optional field on `DreamingPipeline` for backward compatibility.

## Files to Change

| File | Action |
|------|--------|
| `crates/zeroclaw-memory-sigil/Cargo.toml` | Add `zeroclaw-api.workspace = true`; upgrade tokio features |
| `crates/zeroclaw-memory-sigil/src/enrichment.rs` | **New** — `MemoryEnricher` struct with `extract_facts`, `verify_consolidation`, `discover_patterns` |
| `crates/zeroclaw-memory-sigil/src/dreaming.rs` | Add `Option<Arc<MemoryEnricher>>` field; wire enrichment into all 3 sleep stages |
| `crates/zeroclaw-memory-sigil/src/lib.rs` | Add `pub mod enrichment;` and re-export `MemoryEnricher` |

## Step-by-Step

### Step 1: Update `Cargo.toml`
- Add `zeroclaw-api.workspace = true` dependency
- Update tokio to include needed features (already has `rt`, `macros`, `time`)

### Step 2: Create `enrichment.rs`
- Source of truth for `MemoryEnricher` — **this is the source of truth**, created here.
- Struct holds two `Arc<dyn ModelProvider>` + model name pairs (extract vs distill).
- `extract_facts`: builds system+user prompt, calls `chat_with_system`, parses JSON response → `(summary, keywords, entities, importance)`
- `verify_consolidation`: builds prompt, calls LLM, parses "yes"/"no"
- `discover_patterns`: builds prompt with memories joined, calls LLM, parses JSON array of strings
- Helper fns: `parse_extract_response`, `parse_verify_response`, `parse_patterns_response` — all testable without LLM

### Step 3: Modify `dreaming.rs`
- Add `enricher: Option<Arc<MemoryEnricher>>` field to `DreamingPipeline`
- Update `new()` and add `with_enricher()` builder method
- `run_light_sleep`: after dedup, if enricher present, call `extract_facts` on surviving raw entries → update summary/keywords/entities/importance via `memory_crud::upsert`
- `run_deep_sleep`: before promoting, if enricher present, call `verify_consolidation` as additional gate
- `run_rem_sleep`: if enricher present, call `discover_patterns` on consolidated memories instead of/in addition to keyword grouping
- All enrichment guarded by `if let Some(enricher) = &self.enricher`; `None` preserves current behavior exactly

### Step 4: Update `lib.rs`
- `pub mod enrichment;`
- `pub use enrichment::MemoryEnricher;`

### Step 5: Compile & Test
- `cargo check -p zeroclaw-memory-sigil`
- `cargo test -p zeroclaw-memory-sigil`
- Add unit tests for JSON parsing in enrichment module

## Risks / Constraints
- `zeroclaw-api` edition is 2024 — must match workspace edition
- `ModelProvider` requires `Attributable` — our usage is via trait object so concrete impls already satisfy
- Enrichment failures must be non-fatal: log and continue with existing Rust-only behavior
- No `unwrap()` in production paths per AGENTS.md anti-patterns
