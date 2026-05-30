# Delegated Task

在 /Volumes/Storage/RomanBath/zeroclaw 仓库中创建新 crate `crates/zeroclaw-memory-sigil`，从 /Users/kckylechen/Desktop/Sigil/crates/memory-core 搬运并魔改以下代码用于 RomanBath 聊天机器人记忆系统。

## 任务

### 1. 创建 crate 结构
- `crates/zeroclaw-memory-sigil/Cargo.toml` — 依赖 rusqlite 0.37 bundled, serde, serde_json, uuid v4, thiserror 2, chrono, anyhow
- `crates/zeroclaw-memory-sigil/src/lib.rs` — pub mod 声明
- 注册到 workspace Cargo.toml（members + workspace.dependencies）

### 2. 搬运 types.rs
从 Sigil 搬运并精简 `MemoryEntry`, `RetentionPolicy`, `MemoryCategory`, `MemorySource`, `SearchResult`。去掉 persons/kanban/handoff/ghost/wiki/guide 等 RomanBath 不需要的。保留核心字段：id, path, summary, text, importance, timestamp, category, keywords, entities, source, scope, archived, access_count, last_access, recall_count, query_diversity, tier, metadata。

### 3. 搬运 schema.rs
搬运 SQLite schema 初始化，精简为 RomanBath 需要的表：
- memories 表（去掉 persons, location, valid_from/until, superseded_by）
- memories_fts (FTS5, tokenize='simple')
- memory_edges（图谱边）
- embedding_cache（可选，vec_available=false 时跳过）

### 4. 搬运 memory_crud.rs
搬运 upsert, get_by_id, list_by_path, delete, search_fts 等核心 CRUD。去掉 foundry 相关、agent_state、audit 等。

### 5. 搬运 noise.rs
搬运 is_noise_text，增加聊天特化过滤：过滤纯 emoji、单字回复、系统消息。

### 6. 搬运 scorer.rs
搬运 decay_score（ACT-R 衰减）、tier_half_life、cosine_similarity。

### 7. 创建 dreaming.rs — 三阶段睡眠模型
```rust
pub struct DreamingPipeline { store_path: String }

impl DreamingPipeline {
    // Light Sleep: 每6小时，提取短期记忆，去重合并
    pub async fn run_light_sleep(&self, character_name: &str) -> DreamingReport;
    
    // Deep Sleep: 每天凌晨3点，raw→consolidated 晋升（recall>=3, diversity>=3, importance>=0.8）
    pub async fn run_deep_sleep(&self, character_name: &str) -> DreamingReport;
    
    // REM Sleep: 每周日凌晨5点，跨域模式发现，产出 pattern tier
    pub async fn run_rem_sleep(&self, character_name: &str) -> DreamingReport;
}
```

### 8. 创建 chat_memory.rs — 聊天记忆集成
- `ChatMemoryStore` — 封装 MemoryStore，按 character_name 分区
- `save_chat_memory(character_name, user_name, role, content)` — 保存聊天消息为记忆
- `recall_memories(character_name, query, top_k)` — 搜索相关记忆
- `inject_memories_into_prompt(character_name, conversation_text)` — 返回应注入 prompt 的记忆文本

### 9. 更新 api_chat.rs
在 zeroclaw-gateway 的 process_chat 中，加载角色卡后调用 ChatMemoryStore::inject_memories_into_prompt，将相关记忆追加到 system prompt fragments 中。

### 10. 编译验证
cargo check -p zeroclaw-memory-sigil 和 cargo check -p zeroclaw-gateway 必须通过。

## 关键魔改点
- 所有路径用 character_name 作为 namespace：`/chat/{character_name}/memories/...`
- dreaming pipeline 按 character_name 独立运行
- 去掉所有 foundry/agent_evolution/kanban/handoff 相关代码
- 去掉 vault 加密（RomanBath 不需要）
- 去掉 hub/sandbox/pack 等子系统
- 聊天噪音过滤：过滤纯表情、单字、系统角色消息
