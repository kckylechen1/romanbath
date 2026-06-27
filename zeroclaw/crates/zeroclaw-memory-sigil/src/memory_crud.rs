// memory_crud.rs — Core CRUD operations for RomanBath chat memory.
//
// Simplified from Sigil: no vector search, no foundry/agent_state/audit.
// Uses FTS5 for full-text search and path-based partitioning by character.

use chrono::Utc;
use rusqlite::{Connection, params, params_from_iter};
use std::collections::HashMap;

use crate::types::{MemoryCategory, MemoryEntry, MemoryScope, MemorySource};

// ─── Error Type ──────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum MemoryError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Invalid argument: {0}")]
    InvalidArg(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub fn now_utc_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn normalize_utc_iso(s: &str) -> Result<String, MemoryError> {
    // Best-effort normalization; if parsing fails, pass through.
    match s.parse::<chrono::DateTime<Utc>>() {
        Ok(dt) => Ok(dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        Err(_) => Ok(s.to_string()),
    }
}

/// FNV-1a 32-bit hash for query_diversity tracking.
fn fnv1a_hash(s: &str) -> String {
    let mut hash: u32 = 2_166_136_261;
    for byte in s.bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    format!("{hash:08x}")
}

/// Convert a SQLite row to a MemoryEntry.
fn row_to_entry(row: &rusqlite::Row<'_>) -> Result<MemoryEntry, rusqlite::Error> {
    Ok(MemoryEntry {
        id: row.get(0)?,
        path: row.get(1)?,
        summary: row.get(2)?,
        text: row.get(3)?,
        importance: row.get(4)?,
        timestamp: row.get(5)?,
        category: row.get(6)?,
        keywords: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or_default(),
        entities: serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or_default(),
        source: row.get(9)?,
        scope: row.get(10)?,
        archived: row.get::<_, i64>(11)? != 0,
        access_count: row.get(12)?,
        last_access: row.get(13)?,
        retention_policy: row.get(14)?,
        metadata: serde_json::from_str(&row.get::<_, String>(15)?).unwrap_or_default(),
        recall_count: row.get(16)?,
        query_diversity: row.get(17)?,
        tier: row.get(18)?,
    })
}

const ENTRY_COLUMNS: &str = r#"id,path,summary,text,importance,timestamp,category,keywords,entities,source,scope,archived,access_count,last_access,retention_policy,metadata,recall_count,query_diversity,tier"#;

// ─── UPSERT ──────────────────────────────────────────────────────────────────

/// Insert or update a memory entry.
pub fn upsert(conn: &mut Connection, entry: &MemoryEntry) -> Result<(), MemoryError> {
    if entry.id.trim().is_empty() {
        return Err(MemoryError::InvalidArg(
            "entry.id must be provided by caller".to_string(),
        ));
    }

    let category = MemoryCategory::normalize(&entry.category);
    let scope = MemoryScope::normalize(&entry.scope);
    let source = MemorySource::from_str_opt(Some(&entry.source)).as_str();
    let importance = entry.importance.clamp(0.0, 1.0);

    let clean_text = crate::noise::scrub_think_tags(&entry.text);
    let clean_summary = crate::noise::scrub_think_tags(&entry.summary);
    let timestamp_utc = normalize_utc_iso(&entry.timestamp)?;
    let last_access_utc = entry
        .last_access
        .as_deref()
        .map(normalize_utc_iso)
        .transpose()?;
    let _write_time_utc = now_utc_iso();

    let metadata_json = serde_json::to_string(&entry.metadata)?;
    let kws_json = serde_json::to_string(&entry.keywords)?;
    let ents_json = serde_json::to_string(&entry.entities)?;

    let tx = conn.transaction()?;

    tx.execute(
        &format!(
            r#"INSERT INTO memories
                  ({ENTRY_COLUMNS})
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
               ON CONFLICT(id) DO UPDATE SET
                  path         = excluded.path,
                  summary      = excluded.summary,
                  text         = excluded.text,
                  importance   = excluded.importance,
                  timestamp    = excluded.timestamp,
                  category     = excluded.category,
                  keywords     = excluded.keywords,
                  entities     = excluded.entities,
                  source       = excluded.source,
                  scope        = excluded.scope,
                  archived     = excluded.archived,
                  access_count = excluded.access_count,
                  last_access  = excluded.last_access,
                  retention_policy = excluded.retention_policy,
                  metadata     = excluded.metadata,
                  tier         = CASE WHEN memories.tier IN ('consolidated','pattern') THEN memories.tier ELSE excluded.tier END"#
        ),
        params![
            entry.id,
            &entry.path,
            &clean_summary,
            &clean_text,
            importance,
            timestamp_utc,
            category,
            kws_json,
            ents_json,
            source,
            scope,
            entry.archived as i64,
            entry.access_count,
            last_access_utc,
            entry.retention_policy,
            metadata_json,
            entry.recall_count,
            entry.query_diversity,
            &entry.tier,
        ],
    )?;

    // Sync FTS
    let kws = entry.keywords.join(" ");
    let ents = entry.entities.join(" ");
    tx.execute("DELETE FROM memories_fts WHERE id = ?1", params![entry.id])?;
    tx.execute(
        "INSERT INTO memories_fts(id, path, summary, text, keywords, entities)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            entry.id,
            &entry.path,
            &clean_summary,
            &clean_text,
            kws,
            ents
        ],
    )?;

    tx.commit()?;
    Ok(())
}

// ─── GET BY ID ───────────────────────────────────────────────────────────────

/// Fetch a single entry by ID.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<MemoryEntry>, MemoryError> {
    let sql = format!("SELECT {ENTRY_COLUMNS} FROM memories WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some(row_to_entry(row)?)),
        None => Ok(None),
    }
}

// ─── LIST BY PATH ────────────────────────────────────────────────────────────

/// Fetch entries under a path prefix.
pub fn list_by_path(
    conn: &Connection,
    path_prefix: &str,
    limit: usize,
) -> Result<Vec<MemoryEntry>, MemoryError> {
    let mut normalized = path_prefix.trim().to_string();
    if normalized.is_empty() {
        normalized = "/".to_string();
    }
    if !normalized.starts_with('/') {
        normalized = format!("/{normalized}");
    }
    if normalized.len() > 1 {
        normalized = normalized.trim_end_matches('/').to_string();
    }
    let like_prefix = if normalized == "/" {
        "/%".to_string()
    } else {
        format!("{normalized}/%")
    };

    let sql = format!(
        "SELECT {ENTRY_COLUMNS} FROM memories
         WHERE (path = ?1 OR path LIKE ?2) AND archived = 0
         ORDER BY timestamp DESC LIMIT ?3"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![normalized, like_prefix, limit as i64], row_to_entry)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ─── FTS SEARCH ──────────────────────────────────────────────────────────────

/// Full-text search returning (doc_id → normalized BM25 score).
pub fn search_fts(
    conn: &Connection,
    query: &str,
    limit: usize,
    path_prefix: Option<&str>,
) -> Result<HashMap<String, f64>, MemoryError> {
    let safe_query: String = query
        .chars()
        .filter(|c| {
            c.is_alphanumeric() || c.is_whitespace() || matches!(c, '"' | '\'' | '-' | '_' | '.')
        })
        .collect();

    if safe_query.trim().is_empty() {
        return Ok(HashMap::new());
    }

    let path_like = path_prefix.map(|p| format!("{p}%"));

    let sql = if path_like.is_some() {
        r#"SELECT memories_fts.id, -bm25(memories_fts) AS score
           FROM memories_fts
           JOIN memories m ON m.id = memories_fts.id
           WHERE memories_fts MATCH ?1
              AND m.archived = 0
              AND m.path LIKE ?3
           ORDER BY bm25(memories_fts)
           LIMIT ?2"#
    } else {
        r#"SELECT memories_fts.id, -bm25(memories_fts) AS score
           FROM memories_fts
           JOIN memories m ON m.id = memories_fts.id
           WHERE memories_fts MATCH ?1
              AND m.archived = 0
           ORDER BY bm25(memories_fts)
           LIMIT ?2"#
    };

    let mut stmt = conn.prepare(sql)?;

    let raw: Vec<(String, f64)> = if let Some(ref pl) = path_like {
        stmt.query_map(params![safe_query, limit as i64, pl], |row| {
            let id: String = row.get(0)?;
            let score: f64 = row.get(1)?;
            Ok((id, score))
        })?
        .filter_map(|r: Result<(String, f64), rusqlite::Error>| r.ok())
        .collect()
    } else {
        stmt.query_map(params![safe_query, limit as i64], |row| {
            let id: String = row.get(0)?;
            let score: f64 = row.get(1)?;
            Ok((id, score))
        })?
        .filter_map(|r: Result<(String, f64), rusqlite::Error>| r.ok())
        .collect()
    };

    let mut raw = raw;
    if raw.is_empty() {
        return Ok(HashMap::new());
    }

    let max_score = raw
        .iter()
        .map(|(_, s)| *s)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_score = if max_score <= 0.0 { 1.0 } else { max_score };

    Ok(raw
        .drain(..)
        .map(|(id, s)| (id, (s / max_score).clamp(0.0, 1.0)))
        .collect())
}

// ─── FETCH BY IDS ────────────────────────────────────────────────────────────

const IN_BATCH_SIZE: usize = 900;

/// Fetch multiple entries by IDs in batches.
pub fn fetch_by_ids(
    conn: &Connection,
    ids: &[String],
) -> Result<HashMap<String, MemoryEntry>, MemoryError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    let mut out = HashMap::new();
    for batch in ids.chunks(IN_BATCH_SIZE) {
        let placeholders = batch
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT {ENTRY_COLUMNS} FROM memories WHERE id IN ({}) AND archived = 0",
            placeholders
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(batch.iter()), row_to_entry)?;
        for r in rows {
            let entry = r?;
            out.insert(entry.id.clone(), entry);
        }
    }
    Ok(out)
}

// ─── RECORD ACCESS ───────────────────────────────────────────────────────────

/// Bump access_count, recall_count for FTS hits, and track query diversity.
/// Promotes tier raw → consolidated when recall_count ≥ 3, query_diversity ≥ 3,
/// and importance ≥ 0.8.
pub fn record_access(
    conn: &Connection,
    ids: &[String],
    fts_hits: &[String],
    query: Option<&str>,
) -> Result<(), MemoryError> {
    if ids.is_empty() {
        return Ok(());
    }

    let now = now_utc_iso();
    let query_hash = query.map(fnv1a_hash).unwrap_or_default();
    let fts_set: std::collections::HashSet<&str> = fts_hits.iter().map(String::as_str).collect();

    let tx = conn.unchecked_transaction()?;

    for id in ids {
        tx.execute(
            "UPDATE memories SET access_count = access_count + 1, last_access = ?1 WHERE id = ?2",
            params![&now, id],
        )?;
        tx.execute(
            "INSERT INTO access_history (memory_id, accessed_at, query_hash) VALUES (?1, ?2, ?3)",
            params![id, &now, &query_hash],
        )?;

        if fts_set.contains(id.as_str()) {
            tx.execute(
                "UPDATE memories SET recall_count = recall_count + 1 WHERE id = ?1",
                params![id],
            )?;
        }

        let diversity: i64 = tx
            .query_row(
                "SELECT COUNT(DISTINCT query_hash) FROM access_history
                 WHERE memory_id = ?1 AND query_hash != ''",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        tx.execute(
            "UPDATE memories SET query_diversity = ?1 WHERE id = ?2",
            params![diversity, id],
        )?;

        // Promotion: raw → consolidated
        tx.execute(
            "UPDATE memories SET tier = 'consolidated'
             WHERE id = ?1
               AND tier = 'raw'
               AND recall_count >= 3
               AND query_diversity >= 3
               AND importance >= 0.8",
            params![id],
        )?;
    }

    tx.commit()?;
    Ok(())
}

/// Max ids per `IN (...)` batch — stays under SQLite's 999 host-parameter limit.
/// Ported from the upstream prototype's `IN_BATCH_SIZE`.
const ACCESS_TIMES_IN_BATCH: usize = 900;

/// Default retention for [`prune_access_history`] — latest N accesses kept per
/// memory. Mirrors the upstream `GcConfig::access_history_keep_per_memory`.
pub const ACCESS_HISTORY_KEEP_PER_MEMORY: usize = 256;

/// Returns access ages in seconds-since-now per memory ID (feeds decay_score_actr).
///
/// Ported shape from the upstream prototype: one batched `WHERE memory_id IN (...)`
/// query per 900-id chunk instead of an N-prepare loop. Row errors now propagate
/// (`?`) rather than being silently dropped; unparseable timestamps are still
/// skipped. Two notes vs the previous loop version, both behavior-neutral for the
/// only consumer (`hybrid_score` → `decay_score_actr`):
/// - ids with no access history are omitted from the map (previously present
///   with an empty `Vec`); `decay_score_actr` falls back to plain `decay_score`
///   either way.
/// - ages within each memory's `Vec` are a multiset ordered by recency; order is
///   not semantically meaningful because `base_level_activation` sums them.
pub fn get_access_times(
    conn: &Connection,
    ids: &[String],
) -> Result<HashMap<String, Vec<f64>>, MemoryError> {
    let mut out: HashMap<String, Vec<f64>> = HashMap::new();
    if ids.is_empty() {
        return Ok(out);
    }
    let now = Utc::now();
    for batch in ids.chunks(ACCESS_TIMES_IN_BATCH) {
        let placeholders = batch.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT memory_id, accessed_at FROM access_history
             WHERE memory_id IN ({placeholders})
             ORDER BY accessed_at DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            params_from_iter(batch.iter().map(String::as_str)),
            |row| {
                let memory_id: String = row.get(0)?;
                let accessed_at: String = row.get(1)?;
                Ok((memory_id, accessed_at))
            },
        )?;
        for row in rows {
            let (memory_id, accessed_at) = row?;
            if let Ok(dt) = accessed_at.parse::<chrono::DateTime<Utc>>() {
                let age_secs = (now - dt).num_seconds().max(0) as f64;
                out.entry(memory_id).or_default().push(age_secs);
            }
        }
    }
    Ok(out)
}

/// Retain only the latest `keep_per_memory` access-history rows per memory,
/// deleting the rest. Returns the number of rows deleted.
///
/// Explicit/opt-in — nothing in the recall path calls this; it belongs in a
/// maintenance lane (wired into dreaming `run_light_sleep`). Without it,
/// `record_access` grows `access_history` without bound and `get_access_times`
/// re-reads all of it every recall. Mirrors upstream `stats_gc::gc_tables`.
pub fn prune_access_history(
    conn: &mut Connection,
    keep_per_memory: usize,
) -> Result<usize, MemoryError> {
    // 0 means "disabled — keep everything". ROW_NUMBER() starts at 1, so
    // rn > 0 would delete every row, which is never the intended behavior.
    if keep_per_memory == 0 {
        return Ok(0);
    }
    let tx = conn.transaction()?;
    // keep_per_memory is a trusted usize (digits only), safe to interpolate.
    let deleted = tx.execute(
        &format!(
            "DELETE FROM access_history
             WHERE rowid IN (
                 SELECT rowid FROM (
                     SELECT rowid,
                            ROW_NUMBER() OVER (
                                PARTITION BY memory_id
                                ORDER BY accessed_at DESC
                            ) AS rn
                     FROM access_history
                 ) ranked
                 WHERE rn > {keep_per_memory}
             )"
        ),
        [],
    )?;
    tx.commit()?;
    Ok(deleted)
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

/// Delete a memory entry by ID. Returns true if found and deleted.
pub fn delete(conn: &mut Connection, id: &str) -> Result<bool, MemoryError> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(MemoryError::InvalidArg("empty ID".to_string()));
    }

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM memories WHERE id = ?1", params![trimmed])?;
    let deleted = tx.changes() > 0;

    if deleted {
        tx.execute("DELETE FROM memories_fts WHERE id = ?1", params![trimmed])?;
        tx.execute(
            "DELETE FROM memory_edges WHERE source_id = ?1 OR target_id = ?1",
            params![trimmed],
        )?;
        tx.execute(
            "DELETE FROM access_history WHERE memory_id = ?1",
            params![trimmed],
        )?;
    }

    tx.commit()?;
    Ok(deleted)
}

// ─── GET ALL ─────────────────────────────────────────────────────────────────

/// Fetch the most recent entries.
pub fn get_all(conn: &Connection, limit: usize) -> Result<Vec<MemoryEntry>, MemoryError> {
    let sql = format!(
        "SELECT {ENTRY_COLUMNS} FROM memories WHERE archived = 0 ORDER BY timestamp DESC LIMIT ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit as i64], row_to_entry)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod crud_tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::schema::init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_upsert_and_search_fts() {
        let mut conn = setup();
        let entry = MemoryEntry {
            id: "test-1".to_string(),
            path: "/chat/test_char/memories/user".to_string(),
            summary: "dark mode preference".to_string(),
            text: "I prefer using dark mode for everything".to_string(),
            importance: 0.7,
            timestamp: now_utc_iso(),
            category: "preference".to_string(),
            keywords: vec![],
            entities: vec!["Alice".to_string()],
            source: "chat".to_string(),
            scope: "user".to_string(),
            archived: false,
            access_count: 0,
            last_access: None,
            retention_policy: None,
            metadata: serde_json::json!({}),
            recall_count: 0,
            query_diversity: 0,
            tier: "raw".to_string(),
        };
        upsert(&mut conn, &entry).unwrap();

        let got = get_by_id(&conn, "test-1").unwrap();
        assert!(got.is_some());

        let results = search_fts(&conn, "dark", 10, Some("/chat/test_char/memories")).unwrap();
        eprintln!("FTS with prefix results: {:?}", results);
        assert!(
            !results.is_empty(),
            "FTS search should find 'dark' in entry"
        );
    }

    #[test]
    fn get_access_times_batches_and_returns_ages() {
        let conn = setup();
        let iso = |secs_ago: i64| {
            Utc::now()
                .checked_sub_signed(chrono::Duration::seconds(secs_ago))
                .unwrap()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        };
        for secs_ago in [60, 3600, 86400] {
            conn.execute(
                "INSERT INTO access_history (memory_id, accessed_at, query_hash) VALUES (?1, ?2, '')",
                params!["m1", iso(secs_ago)],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO access_history (memory_id, accessed_at, query_hash) VALUES (?1, ?2, '')",
            params!["m2", iso(120)],
        )
        .unwrap();

        let times =
            get_access_times(&conn, &["m1".to_string(), "m2".to_string(), "m3".to_string()])
                .unwrap();
        assert_eq!(times["m1"].len(), 3, "m1 has 3 accesses");
        assert_eq!(times["m2"].len(), 1, "m2 has 1 access");
        assert!(
            !times.contains_key("m3"),
            "ids with no history are omitted (was present-with-empty in the loop version)"
        );
        let mut m1 = times["m1"].clone();
        m1.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert!(
            (m1[0] - 60.0).abs() < 5.0,
            "youngest age ~= 60s (got {})",
            m1[0]
        );
    }

    #[test]
    fn prune_access_history_keeps_latest_per_memory() {
        let mut conn = setup();
        let iso = |secs_ago: i64| {
            Utc::now()
                .checked_sub_signed(chrono::Duration::seconds(secs_ago))
                .unwrap()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        };
        for secs_ago in [10, 20, 30, 40, 50] {
            conn.execute(
                "INSERT INTO access_history (memory_id, accessed_at, query_hash) VALUES (?1, ?2, '')",
                params!["m1", iso(secs_ago)],
            )
            .unwrap();
        }
        for secs_ago in [15, 25] {
            conn.execute(
                "INSERT INTO access_history (memory_id, accessed_at, query_hash) VALUES (?1, ?2, '')",
                params!["m2", iso(secs_ago)],
            )
            .unwrap();
        }

        let deleted = prune_access_history(&mut conn, 2).unwrap();
        assert_eq!(deleted, 3, "m1 5->2 (3 deleted), m2 2->2 (0 deleted)");

        let count = |mid: &str| {
            conn.query_row(
                "SELECT COUNT(*) FROM access_history WHERE memory_id = ?1",
                params![mid],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
        };
        assert_eq!(count("m1"), 2);
        assert_eq!(count("m2"), 2);
    }
}
