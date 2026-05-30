# Delegated Task

在 /Volumes/Storage/RomanBath/zeroclaw/crates/zeroclaw-memory-sigil 中添加 LLM enrichment 模块。

## 背景
zeroclaw 已有完整的 provider 层 (`zeroclaw-providers`)，支持 OpenAI/Anthropic/Gemini/OpenRouter 等。`ModelProvider` trait 提供 `chat_with_history(&self, messages: &[ChatMessage], model: &str, temperature: Option<f64>) -> anyhow::Result<String>`。

## 任务

### 1. 创建 `src/enrichment.rs`

```rust
// enrichment.rs — LLM-powered memory enrichment for the dreaming pipeline.
//
// Light Sleep:  extract facts + summaries via cheap model (Qwen 3.5 27B)
// Deep Sleep:   verify consolidation candidates via medium model
// REM Sleep:    cross-domain pattern discovery via strong model (DeepSeek V4)

use std::sync::Arc;
use zeroclaw_api::model_provider::{ChatMessage, ModelProvider};

pub struct MemoryEnricher {
    /// Provider for extraction/summarization (cheap, fast)
    pub extract_provider: Arc<dyn ModelProvider>,
    pub extract_model: String,
    /// Provider for deep distillation (strong, expensive)
    pub distill_provider: Arc<dyn ModelProvider>,
    pub distill_model: String,
}

impl MemoryEnricher {
    pub fn new(
        extract_provider: Arc<dyn ModelProvider>,
        extract_model: &str,
        distill_provider: Arc<dyn ModelProvider>,
        distill_model: &str,
    ) -> Self { ... }

    /// Extract facts, summary, and keywords from raw chat text.
    /// Used by Light Sleep.
    /// Returns (summary, keywords, entities, importance).
    pub async fn extract_facts(&self, text: &str, character_name: &str, user_name: &str) 
        -> anyhow::Result<(String, Vec<String>, Vec<String>, f64)>;

    /// Verify whether a raw memory should be promoted to consolidated.
    /// Used by Deep Sleep.
    pub async fn verify_consolidation(&self, entry_summary: &str, entry_text: &str, recall_count: i64) 
        -> anyhow::Result<bool>;

    /// Discover cross-domain patterns from a batch of consolidated memories.
    /// Used by REM Sleep. Returns pattern text and updated truths.
    pub async fn discover_patterns(&self, entries: &[String], character_name: &str) 
        -> anyhow::Result<Vec<String>>;
}
```

### 2. LLM Prompt 设计

**extract_facts prompt:**
```
You are a memory extraction system for {character_name}, an AI companion.
Extract factual information from the following chat message sent by {user_name}.

Output JSON:
{
  "summary": "≤100 char summary in Chinese",
  "keywords": ["tag1", "tag2"],
  "entities": ["entity1"],
  "importance": 0.0-1.0
}

Chat message: {text}
```

**verify_consolidation prompt:**
```
Memory candidate for consolidation:
Summary: {summary}
Full text: {text}
Recall count: {recall_count}

Should this memory be promoted from "raw" to "consolidated" tier?
Reply ONLY "yes" or "no".
```

**discover_patterns prompt:**
```
You are {character_name}'s memory distillation system.
Review the following consolidated memories from the past week:

{memories}

Discover cross-domain patterns and insights. Output as JSON array of pattern strings:
["pattern1", "pattern2"]
```

### 3. 集成到 dreaming.rs

修改 `DreamingPipeline`：
- 添加 `Option<Arc<MemoryEnricher>>` 字段
- `run_light_sleep`: 如果 enricher 存在，对去重后的记忆调用 `extract_facts` 更新 summary/keywords
- `run_deep_sleep`: 如果 enricher 存在，对候选记忆调用 `verify_consolidation` 做 LLM 验证
- `run_rem_sleep`: 如果 enricher 存在，调用 `discover_patterns` 做深度蒸馏

enricher 为 None 时保持现有纯 Rust 行为（向后兼容）。

### 4. 添加到 Cargo.toml

在 `zeroclaw-memory-sigil/Cargo.toml` 添加：
```toml
zeroclaw-api.workspace = true
tokio = { version = "1", features = ["full"] }
```

### 5. 更新 lib.rs

添加 `pub mod enrichment;` 和 re-export `MemoryEnricher`。

### 6. 编译验证

```bash
cargo check -p zeroclaw-memory-sigil
cargo test -p zeroclaw-memory-sigil
```

必须通过。新增 enrichment 相关测试。
