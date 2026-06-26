// event_ledger.rs — Append-only continuity event ledger for RomanBath.
//
// Ported from Sigil memory-core@66119d6 (AGPL-3.0) `db/event_ledger.rs`,
// adapted to this crate's rusqlite 0.37 and `MemoryError` (defined in
// memory_crud.rs, not a separate error module). Relicensed to this crate's
// MIT/Apache-2.0 by the sole copyright holder of both repositories.
//
// INERT in this slice: the `tachi_events` table is created on schema init and
// insert / list / continuity-metrics all work, but nothing in the chat path
// writes events yet. This is the append-only substrate that pattern / timeline
// / bonding projections will later be derived from; ordinary recall never
// reads it. See docs/engineering/architecture/tachi-continuity-memory-architecture.md
// ("one ledger, many read models").

use std::collections::BTreeMap;

use rusqlite::{params, Connection};

use crate::memory_crud::MemoryError;
use crate::types::{
    AuthorityLevel, ContinuityMetrics, EffectScope, MetricCount, OutcomeEvidenceBasis,
    ProjectionKind, SessionOutcomeKind, SessionOutcomeMetrics, TachiEventQuery, TachiEventRecord,
};

fn trim_filter(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

fn event_limit(limit: usize) -> i64 {
    limit.clamp(1, 500) as i64
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |row| row.get::<_, i64>(0),
    )
    .is_ok()
}

fn event_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TachiEventRecord> {
    let authority_raw: String = row.get("authority")?;
    let effects_raw: String = row.get("effects")?;
    let hints_raw: String = row.get("projection_hints")?;
    let payload_raw: String = row.get("payload_json")?;
    let provenance_raw: String = row.get("provenance_json")?;

    let effect_names: Vec<String> = serde_json::from_str(&effects_raw).unwrap_or_default();
    let hint_names: Vec<String> = serde_json::from_str(&hints_raw).unwrap_or_default();
    let payload = serde_json::from_str(&payload_raw).unwrap_or_else(|_| serde_json::json!({}));
    let provenance =
        serde_json::from_str(&provenance_raw).unwrap_or_else(|_| serde_json::json!({}));

    Ok(TachiEventRecord {
        id: row.get("id")?,
        source_repo: row.get("source_repo")?,
        adapter: row.get("adapter")?,
        project: row.get("project")?,
        domain: row.get("domain")?,
        session_id: row.get("session_id")?,
        actor: row.get("actor")?,
        event_type: row.get("event_type")?,
        authority: AuthorityLevel::from_str_opt(Some(&authority_raw)),
        effects: effect_names
            .iter()
            .map(|value| EffectScope::from_str_opt(Some(value)))
            .collect(),
        projection_hints: hint_names
            .iter()
            .filter_map(|value| ProjectionKind::from_str_opt(Some(value)))
            .collect(),
        payload,
        provenance,
        created_at: row.get("created_at")?,
    })
}

pub fn insert_tachi_event(conn: &Connection, event: &TachiEventRecord) -> Result<(), MemoryError> {
    let effects = event
        .effects
        .iter()
        .map(|value| value.as_str())
        .collect::<Vec<_>>();
    let projection_hints = event
        .projection_hints
        .iter()
        .map(|value| value.as_str())
        .collect::<Vec<_>>();
    let effects_json = serde_json::to_string(&effects)?;
    let projection_hints_json = serde_json::to_string(&projection_hints)?;
    let payload_json = serde_json::to_string(&event.payload)?;
    let provenance_json = serde_json::to_string(&event.provenance)?;

    conn.execute(
        "INSERT INTO tachi_events (
            id, source_repo, adapter, project, domain, session_id, actor,
            event_type, authority, effects, projection_hints,
            payload_json, provenance_json, created_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            &event.id,
            &event.source_repo,
            &event.adapter,
            &event.project,
            &event.domain,
            &event.session_id,
            &event.actor,
            &event.event_type,
            event.authority.as_str(),
            effects_json,
            projection_hints_json,
            payload_json,
            provenance_json,
            &event.created_at,
        ],
    )?;
    Ok(())
}

pub fn list_tachi_events(
    conn: &Connection,
    query: &TachiEventQuery,
) -> Result<Vec<TachiEventRecord>, MemoryError> {
    let mut stmt = conn.prepare(
        "SELECT
            id, source_repo, adapter, project, domain, session_id, actor,
            event_type, authority, effects, projection_hints,
            payload_json, provenance_json, created_at
         FROM tachi_events
         WHERE (?1 IS NULL OR project = ?1)
           AND (?2 IS NULL OR domain = ?2)
           AND (?3 IS NULL OR event_type = ?3)
           AND (?4 IS NULL OR session_id = ?4)
           AND (?5 IS NULL OR source_repo = ?5)
           AND (?6 IS NULL OR adapter = ?6)
         ORDER BY created_at DESC, id DESC
         LIMIT ?7",
    )?;
    let rows = stmt.query_map(
        params![
            trim_filter(&query.project),
            trim_filter(&query.domain),
            trim_filter(&query.event_type),
            trim_filter(&query.session_id),
            trim_filter(&query.source_repo),
            trim_filter(&query.adapter),
            event_limit(query.limit),
        ],
        event_row,
    )?;

    let mut events = Vec::new();
    for row in rows {
        events.push(row?);
    }
    Ok(events)
}

fn payload_str<'a>(payload: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| payload.get(*key).and_then(|value| value.as_str()))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn metric_counts(map: BTreeMap<String, usize>) -> Vec<MetricCount> {
    map.into_iter()
        .map(|(label, count)| MetricCount { label, count })
        .collect()
}

pub fn continuity_metrics(
    conn: &Connection,
    window_event_limit: usize,
) -> Result<ContinuityMetrics, MemoryError> {
    let limit = window_event_limit.clamp(1, 500);
    let mut session_outcomes = SessionOutcomeMetrics {
        window_event_limit: limit,
        note: "read-only signal; not a verdict or routing gate".to_string(),
        ..SessionOutcomeMetrics::default()
    };

    if !table_exists(conn, "tachi_events") {
        return Ok(ContinuityMetrics { session_outcomes });
    }

    let query = TachiEventQuery {
        event_type: Some("session.outcome".to_string()),
        limit,
        ..TachiEventQuery::default()
    };
    let events = list_tachi_events(conn, &query)?;
    let mut labels = BTreeMap::<String, usize>::new();
    let mut basis_counts = BTreeMap::<String, usize>::new();

    for event in events {
        let outcome = SessionOutcomeKind::from_str_opt(payload_str(
            &event.payload,
            &["outcome", "outcome_label", "label"],
        ));
        let basis = OutcomeEvidenceBasis::from_str_opt(payload_str(
            &event.payload,
            &[
                "evidence_basis",
                "basis",
                "label_basis",
                "adversarial_basis",
            ],
        ));

        session_outcomes.outcome_events += 1;
        *labels.entry(outcome.as_str().to_string()).or_default() += 1;
        *basis_counts.entry(basis.as_str().to_string()).or_default() += 1;

        if outcome.is_challenge_rate_eligible() {
            session_outcomes.eligible_outcomes += 1;
        }
        if outcome == SessionOutcomeKind::AiCorrected {
            session_outcomes.ai_corrected += 1;
        }
    }

    session_outcomes.challenge_rate = (session_outcomes.eligible_outcomes > 0)
        .then(|| session_outcomes.ai_corrected as f64 / session_outcomes.eligible_outcomes as f64);
    session_outcomes.labels = metric_counts(labels);
    session_outcomes.evidence_basis = metric_counts(basis_counts);

    Ok(ContinuityMetrics { session_outcomes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_crud::now_utc_iso;
    use crate::schema::init_schema;

    fn event(id: &str, event_type: &str, payload: serde_json::Value) -> TachiEventRecord {
        TachiEventRecord {
            id: id.to_string(),
            source_repo: "romanbath".to_string(),
            adapter: "chat".to_string(),
            project: "default".to_string(),
            domain: "session".to_string(),
            session_id: "s1".to_string(),
            actor: "assistant".to_string(),
            event_type: event_type.to_string(),
            authority: AuthorityLevel::ReviewSignalOnly,
            effects: vec![EffectScope::Recall],
            projection_hints: vec![ProjectionKind::Outcome],
            payload,
            provenance: serde_json::json!({}),
            created_at: now_utc_iso(),
        }
    }

    #[test]
    fn ledger_round_trips_and_computes_challenge_rate() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        // Two eligible outcomes: one AiCorrected, one UserCorrect.
        insert_tachi_event(
            &conn,
            &event(
                "e1",
                "session.outcome",
                serde_json::json!({"outcome": "ai_corrected", "evidence_basis": "external_evidence"}),
            ),
        )
        .unwrap();
        insert_tachi_event(
            &conn,
            &event(
                "e2",
                "session.outcome",
                serde_json::json!({"outcome": "user_correct", "evidence_basis": "testimonial"}),
            ),
        )
        .unwrap();
        // An unknown outcome is excluded from the challenge-rate denominator.
        insert_tachi_event(
            &conn,
            &event("e3", "session.outcome", serde_json::json!({"outcome": "unknown"})),
        )
        .unwrap();

        let listed = list_tachi_events(
            &conn,
            &TachiEventQuery {
                limit: 10,
                ..TachiEventQuery::default()
            },
        )
        .unwrap();
        assert_eq!(listed.len(), 3, "all three events should be listed");
        assert_eq!(listed[0].id, "e3", "newest first (created_at DESC)");

        let metrics = continuity_metrics(&conn, 64).unwrap();
        let so = metrics.session_outcomes;
        assert_eq!(so.outcome_events, 3);
        assert_eq!(so.eligible_outcomes, 2, "unknown is not eligible");
        assert_eq!(so.ai_corrected, 1);
        assert_eq!(so.challenge_rate, Some(0.5), "1 ai_corrected / 2 eligible");
    }

    #[test]
    fn metrics_safe_when_table_absent() {
        // A bare in-memory db without init_schema has no tachi_events table;
        // continuity_metrics must degrade gracefully, not error.
        let conn = Connection::open_in_memory().unwrap();
        let metrics = continuity_metrics(&conn, 64).unwrap();
        assert_eq!(metrics.session_outcomes.outcome_events, 0);
        assert!(metrics.session_outcomes.challenge_rate.is_none());
    }
}
