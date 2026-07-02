# Plan: Web-as-Channel + WS-Primary Chat

> Status: **PHASE 1 COMPLETE** (v3 — post-implementation)
> Owner: Kyle · Date: 2026-07-01
> Parent context: backend separation is incomplete; chat history lives in browser localStorage because `/api/chat` only extracts semantic memory, never persists raw messages. ZeroClaw already has a complete branched-conversation SessionBackend AND already does RP character-card injection on the WS path; the missing piece was REST inspection endpoints + migration + a defensive mid-session guard.

## Changelog

### v3 (post-implementation)
- **Phase 1 implementation complete** — see "Phase 1 outcome" below for actual deltas vs the plan.
- **Plan agent was wrong about Task 2**: ws.rs already had `inject_character_card` (line 1488) doing set-once `add_custom_system_section("character_card", ...)` at connect time. Real Task 2 work was just the defensive mid-session rejection guard, not the full injection pipeline.
- **Plan agent was wrong about default backend**: default IS SQLite (config default `"sqlite"`), not JSONL. Migration idempotency via node IDs works naturally.

### v2
- **Gap-2 recharacterized**: WS connect frame already accepts RP fields (character_name, mode, user_name, user_description) at `ws.rs:80-117`. Real work is per-turn override semantics, not adding fields from scratch.
- **Gap-3 mostly done**: WS already has `select_leaf`/`edit`/`delete` frames (`ws.rs:907-1010`) and persists turns as ConversationNodes (`ws.rs:1266-1393`).
- **Gap-4 downgraded**: WS already emits `history_snapshot` frame (`ws.rs:470-503`).
- **Task 2 redesigned**: drop `replace_custom_system_section` per-turn approach (LangGraph prompt cache warning). Use set-once — which turned out to already exist.
- **Prior art added**: SillyTavern PR #4573 (chatTree), Open WebUI migration 8452d01d26d7, LobeChat 4-level hierarchy, LangGraph prompt cache guidance.

## Phase 1 outcome (what actually shipped)

| Task | Plan | Reality | Status |
|---|---|---|---|
| Task 1: Extract `build_messages` | 2-3h Medium | Matched estimate. Mechanical refactor + 15 new tests. | ✅ |
| Task 2: WS RP context set-once | 2-3h Medium | **Already done by existing `inject_character_card` (ws.rs:1488).** Real work: added `detect_character_conflict` defensive guard (ws.rs:1255) + extracted `build_character_prompt_components` (ws.rs:1488) for testability. | ✅ |
| Task 3: GET `/api/sessions/{key}/tree` | 2-3h Low | Matched. New `api_sessions.rs` module + route. | ✅ |
| Task 4: POST `/api/sessions/migrate` | 3-4h Medium | Matched. Idempotent by node ID, parent validation, role validation. | ✅ |
| Task 5: WS regression tests | 2-3h Medium | 6 new tests: 5 for `detect_character_conflict`, 1 for `build_character_prompt_components` error path. Full agent+card fixture test deferred (needs richer test infra). | ✅ (partial) |
| Task 6: Final QA | 2-3h Low | 262 gateway tests passing (was 256; +6 new). Workspace compiles clean. | ✅ |

**Total Phase 1 effort**: ~4 hours actual (vs 11-19h estimated). The 70-80% savings came from existing infrastructure that Plan agent didn't see.

## Files changed

| File | Change |
|---|---|
| `crates/zeroclaw-gateway/src/chat_prompt.rs` | NEW — shared prompt module (ChatRequest, RequestLorebookEntry, build_messages, helpers, 15 tests) |
| `crates/zeroclaw-gateway/src/api_chat.rs` | Refactored — kept HTTP/SSE handlers + ChatResponse, re-exports from chat_prompt |
| `crates/zeroclaw-gateway/src/api_sessions.rs` | NEW — handle_session_tree + handle_sessions_migrate + DTOs |
| `crates/zeroclaw-gateway/src/api.rs` | `require_auth` visibility `pub(super)` → `pub(crate)` |
| `crates/zeroclaw-gateway/src/lib.rs` | Added `pub mod chat_prompt;` `pub mod api_sessions;` + 2 routes |
| `crates/zeroclaw-gateway/src/ws.rs` | Added `detect_character_conflict` guard, extracted `build_character_prompt_components`, wired guard into message handler, + 6 tests |

## API surface added

```rust
// chat_prompt.rs
pub struct ChatRequest { ... }  // moved, byte-compatible
pub struct RequestLorebookEntry { ... }  // moved
pub async fn build_messages(state: &AppState, req: ChatRequest) -> anyhow::Result<Vec<ChatMessage>>;

// api_sessions.rs
pub struct SessionTreeResponse { session_key, nodes, active_leaf, session_persistence }
pub struct SessionTreeNode { id, parent_id, role, content, author_id, status, meta, timestamp }
pub struct SessionMigrateRequest { session_key, nodes, active_leaf, name }
pub struct SessionMigrateNode { id, parent_id, role, content, timestamp, author_id, status, meta }
pub struct SessionMigrateResponse { session_key, inserted, skipped, active_leaf, session_persistence }
pub async fn handle_session_tree(...) -> impl IntoResponse;
pub async fn handle_sessions_migrate(...) -> impl IntoResponse;

// ws.rs
fn detect_character_conflict(parsed, session_character) -> Option<(String, String)>;
fn build_character_prompt_components(...) -> anyhow::Result<(full_prompt, first_mes, companion)>;
```

## Routes added

- `GET /api/sessions/{key}/tree` → `api_sessions::handle_session_tree`
- `POST /api/sessions/migrate` → `api_sessions::handle_sessions_migrate`

## What's NOT done (Phase 2+ scope)

These remain unchanged from v2 plan:

- **Phase 2** (1-2 days): Frontend WS-primary refactor. RomanBath frontend switches from REST `/api/chat` to WS for all character RP. Demote `chatPersistenceService` to write-through cache.
- **Phase 3** (0.5 day): One-shot migration script `frontend/scripts/migrate-local-to-server.mjs`. Reads localStorage, POSTs to `/api/sessions/migrate`, verifies via tree GET.
- **Phase 4** (1 day, optional): Branch ops over WS for RP — wire `branchMetaStore` to emit `select_leaf`/`edit`/`delete` frames.
- **Phase 5** (0.5 day): Mark `/api/chat` REST as `#[deprecated]`, README notice, remove dead frontend REST chat code.

## Decisions (locked, unchanged)

| # | Decision | Choice |
|---|---|---|
| D1 | session_key strategy | `web:{character_name}` |
| D2 | Existing localStorage data | One-time migration |
| D3 | `/api/chat` REST fate | Keep for internal tests, demoted from production |
| D4 | "All WS" scope | Chat only |

## Prior art (unchanged from v2)

- **SillyTavern PR #4573** — same use case, same linear→tree migration, validated approach
- **Open WebUI migration 8452d01d26d7** — canonical reference for Phase 3 migration script
- **LobeChat** — 4-level hierarchy is overkill for us; optimistic UI pattern worth borrowing
- **LangGraph** — prompt cache warning drove the set-once design (which turned out to already exist)

## Risks remaining (for Phase 2)

1. **Frontend WsChatConnection** sends character_name on connect (verified at `services/zeroclawService.ts:1476-1491`). Phase 2 must verify this triggers server-side `inject_character_card` correctly end-to-end with a real character card.
2. **`add_custom_system_section` idempotency**: if reconnect happens mid-session, will it duplicate the section? Needs verification during Phase 2 integration testing.
3. **WS reconnection partial-reply recovery**: when WS drops mid-stream, does `session_start` + `history_snapshot` correctly resume? Phase 2 testing.
4. **Conversation tree size**: heavily-branched RP could accumulate hundreds of nodes. SQLite `load_tree` is index-accelerated; consider `SessionBackend::compact` for very long sessions.

## Verification (Phase 1 final state)

```bash
cd /Volumes/Storage/RomanBath/zeroclaw
cargo check --workspace                           # ✅ clean
cargo test -p zeroclaw-gateway --lib              # ✅ 262/262
cargo test -p zeroclaw-gateway --lib chat_prompt  # ✅ 15/15
cargo test -p zeroclaw-gateway --lib ws::tests    # ✅ 40/40
```


## Decisions (locked)

| # | Decision | Choice | Implication |
|---|---|---|---|
| D1 | session_key strategy | `web:{character_name}` | One session per character. Branches live **inside** the session as `ConversationNode` tree (already supported by SessionBackend). Client `branchMetaStore` maps to server-side nodes — no branch info lost. |
| D2 | Existing localStorage data | One-time migration | `npm run migrate:local-to-server` reads `romanbath_chat_history_v1`, POSTs each conversation to `/api/sessions/migrate` which writes via SessionBackend. After migration, localStorage becomes read-only cache. Pattern reference: Open WebUI migration `8452d01d26d7`. |
| D3 | `/api/chat` REST fate | Keep for internal tests, demoted from production | Documented as "internal-only". WS becomes the only production chat path. |
| D4 | "All WS" scope | Chat only | Character CRUD, settings, image gen, TTS stay REST. Only chat (send/stream/regenerate/branch/edit/delete) moves to WS. |

## Prior art (don't reinvent)

### SillyTavern — same use case, in active migration to tree-based branching
- **Server-side JSONL persistence** per character/conversation (`/api/chats/*` endpoints)
- **Atomic writes** via `write-file-atomic`, crash-safe
- **Integrity slug system**: client sends hash of last loaded state; server compares to first line of file; rejects writes on mismatch → prevents concurrent-edit data loss. **We should add this as a future enhancement, not Phase 1.**
- **PR #4573 "chatTree"**: actively migrating from linear `swipes` array to hierarchical `chatTree` data structure. Backend changes persist chatTree alongside main chat. **This is the same migration RomanBath is doing client-side**; SillyTavern is doing it server-side. Validated approach.
- Source: https://deepwiki.com/SillyTavern/SillyTavern/5.2-chat-storage-and-persistence

### Open WebUI — message tree + migration reference
- **`chat.history.messages{}`** dict keyed by message ID, with `parentId` and `childrenIds` per node. Frontend walks tree from root.
- **`currentId`** points to active leaf (must be camelCase, frontend fails silently on snake_case).
- **Migration `8452d01d26d7_add_chat_message_table.py`**: moved FROM JSON blob in `chat` column TO dedicated `chat_message` table with columns `(id, chat_id, user_id, role, parent_id, content, done, status_history, error, usage, created_at, updated_at)` + composite index `(chat_id, parent_id)`. **Streaming batch backfill**: `yield_per=1000, stream_results=True`, batch insert (BATCH_SIZE=50000). This is the canonical reference for our `/api/sessions/migrate` endpoint.
- **Partial update semantics**: `POST /api/v1/chats/{id}` accepts partial history.messages; unspecified messages preserved. Useful for our edit/branch ops.
- Source: https://docs.openwebui.com/reference/api-flow/, https://deepwiki.com/open-webui/open-webui/4.3-message-history-tree

### LobeChat — 4-level hierarchy (overkill for us, but dual-persistence pattern is interesting)
- Hierarchy: Sessions → Topics → Messages → Threads. We only need Sessions → Messages (tree).
- **Dual persistence**: PostgreSQL (server) + PGlite (WASM PG in Electron desktop) sharing same Drizzle schema. RomanBath could do SQLite-cache locally + ZeroClaw server-side, but Phase 1 scope is server-only.
- **Optimistic UI pattern**: client `messagesMap` updated immediately, server sync via tRPC router. Validated approach matches our planned `chatPersistenceService` → cache layer.
- Source: https://deepwiki.com/lobehub/lobe-chat/4-chat-and-messaging-system

### LangGraph — agent system prompt dynamic update
- **`prompt` parameter accepts `Callable[[State], str | list[BaseMessage]]`** — dynamic per-invocation.
- **Critical dev guidance** (LangChain forum): "Generally good to keep the system prompt the same over the lifetime of a conversation when possible (**to avoid messing up the LLM prompt cache**). If not possible, implement TTL/cache and only update when cache evicts."
- **Implication for our Task 2**: replacing character section every turn is the wrong pattern. Set once at session start; only refresh on explicit character switch (which we refuse mid-session in Phase 1 anyway).
- Source: https://forum.langchain.com/t/how-to-access-langgraph-state-values/1732, https://github.com/langchain-ai/deepagents/issues/1632

## Current state (what already exists — don't rebuild)

### Backend (ZeroClaw)

| Component | Status | Location | Notes |
|---|---|---|---|
| `SessionBackend` trait | ✅ Complete — linear + tree, active-leaf, search, metadata | `crates/zeroclaw-infra/src/session_backend.rs:289-397` | Don't touch the trait. |
| `SessionStore` (JSONL impl) | ✅ Legacy | `crates/zeroclaw-infra/src/session_store.rs` | Default is now SQLite. |
| SQLite session backend | ✅ Default | `crates/zeroclaw-infra/src/session_sqlite.rs:941-1129` | Overrides tree methods. Preserves client node IDs. |
| `ConversationNode` | ✅ Tree node with msg_id, parent_id, role/content, author/status/meta/timestamp | `crates/zeroclaw-infra/src/session_backend.rs:72-99` | Maps 1:1 with RomanBath's client-side node concept. |
| `/ws/chat` endpoint | ✅ Agent-style chat with SessionBackend wired (5+ calls) | `crates/zeroclaw-gateway/src/ws.rs` | Connect frame accepts character_name + mode + user_name + user_description (`ws.rs:80-117`). |
| WS protocol | ✅ session_start / chunk / done / tool_call / approval_request + select_leaf / edit / delete | `ws.rs:1-50` docstring + `ws.rs:907-1010` | Already has history_snapshot frame (`ws.rs:470-503`). |
| `/api/chat` (REST+SSE) | ✅ Has character card + lorebook + memory injection | `crates/zeroclaw-gateway/src/api_chat.rs:407` `build_messages()` | Source for prompt logic to extract. |
| `ChatMemoryStore` | ✅ Semantic memory extraction (complementary, not replaced) | `crates/zeroclaw-memory-sigil/src/chat_memory.rs` | Stays as-is. |

### Frontend (RomanBath)

| Component | Status | Location |
|---|---|---|
| `WsChatConnection` class | ✅ Already connects `/ws/chat`, handles session_start/chunk/done | `services/zeroclawService.ts:1423` |
| WS connect frame already sends character_name + mode + user_name | ✅ | `services/zeroclawService.ts:1476-1491` |
| WS-based regenerate (companion mode) | ✅ Used in `useChatGeneration` | `hooks/useChatGeneration.ts:597-610` |
| Client-side branched tree | ✅ Independent reimplementation | `hooks/useMessageTree.ts` (196 LOC), `branchMetaStore.ts` (IDB) |
| ConversationTree UI | ✅ Renders branches | `components/studio/ConversationTree.tsx` |
| localStorage chat history | ⚠️ Will become cache after migration | `services/chatPersistenceService.ts` (274 LOC) |

## Gap analysis (corrected)

### Gap-1: `build_messages` locked in `api_chat.rs`, not reusable
**Today**: REST owns prompt assembly (`api_chat.rs:407-560`). WS handler can't call it.

**Fix**: Extract `ChatRequest`, `RequestLorebookEntry`, helper fns, and `build_messages` into shared module `chat_prompt.rs`. REST keeps handler + re-exports old types for compat.

**Effort**: 2-3h mechanical refactor. **Risk**: Medium (large file, must preserve prompt order).

### Gap-2: WS lacks RP context resolution per-turn (set-once semantics)
**Today**: WS connect frame accepts `character_name` + `mode` etc., but does NOT call `build_messages` to inject character card / lorebook / memory into the agent system prompt. Agent runs without RP context.

**Fix (set-once pattern, per LangGraph guidance)**:
- On first RP-eligible `message` frame (or on `connect` frame with `character_name`), call `build_messages` to construct the character system prompt
- Call `agent.add_custom_system_section("character_card", ...)` ONCE to install it
- Stash a session-scoped flag `rp_section_installed: bool`
- On subsequent messages: do NOT re-install (preserves LLM prompt cache, avoids duplicate sections)
- If `character_name` differs on a later frame: send `{"type":"error","code":"CHARACTER_CONTEXT_CONFLICT"}` and refuse generation. Phase 2 can add explicit `switch_character` frame.

**Why not replace-per-turn**: LangChain devs explicitly warn "system prompt stable across turns when possible (to avoid messing up the LLM prompt cache)". Per-turn replacement adds latency + breaks cache. Set-once is correct.

**Effort**: 2-3h. **Risk**: Medium (need to verify `add_custom_system_section` idempotency or add a "set if not set" variant).

### Gap-3: RP-client drive-through for existing branch ops
**Today**: WS has `select_leaf`/`edit`/`delete` frames, but RomanBath frontend uses them only in Companion mode, not in main RP chat.

**Fix**: Mostly frontend work (Phase 2). Backend just verifies the frames still work for RP sessions and adds documentation. Backend effort: <1h verification.

### Gap-4: REST session read endpoints for inspection/migration verification
**Today**: No REST way to read a session tree outside of WS. WS `history_snapshot` exists but is connection-scoped.

**Fix**: Add `GET /api/sessions/{key}/tree` returning `ConversationNode` array + `active_leaf`. Not strictly required for live load (WS handles that), but needed for:
- Migration verification (Phase 3)
- Debugging / inspection
- Future REST-only clients (curl scripts)

**Effort**: 2-3h. **Risk**: Low (read-only).

### Gap-5: Migration endpoint for existing localStorage data
**Today**: No way to push client-side history into SessionBackend.

**Fix**: Add `POST /api/sessions/migrate` accepting bulk node array. Idempotent by node ID (skip existing). Pattern reference: Open WebUI migration `8452d01d26d7` (streaming batch backfill).

```json
{
  "session_key": "web:Aria",
  "nodes": [{"id":"u1","parent_id":null,"role":"user","content":"...","timestamp":"..."}, ...],
  "active_leaf": "a1"
}
```

**Effort**: 3-4h. **Risk**: Medium (idempotency + parent validation).

### Gap-6: Frontend chatService refactor
**Today**: `chatService.ts` writes localStorage as primary.

**Fix** (Phase 2, not Phase 1):
- Primary: WS send + server-side SessionBackend
- Secondary: localStorage as write-through cache (optimistic UI + offline)
- On startup: `getSessionTree(sessionKey)` → populate state; localStorage fallback if WS/REST fails

**Effort**: 1-2 days frontend work.

## Target architecture

```
┌─────────────────────────────────────────────────────────┐
│                   RomanBath (browser)                    │
│                                                          │
│   React UI (ConversationTree, CharacterList, Settings)   │
│              │                          │                │
│   ┌──────────▼─────────┐    ┌──────────▼─────────┐      │
│   │  WsChatConnection  │    │  REST (CRUD only)  │      │
│   │  (primary chat)    │    │  characters, etc.  │      │
│   │  + RP context on   │    │  + GET session tree│      │
│   │    first message   │    │    (inspection)    │      │
│   └──────────┬─────────┘    └────────────────────┘      │
│              │                                          │
│   ┌──────────▼────────────────────────────┐             │
│   │  localStorage (cache only)            │             │
│   │  - optimistic UI writes                │             │
│   │  - offline fallback                    │             │
│   └────────────────────────────────────────┘             │
└──────────────┬──────────────────────────────────────────┘
               │ WS                                  │ REST
               │ (chat, branch ops)                  │ (load tree, CRUD, migrate)
               ▼                                     ▼
┌──────────────────────────────────────────────────────────┐
│                ZeroClaw Gateway                           │
│                                                           │
│   /ws/chat (extended)              /api/sessions/* (NEW)  │
│      - set-once RP context           - GET tree           │
│      - refuse mid-session switch      - POST migrate      │
│      - existing agent loop +          - idempotent by     │
│        tool/approval flow               node ID           │
│              │                                             │
│   ┌──────────▼──────────────────────────────────────┐     │
│   │  chat_prompt.rs (NEW shared module)             │     │
│   │   - build_messages(character_name, lorebook,..) │     │
│   │   - character card injection                    │     │
│   │   - memory injection                            │     │
│   └──────────┬──────────────────────────────────────┘     │
│              │                                             │
│   ┌──────────▼──────────────────────────────────────┐     │
│   │  SessionBackend trait                            │     │
│   │   - SQLite (default) ──────────────┐             │     │
│   │   - ConversationNode tree          │ SINGLE      │     │
│   │   - active_leaf tracking           │ SOURCE      │     │
│   │                                    │ OF TRUTH    │     │
│   │  ChatMemoryStore (extracted        │             │     │
│   │   semantic memory, complementary)  │             │     │
│   └────────────────────────────────────┴─────────────┘     │
│                                                           │
│   /api/chat (REST, demoted — internal use only)          │
│      - kept for tests / curl                              │
│      - not called by RomanBath production                 │
└───────────────────────────────────────────────────────────┘
```

## Session key & branch mapping

```
Session key: web:{character_name}
  e.g., web:Aria, web:Eyrie-Commander

Inside the session: ConversationNode tree
  - root node = first user message
  - each assistant reply = child of the user message
  - regenerate = sibling assistant node under same parent
  - edit = update_node (preserves ID, updates content)
  - delete = tombstone (preserves tree structure)

Client mapping:
  branchMetaStore entries → ConversationNode IDs
  useMessageTree active path → server's active_leaf
  switch branch (client) → set_active_leaf (server) via WS frame

Future enhancement (not Phase 1):
  Integrity slug pattern (SillyTavern) — client sends hash of last loaded
  state; server rejects writes on mismatch. Prevents concurrent-edit data
  loss in multi-device scenarios.
```

## Implementation phases

Each phase is independently shippable. Stop after any phase if priorities change.

### Phase 1 — Backend foundations (5-9h total)
Wave 1 (parallel):
- [ ] **Task 1**: Extract `build_messages` → `chat_prompt.rs` (2-3h, Medium)
- [ ] **Task 3**: Add `GET /api/sessions/{key}/tree` (2-3h, Low)

Wave 2 (parallel):
- [ ] **Task 2**: WS RP context — set-once on first RP frame, refuse mid-session switch (2-3h, Medium — **downgraded from HIGH** per LangGraph cache guidance)
- [ ] **Task 4**: Add `POST /api/sessions/migrate` (3-4h, Medium)

Wave 3:
- [ ] **Task 5**: WS regression tests — old connect/message frames still work (2-3h)

Wave 4:
- [ ] **Task 6**: Final test suite verification (2-3h)

**Phase 1 success criteria**:
- `build_messages` lives in `chat_prompt.rs`, REST byte-compatible
- `/ws/chat` accepts `character_name` on connect or first message, sets agent system section once
- Old WS agent clients (Companion mode) unaffected
- `GET /api/sessions/{key}/tree` returns ConversationNode tree
- `POST /api/sessions/migrate` inserts/skips idempotently (SQLite default)
- No frontend changes
- No SessionBackend trait changes
- All `cargo test -p zeroclaw-gateway` passes

### Phase 2 — Frontend WS-primary (1-2 days, separate planning)
- [ ] Refactor `WsChatConnection` to send character_name on first RP message
- [ ] Add `getSessionTree(sessionKey)` to `zeroclawService`
- [ ] Make WS primary for ALL character RP chat (not just regenerate/companion)
- [ ] Demote `chatPersistenceService` to write-through cache
- [ ] Update `useMessageTree` to sync with server ConversationNode IDs

### Phase 3 — Migration (0.5 day)
- [ ] Write `frontend/scripts/migrate-local-to-server.mjs`
- [ ] Reads `romanbath_chat_history_v1` from localStorage
- [ ] For each character conversation, POST to `/api/sessions/migrate`
- [ ] Verify via `GET /api/sessions/{key}/tree`
- [ ] Documents migration runbook in README
- [ ] Pattern reference: Open WebUI migration `8452d01d26d7` (streaming batch)

### Phase 4 — Branch ops over WS for RP (1 day, optional)
- [ ] Wire `branchMetaStore` operations to emit WS `select_leaf` / `edit` / `delete` frames
- [ ] Verify regenerate creates sibling node server-side

### Phase 5 — Cleanup (0.5 day)
- [ ] Mark `/api/chat` as `#[deprecated]`
- [ ] Add `# Internal use only` notice in README
- [ ] Remove dead REST-chat code paths from RomanBath frontend
- [ ] Update ZeroClaw CHANGELOG-next

## Risks & open questions

1. **Multi-user**: `web:{character_name}` assumes single-user. SessionBackend trait supports user-scoped sessions via `SessionContext`, so multi-user is additive when needed. Not Phase 1.

2. **WS agent client backward compat**: Extending `/ws/chat` frame format must not break Companion mode / ACP / channel orchestrator. New RP fields are optional; old clients unaffected. Task 5 regression tests cover this.

3. **`add_custom_system_section` idempotency**: must verify it's safe to call once per session, or add a "set if not set" variant. If append-only, the second call would duplicate the character section. **Verify before Task 2 implementation.**

4. **LLM prompt cache invalidation**: LangGraph dev guidance warns against changing system prompt per turn. Set-once pattern mitigates this. If user wants character switch mid-session, Phase 2 adds explicit `switch_character` frame that's allowed to invalidate cache.

5. **WS reconnection**: When WS drops mid-stream, RomanBath must reconnect and resync. `session_start` frame already returns `resumed: true` + `message_count`. Verify client handles partial assistant reply recovery (was the last `done` received?).

6. **Conversation tree size**: heavily-branched RP could accumulate hundreds of nodes. SQLite `load_tree` is index-accelerated via `(session_id, parent_id)` composite, but consider `SessionBackend::compact` for very long sessions.

7. **JSONL backend fallback**: default is SQLite; JSONL is legacy. Migration idempotency via node IDs is guaranteed for SQLite, less so for JSONL. Tests should focus on SQLite; document JSONL as best-effort.

8. **Integrity slug (future)**: SillyTavern's pattern prevents concurrent-edit data loss. Not in Phase 1; add when multi-device sync lands.

## What this plan does NOT cover

- Multi-device real-time sync (server-push when other devices write — future)
- E2E encryption of session storage (currently plaintext; channels have same limitation)
- Migration of `branchMetaStore` (IDB) metadata that doesn't exist in `ConversationNode` — verify field-by-field what's missing during Phase 3
- Image gen / TTS / voice over WS (D4 explicitly scoped out)
- Character CRUD over WS (D4 explicitly scoped out)
- Multi-tenant / user accounts (single-user assumption preserved)
- Integrity slug (SillyTavern pattern — future enhancement)
- LobeChat-style 4-level hierarchy (overkill, only Sessions + Messages tree needed)
