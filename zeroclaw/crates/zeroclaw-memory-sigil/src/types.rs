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

// ─── Continuity Event Ledger ────────────────────────────────────────────────
// Ported from Sigil memory-core@66119d6 (AGPL-3.0) types.rs; relicensed to
// this crate's MIT/Apache-2.0 by the sole copyright holder. These back the
// append-only `tachi_events` ledger (see event_ledger.rs) — the substrate for
// pattern/timeline/bonding projections. Inert until a projector consumes them.

/// How much authority a captured event has when a downstream projector or
/// adapter decides whether it can affect behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityLevel {
    #[default]
    CollectOnly,
    ReviewSignalOnly,
    InteractionRoutingOnly,
    ToneAndReminderOnly,
    Advisory,
    RawFact,
    DerivedEvidence,
    Blocker,
    ExecutionGate,
}

impl AuthorityLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CollectOnly => "collect_only",
            Self::ReviewSignalOnly => "review_signal_only",
            Self::InteractionRoutingOnly => "interaction_routing_only",
            Self::ToneAndReminderOnly => "tone_and_reminder_only",
            Self::Advisory => "advisory",
            Self::RawFact => "raw_fact",
            Self::DerivedEvidence => "derived_evidence",
            Self::Blocker => "blocker",
            Self::ExecutionGate => "execution_gate",
        }
    }

    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s.unwrap_or("").trim().to_ascii_lowercase().as_str() {
            "review_signal_only" => Self::ReviewSignalOnly,
            "interaction_routing_only" => Self::InteractionRoutingOnly,
            "tone_and_reminder_only" => Self::ToneAndReminderOnly,
            "advisory" => Self::Advisory,
            "raw_fact" => Self::RawFact,
            "derived_evidence" => Self::DerivedEvidence,
            "blocker" => Self::Blocker,
            "execution_gate" => Self::ExecutionGate,
            _ => Self::CollectOnly,
        }
    }

    /// Conservative default: only explicit evidence/gate levels should be
    /// considered eligible for automated decisions by downstream projectors.
    pub fn is_decision_eligible(&self) -> bool {
        matches!(
            self,
            Self::RawFact | Self::DerivedEvidence | Self::Blocker | Self::ExecutionGate
        )
    }
}

impl std::fmt::Display for AuthorityLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Behavioral surface an event may influence after projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectScope {
    None,
    Recall,
    Prompt,
    Routing,
    Tone,
    Scoring,
    Execution,
    MemoryWrite,
    ProjectCycle,
    DomainState,
}

impl EffectScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Recall => "recall",
            Self::Prompt => "prompt",
            Self::Routing => "routing",
            Self::Tone => "tone",
            Self::Scoring => "scoring",
            Self::Execution => "execution",
            Self::MemoryWrite => "memory_write",
            Self::ProjectCycle => "project_cycle",
            Self::DomainState => "domain_state",
        }
    }

    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s.unwrap_or("").trim().to_ascii_lowercase().as_str() {
            "recall" => Self::Recall,
            "prompt" => Self::Prompt,
            "routing" => Self::Routing,
            "tone" => Self::Tone,
            "scoring" | "score" => Self::Scoring,
            "execution" => Self::Execution,
            "memory_write" | "memory" => Self::MemoryWrite,
            "project_cycle" => Self::ProjectCycle,
            "domain_state" | "domain" => Self::DomainState,
            _ => Self::None,
        }
    }
}

impl std::fmt::Display for EffectScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Typed projection families that can consume append-only events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectionKind {
    Pattern,
    Timeline,
    Outcome,
    Affect,
    Bonding,
    WorldBook,
    ProjectCycle,
    DomainProfile,
    EvidenceGate,
}

impl ProjectionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pattern => "pattern",
            Self::Timeline => "timeline",
            Self::Outcome => "outcome",
            Self::Affect => "affect",
            Self::Bonding => "bonding",
            Self::WorldBook => "world_book",
            Self::ProjectCycle => "project_cycle",
            Self::DomainProfile => "domain_profile",
            Self::EvidenceGate => "evidence_gate",
        }
    }

    pub fn from_str_opt(s: Option<&str>) -> Option<Self> {
        match s.unwrap_or("").trim().to_ascii_lowercase().as_str() {
            "pattern" => Some(Self::Pattern),
            "timeline" => Some(Self::Timeline),
            "outcome" => Some(Self::Outcome),
            "affect" | "emotion" => Some(Self::Affect),
            "bonding" => Some(Self::Bonding),
            "world_book" | "worldbook" => Some(Self::WorldBook),
            "project_cycle" => Some(Self::ProjectCycle),
            "domain_profile" => Some(Self::DomainProfile),
            "evidence_gate" => Some(Self::EvidenceGate),
            _ => None,
        }
    }
}

impl std::fmt::Display for ProjectionKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Session-end outcome labels consumed by read-only continuity metrics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SessionOutcomeKind {
    #[default]
    Unknown,
    UserCorrect,
    AiCorrected,
    AiError,
    UserError,
    PartialReframe,
    MutualCorrection,
    NoContest,
    Unresolved,
}

impl SessionOutcomeKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::UserCorrect => "user_correct",
            Self::AiCorrected => "ai_corrected",
            Self::AiError => "ai_error",
            Self::UserError => "user_error",
            Self::PartialReframe => "partial_reframe",
            Self::MutualCorrection => "mutual_correction",
            Self::NoContest => "no_contest",
            Self::Unresolved => "unresolved",
        }
    }

    pub fn from_str_opt(s: Option<&str>) -> Self {
        let normalized = s
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
            .replace(['-', ' '], "_");
        match normalized.as_str() {
            "user_correct" | "user_was_correct" | "ai_revised" | "assistant_revised" => {
                Self::UserCorrect
            }
            "ai_corrected"
            | "ai_correct"
            | "assistant_corrected_user"
            | "ai_challenged_user_accepted" => Self::AiCorrected,
            "ai_error" | "assistant_error" | "ai_wrong" | "assistant_wrong" => Self::AiError,
            "user_error" | "user_wrong" => Self::UserError,
            "partial_reframe" | "partial" | "reframe" | "mixed_reframe" => Self::PartialReframe,
            "mutual_correction" | "both_corrected" | "both_partial" | "mixed" => {
                Self::MutualCorrection
            }
            "no_contest" | "no_claim" | "not_applicable" => Self::NoContest,
            "unresolved" | "pending" => Self::Unresolved,
            _ => Self::Unknown,
        }
    }

    /// Denominator for the read-only challenge-rate signal. Unknown,
    /// unresolved, and no-contest labels are deliberately excluded.
    pub fn is_challenge_rate_eligible(&self) -> bool {
        !matches!(self, Self::Unknown | Self::Unresolved | Self::NoContest)
    }
}

impl std::fmt::Display for SessionOutcomeKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Evidence axis for outcome labels. This keeps externally anchored revisions
/// separate from labels driven only by conversation pressure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeEvidenceBasis {
    ExternalEvidence,
    InterlocutorArgument,
    Testimonial,
    Mixed,
    #[default]
    Unverified,
}

impl OutcomeEvidenceBasis {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ExternalEvidence => "external_evidence",
            Self::InterlocutorArgument => "interlocutor_argument",
            Self::Testimonial => "testimonial",
            Self::Mixed => "mixed",
            Self::Unverified => "unverified",
        }
    }

    pub fn from_str_opt(s: Option<&str>) -> Self {
        let normalized = s
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
            .replace(['-', ' '], "_");
        match normalized.as_str() {
            "external_evidence" | "externally_anchored" | "verified" => Self::ExternalEvidence,
            "interlocutor_argument" | "argument" | "conversation_argument" => {
                Self::InterlocutorArgument
            }
            "testimonial" | "self_report" => Self::Testimonial,
            "mixed" => Self::Mixed,
            _ => Self::Unverified,
        }
    }
}

impl std::fmt::Display for OutcomeEvidenceBasis {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MetricCount {
    pub label: String,
    pub count: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SessionOutcomeMetrics {
    pub window_event_limit: usize,
    pub outcome_events: usize,
    pub eligible_outcomes: usize,
    pub ai_corrected: usize,
    pub challenge_rate: Option<f64>,
    pub labels: Vec<MetricCount>,
    pub evidence_basis: Vec<MetricCount>,
    pub note: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ContinuityMetrics {
    pub session_outcomes: SessionOutcomeMetrics,
}

/// Append-only, domain-neutral continuity event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TachiEventRecord {
    pub id: String,
    pub source_repo: String,
    pub adapter: String,
    pub project: String,
    pub domain: String,
    pub session_id: String,
    pub actor: String,
    pub event_type: String,
    pub authority: AuthorityLevel,
    pub effects: Vec<EffectScope>,
    pub projection_hints: Vec<ProjectionKind>,
    pub payload: serde_json::Value,
    pub provenance: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TachiEventQuery {
    pub project: Option<String>,
    pub domain: Option<String>,
    pub event_type: Option<String>,
    pub session_id: Option<String>,
    pub source_repo: Option<String>,
    pub adapter: Option<String>,
    pub limit: usize,
}
