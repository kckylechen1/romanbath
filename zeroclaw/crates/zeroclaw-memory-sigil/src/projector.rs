// projector.rs — Idempotent event → memory projection for RomanBath.
//
// Ported from Sigil memory-server@66119d6 (AGPL-3.0) `continuity_ops.rs`,
// rewritten against this crate's flat `Connection` API (the prototype's
// `MemoryServer`/store/scope layer does not exist here) and scoped to the
// Pattern + Outcome projection families. Relicensed to this crate's
// MIT/Apache-2.0 by the sole copyright holder of both repositories.
//
// Idempotency is the load-bearing property: each projection memory records the
// set of `projected_event_ids` that produced it. Re-projecting the same event
// is a no-op (counters unchanged); a new event landing on the same projection
// key accumulates (seen++ / hit++ / miss++). Getting this wrong double-counts,
// which is exactly the over-fit fuel the design exists to prevent.
//
// INERT wiring: `project()` is explicit and opt-in. Nothing in the chat recall
// path calls it yet, and ordinary recall does not yet exclude projection paths
// (that scope isolation lands in Slice 3). So projecting today writes memories
// that nothing reads.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::event_ledger::list_tachi_events;
use crate::memory_crud::{fetch_by_ids, now_utc_iso, upsert, MemoryError};
use crate::types::{
    AuthorityLevel, MemoryEntry, ProjectionKind, TachiEventQuery, TachiEventRecord,
};

// ─── stable hashing (deterministic ids/paths) ──────────────────────────────
// Local FNV-1a 64-bit → 16 hex chars. Deterministic across processes (unlike
// std HashMap's RandomState), so a projection's memory id is stable for its
// key. The exact algorithm need not match the prototype — these ids are local
// to this DB, not shared across repos.
fn stable_hash(value: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &byte in value.as_bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn slug_segment(value: &str) -> String {
    let mut out = String::new();
    for ch in value.trim().chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else if ch == '_' || ch == '-' {
            ch
        } else {
            '-'
        };
        if mapped == '-' && out.ends_with('-') {
            continue;
        }
        out.push(mapped);
        if out.len() >= 48 {
            break;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "general".to_string()
    } else {
        out
    }
}

// ─── payload extraction ────────────────────────────────────────────────────

fn nested_payload(event: &TachiEventRecord) -> &serde_json::Value {
    event.payload.get("candidate").unwrap_or(&event.payload)
}

fn nested_metadata(value: &serde_json::Value) -> serde_json::Value {
    value
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}))
}

fn string_value<'a>(value: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

// ─── counters ──────────────────────────────────────────────────────────────

fn projected_event_ids(metadata: &serde_json::Value) -> Vec<String> {
    metadata
        .get("projected_event_ids")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn counter_i64(metadata: &serde_json::Value, key: &str) -> i64 {
    metadata
        .get("counters")
        .and_then(|value| value.get(key))
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default()
}

/// (seen, hit, miss) delta contributed by a first-time projection of `event`.
fn counter_delta(event_type: &str, projection: ProjectionKind) -> (i64, i64, i64) {
    let event_type = event_type.to_ascii_lowercase();
    if event_type.contains(".hit") || event_type.contains("callback_hit") {
        (1, 1, 0)
    } else if event_type.contains(".miss")
        || event_type.contains(".stale")
        || event_type.contains(".failed")
        || event_type.contains(".failure")
    {
        (1, 0, 1)
    } else if matches!(
        projection,
        ProjectionKind::Pattern | ProjectionKind::Bonding
    ) && (event_type.contains(".observed") || event_type.contains(".candidate"))
    {
        (1, 0, 0)
    } else {
        (0, 0, 0)
    }
}

// ─── projection shape (path / category / scope / id) ───────────────────────

fn projected_path_prefix(projection: ProjectionKind) -> &'static str {
    match projection {
        ProjectionKind::Pattern => "/user/patterns",
        ProjectionKind::Outcome => "/outcomes",
        // Slice 2 only materializes Pattern + Outcome; the rest are listed for
        // completeness so paths stay stable if later slices enable them.
        ProjectionKind::Timeline => "/timeline",
        ProjectionKind::Affect => "/user/affect",
        ProjectionKind::Bonding => "/user/patterns/bonding",
        ProjectionKind::WorldBook => "/lorebook",
        ProjectionKind::ProjectCycle => "/project-cycle",
        ProjectionKind::DomainProfile => "/domain-profile",
        ProjectionKind::EvidenceGate => "/evidence-gates",
    }
}

fn projection_category(projection: ProjectionKind) -> &'static str {
    match projection {
        ProjectionKind::Pattern | ProjectionKind::Bonding | ProjectionKind::Affect => "preference",
        ProjectionKind::Outcome | ProjectionKind::EvidenceGate => "decision",
        ProjectionKind::Timeline | ProjectionKind::ProjectCycle => "experience",
        ProjectionKind::WorldBook | ProjectionKind::DomainProfile => "entity",
    }
}

fn projection_scope(projection: ProjectionKind) -> &'static str {
    match projection {
        ProjectionKind::Pattern | ProjectionKind::Bonding | ProjectionKind::Affect => "user",
        _ => "project",
    }
}

fn projection_key(event: &TachiEventRecord, projection: ProjectionKind) -> String {
    let payload = nested_payload(event);
    let metadata = nested_metadata(payload);
    let explicit = string_value(
        payload,
        &[
            "projection_key",
            "pattern_key",
            "bonding_key",
            "key",
            "name",
            "title",
            "summary",
        ],
    )
    .or_else(|| {
        string_value(
            &metadata,
            &[
                "projection_key",
                "pattern_key",
                "bonding_key",
                "key",
                "name",
            ],
        )
    });
    explicit
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}:{}", projection.as_str(), event.id))
}

fn projection_memory_id(projection: ProjectionKind, key: &str) -> String {
    format!("projection-{}-{}", projection.as_str(), stable_hash(key))
}

fn projection_path(event: &TachiEventRecord, projection: ProjectionKind, key: &str) -> String {
    let domain = if event.domain.trim().is_empty() {
        event.project.as_str()
    } else {
        event.domain.as_str()
    };
    let domain = slug_segment(domain);
    let key_hash = stable_hash(key);
    let segment = key_hash.get(..12).unwrap_or(&key_hash);
    format!("{}/{}/{segment}", projected_path_prefix(projection), domain)
}

// ─── projection content ────────────────────────────────────────────────────

fn projected_summary(event: &TachiEventRecord, projection: ProjectionKind) -> String {
    let payload = nested_payload(event);
    string_value(payload, &["summary", "title", "state", "outcome", "label"])
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "{} projection from {}",
                projection.as_str(),
                event.event_type
            )
        })
}

fn projected_text(event: &TachiEventRecord, projection: ProjectionKind) -> String {
    let payload = nested_payload(event);
    let summary = projected_summary(event, projection);
    string_value(
        payload,
        &["text", "content", "body", "detail", "rationale", "reason"],
    )
    .map(str::to_string)
    .unwrap_or(summary)
}

fn projection_keywords(
    event: &TachiEventRecord,
    projection: ProjectionKind,
    key: &str,
) -> Vec<String> {
    let mut keywords = vec![
        "continuity".to_string(),
        projection.as_str().to_string(),
        event.event_type.clone(),
    ];
    if !event.domain.trim().is_empty() {
        keywords.push(event.domain.clone());
    }
    if !key.trim().is_empty() {
        keywords.push(slug_segment(key));
    }
    keywords.sort();
    keywords.dedup();
    keywords
}

fn projection_tier(
    existing: Option<&MemoryEntry>,
    projection: ProjectionKind,
    authority: AuthorityLevel,
    payload: &serde_json::Value,
    seen: i64,
    hit: i64,
) -> String {
    if existing
        .map(|entry| entry.tier.as_str() == "pattern")
        .unwrap_or(false)
    {
        return "pattern".to_string();
    }
    let explicit_promote = payload
        .get("promote")
        .or_else(|| payload.get("manual_promotion"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if matches!(projection, ProjectionKind::Pattern)
        && (authority.is_decision_eligible() || explicit_promote)
    {
        "pattern".to_string()
    } else if matches!(projection, ProjectionKind::Pattern) && seen >= 3 && hit > 0 {
        "consolidated".to_string()
    } else {
        existing
            .map(|entry| entry.tier.clone())
            .unwrap_or_else(|| "raw".to_string())
    }
}

fn projection_importance(projection: ProjectionKind, authority: AuthorityLevel) -> f64 {
    let base = match projection {
        ProjectionKind::Pattern | ProjectionKind::Bonding => 0.72,
        ProjectionKind::Outcome | ProjectionKind::EvidenceGate => 0.58,
        ProjectionKind::Timeline | ProjectionKind::ProjectCycle => 0.62,
        ProjectionKind::Affect => 0.5,
        ProjectionKind::WorldBook | ProjectionKind::DomainProfile => 0.72,
    };
    if authority.is_decision_eligible() {
        (base + 0.08_f64).min(0.9_f64)
    } else {
        base
    }
}

fn projection_retention(projection: ProjectionKind, authority: AuthorityLevel) -> Option<String> {
    if matches!(projection, ProjectionKind::Pattern | ProjectionKind::Bonding)
        && authority.is_decision_eligible()
    {
        Some("permanent".to_string())
    } else {
        Some("durable".to_string())
    }
}

// ─── counter merge (the idempotency crux) ──────────────────────────────────

fn projection_metadata(
    existing: Option<&MemoryEntry>,
    event: &TachiEventRecord,
    projection: ProjectionKind,
    key: &str,
) -> (serde_json::Value, bool) {
    let payload = nested_payload(event);
    let mut metadata = existing
        .and_then(|entry| entry.metadata.as_object().cloned())
        .unwrap_or_default();
    let mut ids = existing
        .map(|entry| projected_event_ids(&entry.metadata))
        .unwrap_or_default();
    let already_projected = ids.iter().any(|id| id == &event.id);
    if !already_projected {
        ids.push(event.id.clone());
    }

    let (seen_delta, hit_delta, miss_delta) = if already_projected {
        (0, 0, 0)
    } else {
        counter_delta(&event.event_type, projection)
    };
    let metadata_value = serde_json::Value::Object(metadata.clone());
    let seen = counter_i64(&metadata_value, "seen") + seen_delta;
    let hit = counter_i64(&metadata_value, "hit") + hit_delta;
    let miss = counter_i64(&metadata_value, "miss") + miss_delta;
    let confidence = if seen > 0 {
        Some(hit as f64 / seen as f64)
    } else {
        payload
            .get("confidence")
            .or_else(|| payload.get("score"))
            .and_then(serde_json::Value::as_f64)
            .map(|value| value.clamp(0.0, 1.0))
    };

    metadata.insert("projection_kind".to_string(), serde_json::json!(projection.as_str()));
    metadata.insert("projection_key".to_string(), serde_json::json!(key));
    metadata.insert("source_event_id".to_string(), serde_json::json!(event.id));
    metadata.insert("source_event_type".to_string(), serde_json::json!(event.event_type));
    metadata.insert("source_repo".to_string(), serde_json::json!(event.source_repo));
    metadata.insert("adapter".to_string(), serde_json::json!(event.adapter));
    metadata.insert("authority".to_string(), serde_json::json!(event.authority.as_str()));
    metadata.insert(
        "effects".to_string(),
        serde_json::json!(event
            .effects
            .iter()
            .map(|effect| effect.as_str())
            .collect::<Vec<_>>()),
    );
    metadata.insert("projected_event_ids".to_string(), serde_json::json!(ids));
    metadata.insert(
        "counters".to_string(),
        serde_json::json!({
            "seen": seen,
            "hit": hit,
            "miss": miss,
            "confidence": confidence,
            "last_seen": event.created_at,
        }),
    );

    (serde_json::Value::Object(metadata), already_projected)
}

fn build_projection_entry(
    existing: Option<MemoryEntry>,
    event: &TachiEventRecord,
    projection: ProjectionKind,
) -> (MemoryEntry, bool) {
    let key = projection_key(event, projection);
    let id = projection_memory_id(projection, &key);
    let path = projection_path(event, projection, &key);
    let payload = nested_payload(event);
    let (metadata, already_projected) =
        projection_metadata(existing.as_ref(), event, projection, &key);
    let tier = projection_tier(
        existing.as_ref(),
        projection,
        event.authority,
        payload,
        metadata
            .get("counters")
            .and_then(|c| c.get("seen"))
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0),
        metadata
            .get("counters")
            .and_then(|c| c.get("hit"))
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0),
    );
    let text = projected_text(event, projection);
    let summary = projected_summary(event, projection);
    let timestamp = if event.created_at.trim().is_empty() {
        now_utc_iso()
    } else {
        event.created_at.clone()
    };
    let entities = [event.actor.as_str(), event.project.as_str(), event.source_repo.as_str()]
        .into_iter()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();

    let mut entry = existing.unwrap_or_else(|| MemoryEntry {
        id: id.clone(),
        path: path.clone(),
        summary: summary.clone(),
        text: text.clone(),
        importance: projection_importance(projection, event.authority),
        timestamp: timestamp.clone(),
        category: projection_category(projection).to_string(),
        keywords: projection_keywords(event, projection, &key),
        entities: entities.clone(),
        source: "external:tachi_event_projection".to_string(),
        scope: projection_scope(projection).to_string(),
        archived: false,
        access_count: 0,
        last_access: None,
        retention_policy: projection_retention(projection, event.authority),
        metadata: serde_json::json!({}),
        recall_count: 0,
        query_diversity: 0,
        tier: tier.clone(),
    });
    entry.id = id;
    entry.path = path;
    entry.summary = summary;
    entry.text = text;
    entry.importance = projection_importance(projection, event.authority);
    entry.category = projection_category(projection).to_string();
    entry.keywords = projection_keywords(event, projection, &key);
    entry.entities = entities;
    entry.source = "external:tachi_event_projection".to_string();
    entry.scope = projection_scope(projection).to_string();
    entry.metadata = metadata;
    entry.retention_policy = projection_retention(projection, event.authority);
    entry.tier = tier;
    (entry, already_projected)
}

// ─── Slice-2-scoped event → projection mapping ─────────────────────────────

fn event_projections(event: &TachiEventRecord, allowed: &[ProjectionKind]) -> Vec<ProjectionKind> {
    let mut out: Vec<ProjectionKind> = event
        .projection_hints
        .iter()
        .copied()
        .filter(|p| allowed.contains(p))
        .collect();
    if out.is_empty() {
        let et = event.event_type.to_ascii_lowercase();
        let inferred = if et.contains("pattern")
            || et.contains(".candidate")
            || et.contains(".hit")
            || et.contains(".miss")
            || et.contains(".observed")
        {
            Some(ProjectionKind::Pattern)
        } else if et == "session.outcome" || et.contains("outcome") {
            Some(ProjectionKind::Outcome)
        } else {
            None
        };
        if let Some(p) = inferred {
            if allowed.contains(&p) {
                out.push(p);
            }
        }
    }
    out.sort_by_key(|p| *p as u8);
    out.dedup();
    out
}

// ─── public orchestrator ───────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectionReport {
    /// Events that produced at least one projection row.
    pub projected: usize,
    /// Projection rows that already held this event (idempotent no-op).
    pub already_projected: usize,
    /// Events with no inferable Pattern/Outcome projection.
    pub skipped: usize,
    /// Projection writes that failed.
    pub errors: usize,
}

impl ProjectionReport {
    pub fn mutated(&self) -> usize {
        self.projected.saturating_sub(self.already_projected)
    }
}

/// Idempotently materialize ledger events into Pattern / Outcome projection
/// memories. Pass an empty `allowed` slice for the Slice-2 default
/// (Pattern + Outcome). `dry_run` reports what would change without writing.
///
/// Explicit and opt-in: nothing in the chat path calls this yet.
pub fn project(
    conn: &mut Connection,
    query: &TachiEventQuery,
    allowed: &[ProjectionKind],
    dry_run: bool,
) -> Result<ProjectionReport, MemoryError> {
    let allow_set: Vec<ProjectionKind> = if allowed.is_empty() {
        vec![ProjectionKind::Pattern, ProjectionKind::Outcome]
    } else {
        allowed.to_vec()
    };

    let events = list_tachi_events(conn, query)?;
    let mut report = ProjectionReport::default();
    let mut produced_any = false;

    for event in events {
        let projections = event_projections(&event, &allow_set);
        if projections.is_empty() {
            report.skipped += 1;
            continue;
        }
        for projection in projections {
            let key = projection_key(&event, projection);
            let memory_id = projection_memory_id(projection, &key);
            // Borrow released here (returns owned) before the mutable upsert.
            let existing = fetch_by_ids(conn, &[memory_id])?
                .into_iter()
                .next()
                .map(|(_, entry)| entry);
            let (entry, already_projected) = build_projection_entry(existing, &event, projection);
            if !dry_run {
                if let Err(error) = upsert(conn, &entry) {
                    // An error here usually means a malformed payload; surface
                    // it in the report rather than aborting the whole batch.
                    let _ = error;
                    report.errors += 1;
                    continue;
                }
            }
            report.projected += 1;
            if already_projected {
                report.already_projected += 1;
            }
            produced_any = true;
        }
    }

    let _ = produced_any;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_ledger::insert_tachi_event;
    use crate::schema::init_schema;
    use crate::types::{AuthorityLevel, EffectScope};

    fn pattern_event(id: &str, key: &str, etype: &str) -> TachiEventRecord {
        TachiEventRecord {
            id: id.to_string(),
            source_repo: "romanbath".to_string(),
            adapter: "chat".to_string(),
            project: "default".to_string(),
            domain: "session".to_string(),
            session_id: "s1".to_string(),
            actor: "assistant".to_string(),
            event_type: etype.to_string(),
            authority: AuthorityLevel::ReviewSignalOnly,
            effects: vec![EffectScope::Recall],
            projection_hints: vec![ProjectionKind::Pattern],
            payload: serde_json::json!({
                "candidate": {
                    "projection_key": key,
                    "summary": format!("pattern {key}"),
                    "text": "the user keeps revising beliefs under new evidence",
                }
            }),
            provenance: serde_json::json!({}),
            created_at: "2026-06-25T00:00:00.000Z".to_string(),
        }
    }

    fn outcome_event(id: &str) -> TachiEventRecord {
        TachiEventRecord {
            id: id.to_string(),
            source_repo: "romanbath".to_string(),
            adapter: "chat".to_string(),
            project: "default".to_string(),
            domain: "session".to_string(),
            session_id: "s1".to_string(),
            actor: "labeler".to_string(),
            event_type: "session.outcome".to_string(),
            authority: AuthorityLevel::ReviewSignalOnly,
            effects: vec![EffectScope::None],
            projection_hints: vec![ProjectionKind::Outcome],
            payload: serde_json::json!({
                "outcome": "ai_corrected",
                "evidence_basis": "external_evidence",
                "summary": "AI corrected user on a checkable fact",
            }),
            provenance: serde_json::json!({}),
            created_at: "2026-06-25T00:00:00.000Z".to_string(),
        }
    }

    fn counter(entry: &MemoryEntry, key: &str) -> i64 {
        entry.metadata.get("counters").and_then(|c| c.get(key)).and_then(serde_json::Value::as_i64).unwrap_or(0)
    }

    fn get_by_id(conn: &Connection, id: &str) -> MemoryEntry {
        fetch_by_ids(conn, &[id.to_string()])
            .unwrap()
            .into_iter()
            .next()
            .map(|(_, entry)| entry)
            .expect("projected memory must exist")
    }

    #[test]
    fn projection_is_idempotent_and_accumulates() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        // First sighting of a pattern candidate → seen=1, hit=0.
        insert_tachi_event(&conn, &pattern_event("e1", "belief_revision", "pattern.candidate")).unwrap();
        let r1 = project(&mut conn, &TachiEventQuery { limit: 64, ..Default::default() }, &[], false).unwrap();
        assert_eq!(r1.projected, 1);
        assert_eq!(r1.already_projected, 0);
        assert_eq!(r1.mutated(), 1);

        let id = projection_memory_id(ProjectionKind::Pattern, "belief_revision");
        let m1 = get_by_id(&conn, &id);
        assert_eq!(counter(&m1, "seen"), 1, "first sighting → seen=1");
        assert_eq!(counter(&m1, "hit"), 0);
        assert!(m1.path.starts_with("/user/patterns/"));
        assert_eq!(m1.tier, "raw");

        // Re-projecting the SAME event id is a no-op: counters unchanged.
        let r2 = project(&mut conn, &TachiEventQuery { limit: 64, ..Default::default() }, &[], false).unwrap();
        assert_eq!(r2.projected, 1);
        assert_eq!(r2.already_projected, 1, "same event re-projected is idempotent");
        assert_eq!(r2.mutated(), 0, "no mutation on re-projection");
        let m2 = get_by_id(&conn, &id);
        assert_eq!(counter(&m2, "seen"), 1, "seen must NOT double-count");

        // A pattern.hit on the SAME key (different event id) accumulates.
        insert_tachi_event(&conn, &pattern_event("e2", "belief_revision", "pattern.hit")).unwrap();
        let r3 = project(&mut conn, &TachiEventQuery { limit: 64, ..Default::default() }, &[], false).unwrap();
        assert_eq!(r3.mutated(), 1);
        let m3 = get_by_id(&conn, &id);
        assert_eq!(counter(&m3, "seen"), 2, "new event on same key → seen=2");
        assert_eq!(counter(&m3, "hit"), 1, "pattern.hit → hit=1");
    }

    #[test]
    fn outcome_event_projects_to_outcomes_path() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let evt = outcome_event("o1");
        insert_tachi_event(&conn, &evt).unwrap();

        let report = project(&mut conn, &TachiEventQuery { limit: 64, ..Default::default() }, &[], false).unwrap();
        assert_eq!(report.projected, 1);

        // Derive the id the same way `project` does: explicit payload key
        // (here the `summary` field) wins over the `outcome:<id>` fallback.
        let key = projection_key(&evt, ProjectionKind::Outcome);
        let id = projection_memory_id(ProjectionKind::Outcome, &key);
        let m = get_by_id(&conn, &id);
        assert!(m.path.starts_with("/outcomes/"), "outcome lands under /outcomes");
        assert_eq!(m.category, "decision");
    }

    #[test]
    fn dry_run_writes_nothing() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        insert_tachi_event(&conn, &pattern_event("d1", "dry", "pattern.candidate")).unwrap();

        let report = project(&mut conn, &TachiEventQuery { limit: 64, ..Default::default() }, &[], true).unwrap();
        assert_eq!(report.projected, 1, "dry run still reports what would project");
        let id = projection_memory_id(ProjectionKind::Pattern, "dry");
        assert!(
            fetch_by_ids(&conn, &[id]).unwrap().is_empty(),
            "dry_run must not write any memory"
        );
    }
}
