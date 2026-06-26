// label_eval.rs — Read-only label-quality harness for session.outcome labels.
//
// Ported from Sigil memory-server@66119d6
// `continuity_ops::evaluate_outcome_labels`, rewritten against this crate's
// flat `Connection` API and returning a typed report instead of raw JSON.
// Relicensed to this crate's MIT/Apache-2.0 by the sole copyright holder.
//
// Pure data plane — no LLM. The label PRODUCTION (an LLM inferring
// `session.outcome`) lives at the gateway/service layer; this harness only
// scores produced labels against held-out `session.outcome.review` (gold)
// events. It is the linchpin of the over-fit brake: per the design, no counter
// or `challenge_rate` signal is trustworthy until the labeler's agreement with
// gold is measured here and clears an acceptance bar.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::event_ledger::list_tachi_events;
use crate::memory_crud::MemoryError;
use crate::types::{OutcomeEvidenceBasis, SessionOutcomeKind, TachiEventQuery, TachiEventRecord};

const NOTE: &str = "Read-only label-quality harness. Reviews are session.outcome.review \
events matched by target_event_id (or session_id fallback); no labels or counters are mutated.";

fn payload_string<'a>(payload: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| payload.get(*key).and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn review_target(review: &TachiEventRecord) -> Option<&str> {
    payload_string(
        &review.payload,
        &["target_event_id", "event_id", "label_event_id"],
    )
}

fn gold_outcome(review: &TachiEventRecord) -> SessionOutcomeKind {
    SessionOutcomeKind::from_str_opt(payload_string(
        &review.payload,
        &["gold_outcome", "outcome", "expected_outcome", "label"],
    ))
}

fn gold_basis(review: &TachiEventRecord) -> OutcomeEvidenceBasis {
    OutcomeEvidenceBasis::from_str_opt(payload_string(
        &review.payload,
        &[
            "gold_evidence_basis",
            "evidence_basis",
            "expected_evidence_basis",
            "basis",
        ],
    ))
}

fn actual_outcome(event: &TachiEventRecord) -> SessionOutcomeKind {
    SessionOutcomeKind::from_str_opt(payload_string(
        &event.payload,
        &["outcome", "outcome_label", "label"],
    ))
}

fn actual_basis(event: &TachiEventRecord) -> OutcomeEvidenceBasis {
    OutcomeEvidenceBasis::from_str_opt(payload_string(
        &event.payload,
        &["evidence_basis", "basis", "label_basis", "adversarial_basis"],
    ))
}

/// Result of scoring produced `session.outcome` labels against held-out gold
/// reviews. All rates are `None` when `reviewed == 0` (no review could be
/// matched to a label).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct LabelEvalReport {
    /// Reviews successfully matched to a produced label event.
    pub reviewed: usize,
    /// Reviews whose target_event_id (and session_id fallback) found no label.
    pub missing_targets: usize,
    /// `outcome_matches / reviewed` — labeler got the outcome category right.
    pub outcome_accuracy: Option<f64>,
    /// `basis_matches / reviewed` — labeler got the evidence axis right.
    pub evidence_basis_accuracy: Option<f64>,
    /// `(outcome ∧ basis matches) / reviewed` — the full-agreement rate; the
    /// number the over-fit brake's trustworthiness hinges on.
    pub full_match_rate: Option<f64>,
}

impl LabelEvalReport {
    pub fn note() -> &'static str {
        NOTE
    }
}

/// Score produced `session.outcome` labels against held-out
/// `session.outcome.review` gold events. Read-only. `limit` bounds each
/// event-type scan (clamped to [1, 500]).
pub fn evaluate_outcome_labels(
    conn: &Connection,
    limit: usize,
) -> Result<LabelEvalReport, MemoryError> {
    let bound = limit.clamp(1, 500);
    let outcomes = list_tachi_events(
        conn,
        &TachiEventQuery {
            event_type: Some("session.outcome".to_string()),
            limit: bound,
            ..Default::default()
        },
    )?;
    let reviews = list_tachi_events(
        conn,
        &TachiEventQuery {
            event_type: Some("session.outcome.review".to_string()),
            limit: bound,
            ..Default::default()
        },
    )?;

    let mut reviewed = 0usize;
    let mut missing_targets = 0usize;
    let mut outcome_matches = 0usize;
    let mut basis_matches = 0usize;
    let mut full_matches = 0usize;

    for review in &reviews {
        let target_id = review_target(review).map(str::to_string);
        let matched = target_id
            .as_deref()
            .and_then(|id| outcomes.iter().find(|event| event.id == id))
            .or_else(|| {
                if !review.session_id.is_empty() {
                    outcomes.iter().find(|event| event.session_id == review.session_id)
                } else {
                    None
                }
            });

        let Some(label_event) = matched else {
            missing_targets += 1;
            continue;
        };

        let expected_outcome = gold_outcome(review);
        let expected_basis = gold_basis(review);
        let actual_out = actual_outcome(label_event);
        let actual_bas = actual_basis(label_event);

        // Unknown/Unverified gold labels are not counted as matches (they
        // encode "no real expectation"), mirroring the prototype.
        let outcome_match =
            expected_outcome != SessionOutcomeKind::Unknown && expected_outcome == actual_out;
        let basis_match =
            expected_basis != OutcomeEvidenceBasis::Unverified && expected_basis == actual_bas;

        reviewed += 1;
        if outcome_match {
            outcome_matches += 1;
        }
        if basis_match {
            basis_matches += 1;
        }
        if outcome_match && basis_match {
            full_matches += 1;
        }
    }

    let ratio = |count: usize| (reviewed > 0).then(|| count as f64 / reviewed as f64);

    Ok(LabelEvalReport {
        reviewed,
        missing_targets,
        outcome_accuracy: ratio(outcome_matches),
        evidence_basis_accuracy: ratio(basis_matches),
        full_match_rate: ratio(full_matches),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_ledger::insert_tachi_event;
    use crate::schema::init_schema;
    use crate::types::{AuthorityLevel, EffectScope};

    fn event(id: &str, event_type: &str, session: &str, payload: serde_json::Value) -> TachiEventRecord {
        TachiEventRecord {
            id: id.to_string(),
            source_repo: "romanbath".to_string(),
            adapter: "chat".to_string(),
            project: "default".to_string(),
            domain: "session".to_string(),
            session_id: session.to_string(),
            actor: "labeler".to_string(),
            event_type: event_type.to_string(),
            authority: AuthorityLevel::ReviewSignalOnly,
            effects: vec![EffectScope::None],
            projection_hints: vec![],
            payload,
            provenance: serde_json::json!({}),
            created_at: "2026-06-26T00:00:00.000Z".to_string(),
        }
    }

    #[test]
    fn full_match_when_label_agrees_with_gold() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        insert_tachi_event(
            &conn,
            &event(
                "label-1",
                "session.outcome",
                "sess-A",
                serde_json::json!({"outcome": "ai_corrected", "evidence_basis": "external_evidence"}),
            ),
        )
        .unwrap();
        insert_tachi_event(
            &conn,
            &event(
                "review-1",
                "session.outcome.review",
                "sess-A",
                serde_json::json!({
                    "target_event_id": "label-1",
                    "gold_outcome": "ai_corrected",
                    "gold_evidence_basis": "external_evidence",
                }),
            ),
        )
        .unwrap();

        let report = evaluate_outcome_labels(&conn, 64).unwrap();
        assert_eq!(report.reviewed, 1);
        assert_eq!(report.missing_targets, 0);
        assert_eq!(report.outcome_accuracy, Some(1.0));
        assert_eq!(report.evidence_basis_accuracy, Some(1.0));
        assert_eq!(report.full_match_rate, Some(1.0));
    }

    #[test]
    fn outcome_mismatch_lowers_accuracy() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        // Labeler said user_correct; gold says ai_corrected.
        insert_tachi_event(
            &conn,
            &event("label-2", "session.outcome", "sess-B",
                serde_json::json!({"outcome": "user_correct", "evidence_basis": "external_evidence"})),
        )
        .unwrap();
        insert_tachi_event(
            &conn,
            &event("review-2", "session.outcome.review", "sess-B",
                serde_json::json!({"target_event_id": "label-2", "gold_outcome": "ai_corrected", "gold_evidence_basis": "external_evidence"})),
        )
        .unwrap();

        let report = evaluate_outcome_labels(&conn, 64).unwrap();
        assert_eq!(report.reviewed, 1);
        assert_eq!(report.outcome_accuracy, Some(0.0), "outcome mismatch → 0 accuracy");
        assert_eq!(report.evidence_basis_accuracy, Some(1.0), "basis still matched");
        assert_eq!(report.full_match_rate, Some(0.0));
    }

    #[test]
    fn unmatched_review_is_missing_target_not_reviewed() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        // Review pointing at a label that was never produced.
        insert_tachi_event(
            &conn,
            &event("review-3", "session.outcome.review", "sess-C",
                serde_json::json!({"target_event_id": "does-not-exist", "gold_outcome": "ai_corrected"})),
        )
        .unwrap();

        let report = evaluate_outcome_labels(&conn, 64).unwrap();
        assert_eq!(report.reviewed, 0);
        assert_eq!(report.missing_targets, 1);
        assert!(report.full_match_rate.is_none(), "rates are None when nothing was reviewed");
    }

    #[test]
    fn review_matches_label_by_session_id_when_target_absent() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        insert_tachi_event(
            &conn,
            &event("label-4", "session.outcome", "sess-D",
                serde_json::json!({"outcome": "ai_corrected", "evidence_basis": "external_evidence"})),
        )
        .unwrap();
        // No target_event_id — must fall back to session_id matching.
        insert_tachi_event(
            &conn,
            &event("review-4", "session.outcome.review", "sess-D",
                serde_json::json!({"gold_outcome": "ai_corrected", "gold_evidence_basis": "external_evidence"})),
        )
        .unwrap();

        let report = evaluate_outcome_labels(&conn, 64).unwrap();
        assert_eq!(report.reviewed, 1, "session_id fallback should find the label");
        assert_eq!(report.full_match_rate, Some(1.0));
    }
}
