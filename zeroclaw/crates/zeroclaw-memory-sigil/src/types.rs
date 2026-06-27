// types.rs — Simplified data types for RomanBath chat memory.
//
// Stripped down from Sigil memory-core: removed persons, location,
// valid_from/until, superseded_by, topic, domain, revision, vector,
// and subsystem-owned categories/sources.

use serde::{Deserialize, Serialize};

// ─── Retention Policy ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RetentionPolicy {
    Ephemeral,
    #[default]
    Durable,
    Permanent,
    Pinned,
}

impl RetentionPolicy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ephemeral => "ephemeral",
            Self::Durable => "durable",
            Self::Permanent => "permanent",
            Self::Pinned => "pinned",
        }
    }

    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s {
            Some("ephemeral") => Self::Ephemeral,
            Some("durable") => Self::Durable,
            Some("permanent") => Self::Permanent,
            Some("pinned") => Self::Pinned,
            _ => Self::Durable,
        }
    }

    pub fn is_gc_exempt(&self) -> bool {
        matches!(self, Self::Permanent | Self::Pinned)
    }
}

impl std::fmt::Display for RetentionPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ─── Memory Source ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemorySource {
    Manual,
    Extraction,
    Auto,
    Chat,
}

impl MemorySource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Extraction => "extraction",
            Self::Auto => "auto",
            Self::Chat => "chat",
        }
    }

    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s.unwrap_or("").trim() {
            "manual" => Self::Manual,
            "extraction" => Self::Extraction,
            "auto" => Self::Auto,
            "chat" => Self::Chat,
            _ => Self::Manual,
        }
    }
}

impl std::fmt::Display for MemorySource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ─── Memory Scope ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScope {
    User,
    Project,
    #[default]
    General,
}

impl MemoryScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Project => "project",
            Self::General => "general",
        }
    }

    pub fn normalize(s: &str) -> &'static str {
        Self::from_str_opt(Some(s)).as_str()
    }

    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s.unwrap_or("").trim().to_ascii_lowercase().as_str() {
            "user" => Self::User,
            "project" => Self::Project,
            _ => Self::General,
        }
    }
}

impl std::fmt::Display for MemoryScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ─── Memory Category ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCategory {
    #[default]
    Fact,
    Decision,
    Experience,
    Preference,
    Entity,
    Other,
}

impl MemoryCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fact => "fact",
            Self::Decision => "decision",
            Self::Experience => "experience",
            Self::Preference => "preference",
            Self::Entity => "entity",
            Self::Other => "other",
        }
    }

    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s.unwrap_or("").trim().to_ascii_lowercase().as_str() {
            "fact" => Self::Fact,
            "decision" => Self::Decision,
            "experience" => Self::Experience,
            "preference" => Self::Preference,
            "entity" => Self::Entity,
            _ => Self::Other,
        }
    }

    pub fn normalize(s: &str) -> &'static str {
        Self::from_str_opt(Some(s)).as_str()
    }
}

impl std::fmt::Display for MemoryCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ─── Core Entry ──────────────────────────────────────────────────────────────

/// A single memory entry for RomanBath chat memory.
///
/// Simplified from Sigil: no persons, location, valid_from/until,
/// superseded_by, topic, domain, revision, vector fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    /// UUID primary key.
    pub id: String,

    /// Hierarchical path, e.g. "/chat/jayne/memories/preferences"
    #[serde(default = "default_path")]
    pub path: String,

    /// Short summary (≤100 chars).
    #[serde(default)]
    pub summary: String,

    /// Full text content.
    pub text: String,

    /// Importance score 0.0–1.0.
    #[serde(default = "default_importance")]
    pub importance: f64,

    /// ISO 8601 timestamp.
    #[serde(alias = "created_at")]
    pub timestamp: String,

    /// Category: fact | decision | experience | preference | entity | other.
    #[serde(default = "default_category")]
    pub category: String,

    /// Keyword tags for FTS indexing.
    #[serde(default)]
    pub keywords: Vec<String>,

    /// Entity names mentioned (user, characters, etc.).
    #[serde(default)]
    pub entities: Vec<String>,

    /// Write provenance: "manual" | "extraction" | "auto" | "chat".
    #[serde(default = "default_source")]
    pub source: String,

    /// Scope: "user" | "project" | "general".
    #[serde(default = "default_scope")]
    pub scope: String,

    /// Soft-delete marker.
    #[serde(default)]
    pub archived: bool,

    /// Number of times this entry has been retrieved.
    #[serde(default)]
    pub access_count: i64,

    /// Last retrieval time (ISO 8601).
    #[serde(default)]
    pub last_access: Option<String>,

    /// Retention policy.
    #[serde(default)]
    pub retention_policy: Option<String>,

    /// Catch-all JSON blob.
    #[serde(default = "default_metadata")]
    pub metadata: serde_json::Value,

    /// How many times retrieved via search hit.
    #[serde(default)]
    pub recall_count: i64,

    /// Distinct query contexts that retrieved this memory.
    #[serde(default)]
    pub query_diversity: i64,

    /// Quality tier: "raw" | "consolidated" | "pattern".
    #[serde(default = "default_tier")]
    pub tier: String,
}

// ─── Scoring Types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridScore {
    pub vector: f64,
    pub fts: f64,
    pub symbolic: f64,
    pub decay: f64,
    #[serde(rename = "final")]
    pub final_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub entry: MemoryEntry,
    pub score: HybridScore,
}

// ─── Graph Types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEdge {
    pub source_id: String,
    pub target_id: String,
    pub relation: String,
    #[serde(default = "default_edge_weight")]
    pub weight: f64,
    #[serde(default = "default_metadata")]
    pub metadata: serde_json::Value,
    #[serde(default)]
    pub created_at: String,
}

// ─── Dreaming Types ──────────────────────────────────────────────────────────

/// Report from a dreaming pipeline run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DreamingReport {
    pub stage: String,
    pub character_name: String,
    pub memories_processed: usize,
    pub memories_created: usize,
    pub memories_merged: usize,
    pub memories_promoted: usize,
    pub patterns_discovered: usize,
    pub duration_ms: u64,
}

// ─── Defaults ────────────────────────────────────────────────────────────────

fn default_path() -> String {
    "/".to_string()
}
fn default_importance() -> f64 {
    0.7
}
fn default_category() -> String {
    "fact".to_string()
}
fn default_source() -> String {
    "manual".to_string()
}
fn default_scope() -> String {
    "general".to_string()
}
fn default_metadata() -> serde_json::Value {
    serde_json::Value::Object(Default::default())
}
pub fn default_tier() -> String {
    "raw".to_string()
}
fn default_edge_weight() -> f64 {
    1.0
}

