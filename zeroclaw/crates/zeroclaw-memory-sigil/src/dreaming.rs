// dreaming.rs — Three-stage sleep model for RomanBath chat memory.
//
// Light Sleep (every 6h):  extract short-term memories, dedup/merge
// Deep Sleep  (daily 3am): promote raw → consolidated (recall>=3, diversity>=3, importance>=0.8)
// REM Sleep   (weekly 5am Sun): cross-domain pattern discovery → pattern tier
//
// When a `MemoryEnricher` is attached, each stage augments its pure-Rust
// heuristics with LLM-powered enrichment.  The enricher is optional;
// `None` preserves the original behaviour exactly.

use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use crate::enrichment::MemoryEnricher;
use crate::memory_crud::{self, now_utc_iso, MemoryError};
use crate::scorer::tokenize;
use crate::types::{DreamingReport, MemoryEntry};

// ─── Pipeline ────────────────────────────────────────────────────────────────

pub struct DreamingPipeline {
    db_path: String,
    /// Optional LLM enricher.  `None` → pure-Rust heuristics (backward compatible).
    enricher: Option<Arc<MemoryEnricher>>,
}

impl DreamingPipeline {
    pub fn new(db_path: &str) -> Self {
        Self {
            db_path: db_path.to_string(),
            enricher: None,
        }
    }

    /// Attach an LLM enricher for AI-powered extraction, verification, and
    /// pattern discovery.
    pub fn with_enricher(mut self, enricher: Arc<MemoryEnricher>) -> Self {
        self.enricher = Some(enricher);
        self
    }

    fn open(&self) -> Result<Connection, MemoryError> {
        let conn = if Path::new(&self.db_path).exists() {
            Connection::open(&self.db_path)?
        } else {
            let conn = Connection::open(&self.db_path)?;
            crate::schema::init_schema(&conn)?;
            conn
        };
        Ok(conn)
    }

    /// Light Sleep: every ~6 hours, extract short-term raw memories, dedup/merge.
    /// If an enricher is present, surviving raw entries get LLM-extracted
    /// summaries, keywords, entities, and importance scores.
    pub async fn run_light_sleep(&self, character_name: &str) -> DreamingReport {
        let start = Instant::now();
        let path_prefix = format!("/chat/{character_name}/memories");

        // Phase 1: synchronous dedup/merge
        let dedup_result = (|| -> Result<(usize, usize), MemoryError> {
            let mut conn = self.open()?;
            let entries = memory_crud::list_by_path(&conn, &path_prefix, 500)?;

            let raw_entries: Vec<&MemoryEntry> = entries
                .iter()
                .filter(|e| e.tier == "raw")
                .collect();

            let mut merged = 0usize;
            let processed = raw_entries.len();

            let mut to_delete: HashSet<String> = HashSet::new();
            for i in 0..raw_entries.len() {
                if to_delete.contains(&raw_entries[i].id) {
                    continue;
                }
                for j in (i + 1)..raw_entries.len() {
                    if to_delete.contains(&raw_entries[j].id) {
                        continue;
                    }
                    if jaccard_similarity(&raw_entries[i].text, &raw_entries[j].text) > 0.9 {
                        let loser = if raw_entries[i].importance >= raw_entries[j].importance {
                            &raw_entries[j]
                        } else {
                            &raw_entries[i]
                        };
                        to_delete.insert(loser.id.clone());
                        merged += 1;
                    }
                }
            }

            for id in &to_delete {
                let _ = memory_crud::delete(&mut conn, id);
            }

            Ok((processed, merged))
        })();

        let (processed, merged_count) = dedup_result.unwrap_or((0, 0));

        // Phase 2: async LLM enrichment for surviving raw entries
        if let Some(enricher) = &self.enricher {
            let enrich_ok = async {
                let mut conn = self.open()?;
                let entries = memory_crud::list_by_path(&conn, &path_prefix, 500)?;
                let surviving: Vec<MemoryEntry> = entries
                    .into_iter()
                    .filter(|e| e.tier == "raw")
                    .collect();

                for entry in &surviving {
                    match enricher.extract_facts(&entry.text, character_name, "user").await {
                        Ok((summary, keywords, entities, importance)) => {
                            let mut updated = entry.clone();
                            updated.summary = summary;
                            updated.keywords = keywords;
                            updated.entities = entities;
                            updated.importance = importance;
                            if let Err(_e) = memory_crud::upsert(&mut conn, &updated) {
                                // Enrichment upsert failed — best-effort, skip.
                            }
                        }
                        Err(_e) => {
                            // extract_facts failed — best-effort, skip.
                        }
                    }
                }
                Ok::<(), MemoryError>(())
            }
            .await;
            let _ = enrich_ok;
        }

        DreamingReport {
            stage: "light_sleep".to_string(),
            character_name: character_name.to_string(),
            memories_processed: processed,
            memories_created: 0,
            memories_merged: merged_count,
            memories_promoted: 0,
            patterns_discovered: 0,
            duration_ms: start.elapsed().as_millis() as u64,
        }
    }

    /// Deep Sleep: daily, promote raw → consolidated when recall>=3, diversity>=3, importance>=0.8.
    /// If an enricher is present, candidates also undergo LLM verification
    /// before promotion.
    pub async fn run_deep_sleep(&self, character_name: &str) -> DreamingReport {
        let start = Instant::now();
        let path_prefix = format!("/chat/{character_name}/memories");

        // Phase 1: load candidates (sync)
        let candidates: Vec<MemoryEntry> = (|| -> Result<Vec<MemoryEntry>, MemoryError> {
            let conn = self.open()?;
            let entries = memory_crud::list_by_path(&conn, &path_prefix, 1000)?;
            Ok(entries
                .into_iter()
                .filter(|e| {
                    e.tier == "raw"
                        && e.recall_count >= 3
                        && e.query_diversity >= 3
                        && e.importance >= 0.8
                })
                .collect())
        })()
        .unwrap_or_default();

        let raw_count = candidates.len();

        // Phase 2: LLM verification (async), then promote
        let mut promoted = 0usize;
        match self.open() {
            Ok(conn) => {
                for entry in &candidates {
                    let should_promote = if let Some(enricher) = &self.enricher {
                        enricher
                            .verify_consolidation(
                                &entry.summary,
                                &entry.text,
                                entry.recall_count,
                            )
                            .await
                            .unwrap_or_default()
                    } else {
                        true // no enricher → original behaviour
                    };

                    if should_promote {
                        let _ = conn.execute(
                            "UPDATE memories SET tier = 'consolidated' WHERE id = ?1 AND tier = 'raw'",
                            params![entry.id],
                        );
                        promoted += 1;
                    }
                }
            }
            Err(_) => { /* DB open failed, nothing to promote */ }
        }

        DreamingReport {
            stage: "deep_sleep".to_string(),
            character_name: character_name.to_string(),
            memories_processed: raw_count,
            memories_created: 0,
            memories_merged: 0,
            memories_promoted: promoted,
            patterns_discovered: 0,
            duration_ms: start.elapsed().as_millis() as u64,
        }
    }

    /// REM Sleep: weekly, discover cross-domain patterns → promote to pattern tier.
    /// If an enricher is present, uses LLM-powered pattern discovery in addition
    /// to the keyword-overlap heuristic.
    pub async fn run_rem_sleep(&self, character_name: &str) -> DreamingReport {
        let start = Instant::now();
        let path_prefix = format!("/chat/{character_name}/memories");

        // Phase 1: load consolidated entries (sync)
        let consolidated: Vec<MemoryEntry> = (|| -> Result<Vec<MemoryEntry>, MemoryError> {
            let conn = self.open()?;
            let entries = memory_crud::list_by_path(&conn, &path_prefix, 2000)?;
            Ok(entries
                .into_iter()
                .filter(|e| e.tier == "consolidated")
                .collect())
        })()
        .unwrap_or_default();

        let mut patterns = 0usize;

        // Phase 2: LLM enrichment — pattern discovery (async)
        if let Some(enricher) = &self.enricher {
            let memory_texts: Vec<String> = consolidated
                .iter()
                .map(|e| format!("[{}] {} — {}", e.category, e.summary, e.text))
                .collect();

            if !memory_texts.is_empty() {
                match enricher
                    .discover_patterns(&memory_texts, character_name)
                    .await
                {
                    Ok(discovered) => {
                        for pattern_text in &discovered {
                            let pattern_id = uuid::Uuid::new_v4().to_string();
                            let summary: String = pattern_text.chars().take(100).collect();
                            let pattern_entry = MemoryEntry {
                                id: pattern_id,
                                path: format!("/chat/{character_name}/patterns/llm"),
                                summary,
                                text: pattern_text.clone(),
                                importance: 0.9,
                                timestamp: now_utc_iso(),
                                category: "other".to_string(),
                                keywords: vec![],
                                entities: vec![],
                                source: "auto".to_string(),
                                scope: "general".to_string(),
                                archived: false,
                                access_count: 0,
                                last_access: None,
                                retention_policy: Some("permanent".to_string()),
                                metadata: serde_json::json!({
                                    "dreaming_stage": "rem",
                                    "discovery_method": "llm",
                                    "source_count": consolidated.len()
                                }),
                                recall_count: 0,
                                query_diversity: 0,
                                tier: "pattern".to_string(),
                            };
                            if let Ok(mut conn_mut) = self.open()
                                && memory_crud::upsert(&mut conn_mut, &pattern_entry).is_ok()
                            {
                                patterns += 1;
                            }
                        }
                    }
                    Err(_e) => {
                        // LLM pattern discovery failed — fall through to heuristic.
                    }
                }
            }
        }

        // Phase 3: keyword-overlap heuristic (always runs)
        let mut by_category: std::collections::HashMap<&str, Vec<&MemoryEntry>> =
            std::collections::HashMap::new();
        for entry in &consolidated {
            by_category
                .entry(&entry.category)
                .or_default()
                .push(entry);
        }

        let mut new_id = uuid::Uuid::new_v4().to_string();
        for (cat, group) in &by_category {
            if group.len() < 3 {
                continue;
            }

            let mut kw_counts: std::collections::HashMap<&str, usize> =
                std::collections::HashMap::new();
            for entry in group {
                for kw in &entry.keywords {
                    *kw_counts.entry(kw.as_str()).or_default() += 1;
                }
            }

            let common_kws: Vec<String> = kw_counts
                .iter()
                .filter(|&(_, count)| *count >= 3)
                .map(|(kw, _)| kw.to_string())
                .collect();

            if common_kws.len() >= 2 {
                let pattern_text = format!(
                    "Pattern discovered across {} {} memories: {}",
                    group.len(),
                    cat,
                    common_kws.join(", ")
                );
                let summary: String = pattern_text.chars().take(100).collect();
                let pattern_entry = MemoryEntry {
                    id: new_id.clone(),
                    path: format!("/chat/{character_name}/patterns/{cat}"),
                    summary,
                    text: pattern_text,
                    importance: 0.9,
                    timestamp: now_utc_iso(),
                    category: cat.to_string(),
                    keywords: common_kws,
                    entities: vec![],
                    source: "auto".to_string(),
                    scope: "general".to_string(),
                    archived: false,
                    access_count: 0,
                    last_access: None,
                    retention_policy: Some("permanent".to_string()),
                    metadata: serde_json::json!({
                        "dreaming_stage": "rem",
                        "discovery_method": "keyword_overlap",
                        "source_count": group.len()
                    }),
                    recall_count: 0,
                    query_diversity: 0,
                    tier: "pattern".to_string(),
                };
                if let Ok(mut conn_mut) = self.open()
                    && memory_crud::upsert(&mut conn_mut, &pattern_entry).is_ok()
                {
                    patterns += 1;
                }
                new_id = uuid::Uuid::new_v4().to_string();
            }
        }

        DreamingReport {
            stage: "rem_sleep".to_string(),
            character_name: character_name.to_string(),
            memories_processed: consolidated.len(),
            memories_created: patterns,
            memories_merged: 0,
            memories_promoted: 0,
            patterns_discovered: patterns,
            duration_ms: start.elapsed().as_millis() as u64,
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn jaccard_similarity(a: &str, b: &str) -> f64 {
    let ta: HashSet<String> = tokenize(a).into_iter().collect();
    let tb: HashSet<String> = tokenize(b).into_iter().collect();
    if ta.is_empty() && tb.is_empty() {
        return 0.0;
    }
    let intersection = ta.intersection(&tb).count() as f64;
    let union = ta.union(&tb).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}
