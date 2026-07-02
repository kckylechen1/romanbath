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

fn stale_reference_datetime() -> chrono::DateTime<Utc> {
    chrono::NaiveDate::from_ymd_opt(1970, 1, 1)
        .expect("valid epoch date")
        .and_hms_opt(0, 0, 0)
        .expect("valid epoch time")
        .and_utc()
}

pub fn tier_half_life(tier: &str) -> f64 {
    match tier {
        "pattern" => 30_000.0,
        "consolidated" => 60.0,
        _ => HALF_LIFE_DAYS,
    }
}

fn tier_actr_d(tier: &str) -> f64 {
    match tier {
        "pattern" => 0.01,
        "consolidated" => 0.25,
        _ => 0.5,
    }
}

/// Normalize an f64 to [0, 1].
#[inline]
pub fn normalize(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

/// Cosine similarity between two equal-length f32 slices.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

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
        .unwrap_or_else(stale_reference_datetime);

    let age_days = (now - reference).num_seconds().max(0) as f64 / 86_400.0;
    let half_life = tier_half_life(&entry.tier);
    let recency = (-0.693 * age_days / half_life).exp();
    let frequency = (1.0 + entry.access_count as f64).log10();
    let importance_floor = entry.importance * 0.3;

    (recency * (1.0 + 0.2 * frequency)).max(importance_floor)
}

/// ACT-R Base-Level Activation: B_i = ln(Σ t_j^(-d)), t_j = access age in days.
fn base_level_activation(access_ages_secs: &[f64], d: f64) -> f64 {
    if access_ages_secs.is_empty() {
        return 0.0;
    }
    let sum: f64 = access_ages_secs
        .iter()
        .map(|t| (t / 86_400.0).max(1.0 / 24.0).powf(-d))
        .sum();
    if sum > 0.0 { sum.ln() } else { 0.0 }
}

pub fn decay_score_actr(entry: &MemoryEntry, access_ages: Option<&[f64]>) -> f64 {
    let d = tier_actr_d(&entry.tier);
    match access_ages {
        Some(ages) if !ages.is_empty() => {
            let bla = base_level_activation(ages, d);
            let normalized = (bla + 5.0) / 10.0;
            normalized
                .clamp(0.0, 1.0)
                .max(decay_score(entry))
                .max(entry.importance * 0.3)
        }
        _ => decay_score(entry),
    }
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
    pub use_rrf: bool,
}

impl Default for HybridWeights {
    fn default() -> Self {
        Self {
            semantic: 0.35,
            fts: 0.25,
            symbolic: 0.20,
            decay: 0.20,
            use_rrf: false,
        }
    }
}

fn rank_map(scores: &HashMap<String, f64>) -> HashMap<String, usize> {
    let mut ranked = scores.iter().collect::<Vec<_>>();
    ranked.sort_by(|a, b| b.1.total_cmp(a.1));
    ranked
        .into_iter()
        .enumerate()
        .map(|(idx, (id, _))| (id.clone(), idx + 1))
        .collect()
}

fn blend_rrf_with_vector_signal(
    id: &str,
    rrf_score: f64,
    vec_scores: &HashMap<String, f64>,
    vec_weight: f64,
) -> f64 {
    let Some(cosine) = vec_scores.get(id).copied().map(normalize) else {
        return rrf_score;
    };
    rrf_score * (1.0 + 0.15 * vec_weight.clamp(0.0, 1.0) * cosine)
}

fn retrieval_rrf_weight(weight: f64, total: f64) -> f64 {
    if !weight.is_finite() || weight <= 0.0 || total <= 0.0 {
        0.0
    } else {
        weight / total
    }
}

pub fn hybrid_score(
    entries: &HashMap<String, &MemoryEntry>,
    vec_scores: &HashMap<String, f64>,
    fts_scores: &HashMap<String, f64>,
    symbolic_scores: &HashMap<String, f64>,
    weights: &HybridWeights,
    access_times: &HashMap<String, Vec<f64>>,
) -> HashMap<String, HybridScore> {
    let all_ids: HashSet<&String> = vec_scores
        .keys()
        .chain(fts_scores.keys())
        .chain(symbolic_scores.keys())
        .collect();

    let mut out: HashMap<String, HybridScore> = HashMap::new();
    let vec_ranks = weights.use_rrf.then(|| rank_map(vec_scores));
    let fts_ranks = weights.use_rrf.then(|| rank_map(fts_scores));
    let symbolic_ranks = weights.use_rrf.then(|| rank_map(symbolic_scores));

    for id in all_ids {
        let vs = normalize(*vec_scores.get(id).unwrap_or(&0.0));
        let fs = normalize(*fts_scores.get(id).unwrap_or(&0.0));
        let ss = normalize(*symbolic_scores.get(id).unwrap_or(&0.0));
        let ds = entries
            .get(id.as_str())
            .map(|e| {
                let ages = access_times.get(id).map(|v| v.as_slice());
                decay_score_actr(e, ages)
            })
            .unwrap_or(0.0);

        let final_score = if weights.use_rrf {
            let rrf_k = 60.0;
            let retrieval_weight_total =
                (weights.semantic + weights.fts + weights.symbolic).max(0.0);
            let vec_weight = retrieval_rrf_weight(weights.semantic, retrieval_weight_total);
            let fts_weight = retrieval_rrf_weight(weights.fts, retrieval_weight_total);
            let symbolic_weight = retrieval_rrf_weight(weights.symbolic, retrieval_weight_total);
            let vec_part = vec_ranks
                .as_ref()
                .and_then(|ranks| ranks.get(id))
                .map(|rank| vec_weight / (rrf_k + *rank as f64))
                .unwrap_or(0.0);
            let fts_part = fts_ranks
                .as_ref()
                .and_then(|ranks| ranks.get(id))
                .map(|rank| fts_weight / (rrf_k + *rank as f64))
                .unwrap_or(0.0);
            let symbolic_part = symbolic_ranks
                .as_ref()
                .and_then(|ranks| ranks.get(id))
                .map(|rank| symbolic_weight / (rrf_k + *rank as f64))
                .unwrap_or(0.0);
            let rrf_score = vec_part + fts_part + symbolic_part;
            let blended = blend_rrf_with_vector_signal(id, rrf_score, vec_scores, vec_weight);
            blended + weights.decay * ds / rrf_k
        } else {
            weights.semantic * vs + weights.fts * fs + weights.symbolic * ss + weights.decay * ds
        };

        out.insert(
            id.clone(),
            HybridScore {
                vector: vs,
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
    fn cosine_dimension_mismatch_scores_zero() {
        assert_eq!(cosine_similarity(&[1.0, 0.0], &[1.0, 0.0, 0.0]), 0.0);
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

    #[test]
    fn decay_unparsable_timestamps_rank_stale_not_fresh() {
        let mut stale = test_entry("stale");
        stale.timestamp = "not-a-date".to_string();
        stale.last_access = Some("also-not-a-date".to_string());
        stale.importance = 0.0;
        stale.access_count = 0;

        let mut fresh = test_entry("fresh");
        fresh.timestamp = Utc::now().to_rfc3339();
        fresh.last_access = None;
        fresh.importance = 0.0;
        fresh.access_count = 0;

        let stale_score = decay_score(&stale);
        let fresh_score = decay_score(&fresh);

        assert!(
            stale_score < 0.01,
            "unparsable timestamps should rank stale, got {stale_score}"
        );
        assert!(
            fresh_score > 0.9,
            "fresh valid timestamp should keep high recency, got {fresh_score}"
        );
        assert!(
            stale_score < fresh_score,
            "stale fallback should rank below fresh timestamp: stale={stale_score} fresh={fresh_score}"
        );
    }

    #[test]
    fn decay_importance_floor_survives_stale_fallback() {
        let mut entry = test_entry("important-stale");
        entry.timestamp = "not-a-date".to_string();
        entry.last_access = Some("also-not-a-date".to_string());
        entry.importance = 1.0;
        entry.access_count = 0;

        let score = decay_score(&entry);

        assert!(
            (score - 0.3).abs() <= 1e-9,
            "importance floor should survive stale fallback, got {score}"
        );
    }

    #[test]
    fn rrf_respects_channel_weights() {
        let a = test_entry("a");
        let b = test_entry("b");
        let entries = HashMap::from([("a".to_string(), &a), ("b".to_string(), &b)]);
        let vec_scores = HashMap::from([("a".to_string(), 0.9), ("b".to_string(), 0.8)]);
        let fts_scores = HashMap::from([("a".to_string(), 0.1), ("b".to_string(), 0.9)]);
        let symbolic_scores = HashMap::new();
        let access_times = HashMap::new();

        let vector_heavy = HybridWeights {
            semantic: 0.9,
            fts: 0.1,
            symbolic: 0.0,
            decay: 0.0,
            use_rrf: true,
        };
        let vector_ranked = hybrid_score(
            &entries,
            &vec_scores,
            &fts_scores,
            &symbolic_scores,
            &vector_heavy,
            &access_times,
        );
        assert!(
            vector_ranked["a"].final_score > vector_ranked["b"].final_score,
            "vector-heavy RRF should prefer vector rank: a={} b={}",
            vector_ranked["a"].final_score,
            vector_ranked["b"].final_score
        );

        let fts_heavy = HybridWeights {
            semantic: 0.1,
            fts: 0.9,
            symbolic: 0.0,
            decay: 0.0,
            use_rrf: true,
        };
        let fts_ranked = hybrid_score(
            &entries,
            &vec_scores,
            &fts_scores,
            &symbolic_scores,
            &fts_heavy,
            &access_times,
        );
        assert!(
            fts_ranked["b"].final_score > fts_ranked["a"].final_score,
            "fts-heavy RRF should prefer FTS rank: a={} b={}",
            fts_ranked["a"].final_score,
            fts_ranked["b"].final_score
        );
    }

    #[test]
    fn actr_access_history_boosts_frequently_accessed() {
        let mut entry = test_entry("old");
        entry.timestamp = (Utc::now() - chrono::Duration::days(60)).to_rfc3339();

        let never = decay_score_actr(&entry, None);
        let accessed_once_old = decay_score_actr(&entry, Some(&[60.0 * 86_400.0]));
        let accessed_recently = decay_score_actr(&entry, Some(&[3_600.0, 7_200.0]));

        assert!(
            accessed_once_old >= never,
            "old single access should not beat no-history baseline: old={accessed_once_old} never={never}"
        );
        assert!(
            accessed_recently > accessed_once_old,
            "recent accesses should beat old: recent={accessed_recently} old={accessed_once_old}"
        );
    }

    #[test]
    fn rrf_blends_vector_signal_without_penalizing_missing_vector() {
        let vec_scores = HashMap::from([("a".to_string(), 0.99)]);

        let with_vec = blend_rrf_with_vector_signal("a", 0.02, &vec_scores, 1.0);
        assert!(with_vec > 0.02, "blended should exceed base: {with_vec}");

        let missing = blend_rrf_with_vector_signal("x", 0.02, &vec_scores, 1.0);
        assert_eq!(missing, 0.02);
    }
}
