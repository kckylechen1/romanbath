# Solution B — Remaining Work Spec (resume in a fresh session)

## Vision (why)
RomanBath = "a SillyTavern built with agents". The **zeroclaw Rust backend IS the
engine** (character cards, lorebook, branching conversation TREE, memory, affect,
tools, persistence). The **React frontend is a thin, replaceable interface** — a
future native client connects to the same backend and behaves the same. Solution B
makes the server the authoritative owner of conversation history as a tree and turns
the frontend into a view of it.

## Current state (done, committed, green)
Branch `feat/memory-sigil-continuity-substrate`. Solution B = commit range
`3a173531..HEAD` (server settings store → P0 tree storage → P1 WS dual-write → P2
backend protocol → P2 frontend → persistent connection → connect-on-load → 3 rounds
of review fixes). Tests green: gateway 231, infra 86, frontend 75; `tsc` + `vite build`
clean.

Already implemented:
- Server-side conversation TREE: additive nullable cols on `sessions`
  (`msg_id/parent_id/author_id/node_status/node_meta`) + `session_metadata.active_leaf`;
  `ConversationNode` + tree trait methods w/ linear-fallback defaults; `conversation_tip`,
  `node_exists`, `flatten_active_path`/`deepest_leaf`, `delete_subtree`
  (`zeroclaw-infra/src/session_sqlite.rs`, `session_backend.rs`). Linear `load()` is
  byte-identical (regression-tested) — protect this.
- WS protocol: `message` frame carries client `msg_id/parent_id/assistant_msg_id`;
  `persist_turn_as_nodes` persists exactly **user(RAW content) + assistant** per turn
  (no tool/intermediate nodes, no prompt-injection prefix); `history_snapshot` on connect;
  `done.node_id/active_leaf`; `select_leaf` frame; write-side validation of client tree
  refs (`zeroclaw-gateway/src/ws.rs`).
- Frontend: `mergeServerNodes` (union-by-id + childrenIds rebuild, `useMessageTree.ts`);
  persistent WS connection (reuse socket, `rebindCallbacks`, `selectLeaf`); connect-on-load
  hydration gated to history-bearing chats; swipe→select_leaf
  (`useChatGeneration.ts`, `useMessageActions.ts`, `services/zeroclawService.ts`).

Three independent adversarial reviews ran and their findings were fixed:
`~/.claude/plans/solutionB-review-verdict.md` (backend, 31-agent),
`p2-frontend-review-verdict.md` (frontend, 17-finding),
`solutionB-team-review-verdict.md` (full + UI, 26-item). Memory:
`~/.claude/projects/-Volumes-Storage-RomanBath/memory/arch-review-2026-06-27.md`.

---

## Increment 3 — regenerate / edit / delete become server-synced + memory gating
**Goal:** every conversation mutation goes through the server tree (today they're
local/REST), so the frontend is truly a view. Riskiest live-path rewire — do it first
in the fresh session, with care.

**Fix these BLOCKERS before wiring (else silent data corruption):**
- **SR-1 / BI-3** (`ws.rs` persist, `session_sqlite.rs:append_node`): `append_node` is a
  bare INSERT; a UNIQUE(session_key,msg_id) conflict is only logged. When a client reuses
  an id with new content the new content is dropped and the reply grafts onto the wrong
  parent. Fix: on the assistant node use `update_node` (upsert) on conflict; reject
  `user_msg_id == assistant_msg_id`; on a user-node conflict verify role/parent before
  chaining.
- **BI-2** (`session_sqlite.rs:delete_subtree`/`update_node`): `WHERE msg_id=?` never matches
  legacy linear rows (NULL msg_id, synthesized as `lin-{rowid}` in `load_tree`) →
  `delete_subtree` returns a removed-list but deletes nothing (false success); `update_node`
  silently no-ops. Fix: handle `lin-*` ids by rowid, or backfill `msg_id` on migration.

**Then implement:**
- **regenerate = send-with-parent (reuses the send path, no new backend frame):** send a
  `message` frame with `msg_id` = the EXISTING user node's id (append conflict swallowed →
  user node stays), `parent_id` = that user node's parent, a NEW `assistant_msg_id`,
  `content` = the user node's content. `persist_turn_as_nodes` then creates a new assistant
  SIBLING under the same user node = a regenerate. Rewire `handleRegenerate` +
  `handleGenerateSwipe` (`useMessageActions.ts`) from REST `generateText` to this WS send.
- **edit** = new backend `edit` frame → `update_node(msg_id, content)` + broadcast; frontend
  `handleEditMessage` sends it.
- **delete** = new backend `delete` frame → `delete_subtree(msg_id)` (after BI-2) +
  broadcast/tombstone; frontend `handleDeleteMessage` sends it (also fixes the X1 class
  permanently — server learns the delete).
- **Memory gating:** add an `alternate`/`regenerate` flag on the message frame; in
  `process_chat_message` SKIP `save_user_memory`, the assistant sigil `save_chat_memory`,
  `consolidate_turn`, and dreaming `light_sleep` for alternate turns — only the committed
  (selected) turn should feed memory, or swipe alternates pollute it.
- **Resolve FE-1 / FE-3 as part of wiring:** once branches are server-synced, `select_leaf`
  on them succeeds (FE-1 root cause gone) and X3 (adopt server `active_leaf` on load) becomes
  safe to re-enable in `useChatGeneration.ts` connect-on-load `onHistory`.
- **BI-5:** add `node_id`/`active_leaf` to the `aborted`/`error` frames (`ws.rs`) now that ids
  matter for retries.

**Verify:** new sigil/gateway tests (regenerate creates a sibling not a duplicate user;
alternate turn does NOT consolidate; edit updates by id incl. legacy rows; delete removes
subtree incl. legacy rows). Frontend: regenerate/swipe/edit/delete reflected in the server
tree on reconnect. `cargo test -p zeroclaw-gateway -p zeroclaw-infra -p zeroclaw-memory-sigil`,
frontend `tsc`+`vitest`+`build`.

---

## Increment 4 — IndexedDB → cache (server-authoritative load)
**Goal:** server tree is the load source of truth; IndexedDB becomes a cache. Do AFTER
inc 3 (else demotion loses local-only edits/deletes/regenerates).
- `useChatPersistence.ts`: load from the server `history_snapshot` as primary; IndexedDB
  is a fallback/offline cache.
- **FE-7:** server snapshot nodes must carry stable `timestamp` (else cross-device sibling
  ordering breaks — `useMessageTree.ts` sorts by timestamp; `Date.now()` fallback collapses
  order). Send the node `created_at` already stored.
- **FE-5** is done (hydration gate clears on switch) — confirm it holds.
- **SR-3 + SR-2 perf:** every connect serializes the whole tree; add a tree-version/etag so
  `history_snapshot` is skipped when unchanged; content cap already added.
- **MSN-5 / MSN-6:** model `status` and `author_id`/`extra.characterName` on
  `ServerHistoryNode` (frontend) so interrupted placeholders and group-chat speaker
  attribution survive a server-authoritative reload.

**Verify:** clear IndexedDB → chat loads fully from server; cross-device shows same tree +
correct sibling order + speaker names.

---

## Frontend redesign — surface the SillyTavern engine (team-review verdict: warranted)
Keep the "Intimate Presence" intimate default; add an optional **right rail** (or a
studio/power density mode) — an explicit product decision, not per-feature drift.
**Build the right-rail container FIRST** (UX-2 + UX-1 + UX-3 share it = highest ROI), then
touch accessibility. Use the `design` skill for the visual pass.

Ranked:
1. **UX-2 Context/Prompt inspector** (biggest gap). Show what a turn actually sent:
   resolved system prompt, which lorebook entries hit, injected memory, ~token budget.
   Needs a **backend addition** — expose the assembled context (on the `done` frame or a
   debug endpoint); the server already assembles it in the WS turn prep / `build_messages`.
2. **UX-1 Conversation-tree visualization** (frontend-only — tree data is already client
   side). Replace `BranchMiniMap`'s row-of-identical-dots with a real collapsible
   tree/graph: fork points, sibling counts, highlighted active path, jump-to-fork (not just
   jump-to-leaf), nameable/favoritable branches. `components/chat/BranchMiniMap.tsx`,
   `branchMiniMapUtils.ts`.
3. **UX-3 Memory controls.** Labeled entry (not the unlabeled avatar tap), entries
   delete/pin/edit/expand, tier as a real filter. `components/MemoryPanel.tsx`, `App.tsx`.
4. **UX-5 Touch accessibility.** Message actions are hover-only (`MessageBubble.tsx:231`,
   `onMouseEnter/Leave`) → unreachable on touch. Persistent `...`/tap-to-reveal; always-show
   main actions on the last assistant message.
5. **UX-4 Affect readout** (decode the glow: hover/label emotion). `App.tsx affectToGlowColor`.
6. **UX-6 Alternate greetings** selectable/swipeable on empty chat (pairs with greeting-as-node).

---

## TODO (ordered)
- [ ] **Inc 3a** Fix blockers SR-1/BI-3 (append_node upsert + reject user==assistant id) and
      BI-2 (lin-* delete/edit by rowid) + tests.
- [ ] **Inc 3b** regenerate/generate-swipe → WS send-with-parent; edit/delete → new WS frames;
      memory gating for alternates; re-enable X3 adopt; resolve FE-1/FE-3; BI-5 frame ids.
- [ ] **Inc 4** IndexedDB→cache; server timestamps (FE-7); status/author_id on nodes
      (MSN-5/6); snapshot etag (SR-3).
- [ ] **UI** Right-rail container → UX-2 context inspector (+ backend context exposure) →
      UX-1 tree view → UX-3 memory controls → UX-5 touch → UX-4/UX-6. Use `design` skill.
- [ ] Each step: `cargo test -p zeroclaw-gateway -p zeroclaw-infra -p zeroclaw-memory-sigil`
      + frontend `tsc`/`vitest`/`build`, commit atomically, then an adversarial review
      (ultracode workflow or codex CLI when available — codex hung this session, retry).

## Guardrails (don't regress)
- Linear `load()` byte-identity + the legacy-linear→new-turn `lin-{rowid}` chaining
  (regression-tested) — protect.
- Off/default path byte-identical for pre-P2 / non-companion (minted ids, raw content).
- Group chat + "Assistant" still use SSE (`useWs=false`) — untouched by the tree path.
- Write-side validation of client tree refs (read side validates active_leaf; write side
  must mirror via `node_exists`).

---

## COMPLETED — 2026-06-28 (all of the above shipped on `feat/memory-sigil-continuity-substrate`)

Every TODO item is done and committed (each verified + adversarially reviewed before commit).
Final state green: gateway 244 · infra 89(+1) · memory-sigil 55 · frontend 132 · tsc + vite build clean.

- **Inc 3a** (`88df8761`) — BI-2 (`update_node`/`delete_subtree` rowid fallback for legacy `lin-*`
  rows) + SR-1/BI-3 (assistant upsert + symmetric role guards on both user/assistant conflict +
  reject `user==assistant`). 9 goldens.
- **Inc 3b backend** (`87a66d16`) — `edit`/`delete` WS frames (testable `apply_edit`/`apply_delete`),
  `alternate`-turn memory gating (5 sites, default path byte-identical), BI-5 ids on aborted/error.
- **Inc 3b frontend** (`c6571761`) — regenerate/swipe → WS send-with-parent (alternate); edit/delete
  → WS frames (companion-gated); X3 re-enabled safely via `shouldAdoptServerLeaf`. (Implement agent
  died mid-run; wiring finished by hand + independently re-reviewed PASS.)
- **Inc 4** (`92c7c2ec`) — tombstone-aware merge (persisted `branchMetaStore`-style store) so a
  deleted node never resurrects, even after an offline delete + reload. FE-7/FE-5 already satisfied;
  MSN-5/MSN-6 redundant/moot; SR-3 etag + full IndexedDB→cache inversion deliberately DEFERRED
  (low-value/high-risk once mutations sync; the X3 yank was already fixed).
- **UX-2 backend** (`efef7ea5`) — `context_meta` frame (resolved system prompt) + `done.recalled_memories`.
- **Studio rail + UX-2** (`dfdc6462`) — right-rail drawer (Cmd/Ctrl+J) + context inspector.
- **UX-1** (`ab4e8b0d`) — conversation fork-graph (collapsible runs, sibling counts, active-path glow,
  jump-to-fork, nameable/favoritable branches, persisted).
- **UX-3** (`d4337821`) — memory CRUD (`delete_memory`/`update_memory` + DELETE/PATCH routes) + studio
  MemoryControls (filter/expand/edit/delete/pin); avatar tap → rail Memory tab; old MemoryPanel removed.
  Note: the "MemoryPanel reads wrong store" worry was a NON-ISSUE — read + write both use
  `{data_dir}/chat_memory`.
- **UX-5/4/6** (`2b626cd9`) — touch-accessible message actions (kebab + always-on last assistant);
  affect-glow emotion readout (`affectToLabel`); selectable alternate greetings on opening chat.

**Remaining (not blockers):** SR-3 snapshot etag (perf), full IndexedDB→cache inversion (deferred by
design). **Visual QA pending:** no browser was available, so the Studio rail, fork-tree, MemoryControls,
affect readout, kebab, and greeting picker were verified by tsc/tests/build + review only — needs a
manual pass at desktop + 375px.
