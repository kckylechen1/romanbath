// scorer.rs — ACT-R decay scoring and hybrid ranking for RomanBath chat memory.
//
// Simplified from Sigil: no stock-code precision boosting, no PageRank,
// no graph spreading activation. Core decay + cosine + symbolic + FTS hybrid.

use chrono::Utc;
use std::collections::{HashMap, HashSet};

use crate::noise::is_cjk;
use crate::types::{HybridScore, MemoryEntry};

// ─── Decay Scoring ──────────────────────────────────────────────────────────

const HALF_LIFE_DAYS: f64 = 30.0;

pub fn tier_half_life(tier: &str) -> f64 {
    match tier {
        "pattern" => 30_000.0,
        "consolidated" => 60.0,
        _ => HALF_LIFE_DAYS,
    }
}

/// Normalize an f64 to [0, 1].
#[inline]
pub fn normalize(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

/// Cosine similarity between two equal-length f32 slices.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    debug_assert_eq!(a.len(), b.len(), "vector dimension mismatch");
    let mut dot = 0.0_f64;
    let mut mag_a = 0.0_f64;
    let mut mag_b = 0.0_f64;
    for (x, y) in a.iter().zip(b.iter()) {
        let x = *x as f64;
        let y = *y as f64;
        dot += x * y;
        mag_a += x * x;
        mag_b += y * y;
    }
    let mag = mag_a.sqrt() * mag_b.sqrt();
    if mag == 0.0 {
        0.0
    } else {
        (dot / mag).clamp(-1.0, 1.0)
    }
}

/// Memory decay score (ACT-R inspired).
///
/// `decay = max(recency × (1 + 0.2 × log10(1 + access_count)), importance × 0.3)`
pub fn decay_score(entry: &MemoryEntry) -> f64 {
    let now = Utc::now();
    let reference = entry
        .last_access
        .as_ref()
        .and_then(|s| s.parse::<chrono::DateTime<Utc>>().ok())
        .or_else(|| entry.timestamp.parse::<chrono::DateTime<Utc>>().ok())
        .unwrap_or(now);

    let age_days = (now - reference).num_seconds().max(0) as f64 / 86_400.0;
    let half_life = tier_half_life(&entry.tier);
    let recency = (-0.693 * age_days / half_life).exp();
    let frequency = (1.0 + entry.access_count as f64).log10();
    let importance_floor = entry.importance * 0.3;

    (recency * (1.0 + 0.2 * frequency)).max(importance_floor)
}

// ─── Symbolic Scoring ───────────────────────────────────────────────────────

/// Simple tokeniser: Latin splits on non-alphanumeric (≥2 chars), CJK emits per char.
pub fn tokenize(s: &str) -> Vec<String> {
    let lower = s.to_lowercase();
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in lower.chars() {
        if is_cjk(ch) {
            if current.len() >= 2 {
                tokens.push(std::mem::take(&mut current));
            } else {
                current.clear();
            }
            tokens.push(ch.to_string());
        } else if ch.is_alphanumeric() {
            current.push(ch);
        } else if current.len() >= 2 {
            tokens.push(std::mem::take(&mut current));
        } else {
            current.clear();
        }
    }
    if current.len() >= 2 {
        tokens.push(current);
    }
    tokens
}

/// Compute query-token recall score [0, 1].
pub fn symbolic_score(
    query: &str,
    entry_text: &str,
    keywords: &[String],
    entities: &[String],
) -> f64 {
    let query_tokens: HashSet<String> = tokenize(query).into_iter().collect();
    if query_tokens.is_empty() {
        return 0.0;
    }

    let mut text_tokens: HashSet<String> = tokenize(entry_text).into_iter().collect();
    for kw in keywords {
        text_tokens.extend(tokenize(kw));
    }
    for ent in entities {
        let trimmed = ent.trim();
        if !trimmed.is_empty() {
            text_tokens.extend(tokenize(trimmed));
            text_tokens.insert(trimmed.to_ascii_lowercase());
        }
    }

    let overlap = query_tokens.intersection(&text_tokens).count();
    (overlap as f64) / (query_tokens.len().max(1) as f64)
}

// ─── Hybrid Scoring ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct HybridWeights {
    pub semantic: f64,
    pub fts: f64,
    pub symbolic: f64,
    pub decay: f64,
}

impl Default for HybridWeights {
    fn default() -> Self {
        Self {
            semantic: 0.35,
            fts: 0.25,
            symbolic: 0.20,
            decay: 0.20,
        }
    }
}

/// Compute hybrid scores for a set of entries.
pub fn hybrid_score(
    entries: &HashMap<String, &MemoryEntry>,
    fts_scores: &HashMap<String, f64>,
    symbolic_scores: &HashMap<String, f64>,
    weights: &HybridWeights,
) -> HashMap<String, HybridScore> {
    let all_ids: HashSet<&String> = fts_scores.keys().chain(symbolic_scores.keys()).collect();

    let mut out: HashMap<String, HybridScore> = HashMap::new();

    for id in all_ids {
        let fs = normalize(*fts_scores.get(id).unwrap_or(&0.0));
        let ss = normalize(*symbolic_scores.get(id).unwrap_or(&0.0));
        let ds = entries
            .get(id.as_str())
            .map(|e| decay_score(e))
            .unwrap_or(0.0);

        let final_score = weights.fts * fs + weights.symbolic * ss + weights.decay * ds;

        out.insert(
            id.clone(),
            HybridScore {
                vector: 0.0, // no vector search in this crate
                fts: fs,
                symbolic: ss,
                decay: ds,
                final_score,
            },
        );
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::MemoryEntry;

    fn test_entry(id: &str) -> MemoryEntry {
        MemoryEntry {
            id: id.into(),
            path: "/test".into(),
            summary: String::new(),
            text: String::new(),
            importance: 0.7,
            timestamp: Utc::now().to_rfc3339(),
            category: "fact".into(),
            keywords: vec![],
            entities: vec![],
            source: "manual".into(),
            scope: "general".into(),
            archived: false,
            access_count: 0,
            last_access: None,
            retention_policy: None,
            metadata: serde_json::json!({}),
            recall_count: 0,
            query_diversity: 0,
            tier: "raw".to_string(),
        }
    }

    #[test]
    fn cosine_identity() {
        let v = vec![1.0_f32, 0.0, 0.0];
        assert!((cosine_similarity(&v, &v) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn cosine_orthogonal() {
        let a = vec![1.0_f32, 0.0];
        let b = vec![0.0_f32, 1.0];
        assert!(cosine_similarity(&a, &b).abs() < 1e-9);
    }

    #[test]
    fn symbolic_exact_match() {
        let score = symbolic_score("hello world", "hello world", &[], &[]);
        assert!(score > 0.9, "score={score}");
    }

    #[test]
    fn decay_recent_entry() {
        let entry = test_entry("recent");
        let s = decay_score(&entry);
        assert!(s > 0.5, "recent entry should have high decay score: {s}");
    }
}
