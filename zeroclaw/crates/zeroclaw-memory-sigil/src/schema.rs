// schema.rs — Simplified SQLite schema for RomanBath chat memory.
//
// Tables: memories, memories_fts, memory_edges, access_history, embedding_cache.
// Removed: persons, location, valid_from/until, superseded_by, hub/sandbox/pack/vault/foundry/audit.

use rusqlite::{Connection, OptionalExtension};
use std::path::Path;
use std::sync::{Once, OnceLock};

use crate::memory_crud::{MemoryError, fts_terms_from_json, insert_fts_row};

/// Current on-disk schema version.
///
/// Bump this by 1 for every schema change that cannot be expressed as a
/// `CREATE ... IF NOT EXISTS` in [`create_baseline`] — i.e. new columns or
/// constraint changes — and add a matching guarded step in [`init_schema`]'s
/// migration section. Existing databases are upgraded forward to this version
/// on open; fresh databases are created at it directly.
pub const SCHEMA_VERSION: i64 = 2;

static REGISTER_SIMPLE_TOKENIZER: Once = Once::new();
static SIMPLE_TOKENIZER_REGISTRATION_ERROR: OnceLock<String> = OnceLock::new();

/// Register libsimple's process-global SQLite auto-extension before opening
/// connections that need the `simple` FTS tokenizer.
pub(crate) fn ensure_simple_tokenizer() -> Result<(), MemoryError> {
    REGISTER_SIMPLE_TOKENIZER.call_once(|| {
        if let Err(err) = libsimple::enable_auto_extension() {
            let _ = SIMPLE_TOKENIZER_REGISTRATION_ERROR.set(format!(
                "failed to register libsimple simple tokenizer: {err}"
            ));
        }
    });

    if let Some(error) = SIMPLE_TOKENIZER_REGISTRATION_ERROR.get() {
        Err(MemoryError::Tokenizer(error.clone()))
    } else {
        Ok(())
    }
}

/// Open a sigil memory database, creating its parent directory and bringing
/// the schema up to date.
///
/// This is the **only** way production code should open a memory DB: it
/// guarantees the per-connection PRAGMAs are applied and any pending
/// migrations are run, on both fresh *and* existing files. (Opening an
/// existing file with a bare `Connection::open` skips both — which left
/// foreign keys off, `busy_timeout` at 0, and additive schema changes
/// silently unapplied on every database past its first run.)
pub fn open(path: &Path) -> Result<Connection, MemoryError> {
    ensure_simple_tokenizer()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(path)?;
    init_schema(&conn)?;
    Ok(conn)
}

/// Apply connection-scoped PRAGMAs and bring the schema up to
/// [`SCHEMA_VERSION`].
///
/// Idempotent and cheap to call on every connection: the PRAGMAs are always
/// (re)applied, while the schema DDL and migrations run only when the database
/// reports a version behind `SCHEMA_VERSION`.
pub fn init_schema(conn: &Connection) -> Result<(), MemoryError> {
    apply_pragmas(conn)?;

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version >= SCHEMA_VERSION {
        // Up to date — the PRAGMAs above are the only per-open work.
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;

    // v1→v2: FTS tokenizer rebuild (unicode61 → simple).
    let rebuild_fts = if version < 2 && memories_fts_uses_unicode61(&tx)? {
        tx.execute_batch("DROP TABLE memories_fts;")?;
        true
    } else {
        false
    };

    // Baseline tables. CREATE ... IF NOT EXISTS, so this is a harmless no-op on
    // databases that already have them — including pre-versioning deployments
    // that report `user_version = 0`.
    create_baseline(&tx)?;

    if rebuild_fts {
        rebuild_memories_fts(&tx)?;
    }

    // PRAGMA does not accept bind parameters; SCHEMA_VERSION is a trusted i64.
    tx.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
    tx.commit()?;
    Ok(())
}

/// Connection-scoped settings.
///
/// These do **not** persist in the database file (except WAL journal mode,
/// which is recorded in the header), so they must be reapplied on every
/// connection. The original bug skipped these for existing databases, leaving
/// foreign keys off and `busy_timeout` at 0 (instant `SQLITE_BUSY` under the
/// concurrent dreaming/recall writers).
fn apply_pragmas(conn: &Connection) -> Result<(), MemoryError> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        PRAGMA cache_size = -8000;
    "#,
    )?;
    Ok(())
}

/// Baseline schema (v1). All statements are `IF NOT EXISTS` so re-running on
/// an already-populated database is a no-op.
fn create_baseline(conn: &Connection) -> Result<(), MemoryError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS memories (
            id              TEXT PRIMARY KEY,
            path            TEXT NOT NULL DEFAULT '/',
            summary         TEXT NOT NULL DEFAULT '',
            text            TEXT NOT NULL DEFAULT '',
            importance      REAL NOT NULL DEFAULT 0.7,
            timestamp       TEXT NOT NULL,
            category        TEXT NOT NULL DEFAULT 'fact'
                            CHECK (category IN ('fact','decision','experience','preference','entity','other')),
            keywords        TEXT NOT NULL DEFAULT '[]',
            entities        TEXT NOT NULL DEFAULT '[]',
            source          TEXT NOT NULL DEFAULT 'manual'
                            CHECK (source IN ('manual','extraction','auto','chat')),
            scope           TEXT NOT NULL DEFAULT 'general'
                            CHECK (scope IN ('user','project','general')),
            archived        INTEGER NOT NULL DEFAULT 0,
            access_count    INTEGER NOT NULL DEFAULT 0,
            last_access     TEXT,
            retention_policy TEXT,
            metadata        TEXT NOT NULL DEFAULT '{}',
            recall_count    INTEGER NOT NULL DEFAULT 0,
            query_diversity INTEGER NOT NULL DEFAULT 0,
            tier            TEXT NOT NULL DEFAULT 'raw'
                            CHECK (tier IN ('raw','consolidated','pattern'))
        );

        CREATE INDEX IF NOT EXISTS idx_memories_path        ON memories(path);
        CREATE INDEX IF NOT EXISTS idx_memories_importance  ON memories(importance DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_timestamp   ON memories(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_archived    ON memories(archived);
        CREATE INDEX IF NOT EXISTS idx_memories_last_access ON memories(last_access DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_tier        ON memories(tier);
        CREATE INDEX IF NOT EXISTS idx_memories_recall      ON memories(recall_count DESC);

        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            id UNINDEXED,
            path,
            summary,
            text,
            keywords,
            entities,
            tokenize = 'simple'
        );

        CREATE TABLE IF NOT EXISTS memory_edges (
            source_id  TEXT NOT NULL,
            target_id  TEXT NOT NULL,
            relation   TEXT NOT NULL,
            weight     REAL NOT NULL DEFAULT 1.0,
            metadata   TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (source_id, target_id, relation)
        );
        CREATE INDEX IF NOT EXISTS idx_edges_source ON memory_edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);
        CREATE INDEX IF NOT EXISTS idx_edges_relation ON memory_edges(relation);

        CREATE TABLE IF NOT EXISTS access_history (
            memory_id   TEXT NOT NULL,
            accessed_at TEXT NOT NULL,
            query_hash  TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_access_hist_mem ON access_history(memory_id);
        CREATE INDEX IF NOT EXISTS idx_access_hist_time ON access_history(accessed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_access_hist_mem_time ON access_history(memory_id, accessed_at DESC);

        CREATE TABLE IF NOT EXISTS embedding_cache (
            id        TEXT PRIMARY KEY,
            embedding BLOB NOT NULL,
            model     TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT ''
        );
    "#,
    )?;
    Ok(())
}

fn memories_fts_uses_unicode61(conn: &Connection) -> Result<bool, MemoryError> {
    let sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='memories_fts'",
            [],
            |row| row.get(0),
        )
        .optional()?;

    Ok(sql
        .as_deref()
        .map(|ddl| ddl.to_ascii_lowercase().contains("unicode61"))
        .unwrap_or(false))
}

fn rebuild_memories_fts(conn: &Connection) -> Result<(), MemoryError> {
    let mut stmt =
        conn.prepare("SELECT id, path, summary, text, keywords, entities FROM memories")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    for (id, path, summary, text, keywords_json, entities_json) in rows {
        let keywords = fts_terms_from_json(&keywords_json);
        let entities = fts_terms_from_json(&entities_json);
        insert_fts_row(conn, &id, &path, &summary, &text, &keywords, &entities)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_crud::{now_utc_iso, search_fts, upsert};
    use crate::types::MemoryEntry;
    use rusqlite::Connection;
    use std::path::Path;

    const LEGACY_UNICODE61_FTS_DDL: &str = r#"
        CREATE VIRTUAL TABLE memories_fts USING fts5(
            id UNINDEXED,
            path,
            summary,
            text,
            keywords,
            entities,
            tokenize = 'unicode61'
        );
    "#;

    fn open_in_memory() -> Connection {
        ensure_simple_tokenizer().unwrap();
        Connection::open_in_memory().unwrap()
    }

    fn user_version(conn: &Connection) -> i64 {
        conn.query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap()
    }

    fn pragma_i64(conn: &Connection, name: &str) -> i64 {
        conn.query_row(&format!("PRAGMA {name}"), [], |r| r.get(0))
            .unwrap()
    }

    fn memories_fts_sql(conn: &Connection) -> String {
        conn.query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='memories_fts'",
            [],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn assert_fts_uses_simple(conn: &Connection) {
        let sql = memories_fts_sql(conn).to_ascii_lowercase();
        assert!(
            sql.contains("'simple'"),
            "memories_fts should use simple tokenizer: {sql}"
        );
        assert!(
            !sql.contains("unicode61"),
            "memories_fts should not keep unicode61 tokenizer: {sql}"
        );
    }

    fn chinese_memory(id: &str) -> MemoryEntry {
        MemoryEntry {
            id: id.to_string(),
            path: "/chat/test_char/memories/user".to_string(),
            summary: "work conflict".to_string(),
            text: "我昨天和老板吵架了，心情很差".to_string(),
            importance: 0.7,
            timestamp: now_utc_iso(),
            category: "fact".to_string(),
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
        }
    }

    fn assert_chinese_hit(conn: &Connection, id: &str) {
        let results = search_fts(conn, "老板", 10, None).unwrap();
        let score = results
            .get(id)
            .copied()
            .expect("Chinese query should hit the migrated memory");
        assert!(score.is_finite(), "FTS score should be finite: {score}");
    }

    fn create_legacy_unicode61_db(path: &Path) -> String {
        let id = "legacy-cjk".to_string();
        {
            let mut conn = open(path).unwrap();
            upsert(&mut conn, &chinese_memory(&id)).unwrap();
            conn.execute_batch("DROP TABLE memories_fts;").unwrap();
            conn.execute_batch(LEGACY_UNICODE61_FTS_DDL).unwrap();
            conn.execute(
                "INSERT INTO memories_fts(id, path, summary, text, keywords, entities)
                 SELECT id, path, summary, text, keywords, entities FROM memories",
                [],
            )
            .unwrap();
            conn.execute_batch("PRAGMA user_version = 1;").unwrap();
        }
        id
    }

    #[test]
    fn init_schema_idempotent() {
        let conn = open_in_memory();
        init_schema(&conn).unwrap();
        init_schema(&conn).unwrap();
    }

    #[test]
    fn can_insert_and_query() {
        let conn = open_in_memory();
        init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO memories (id, path, text, importance, timestamp)
             VALUES ('test-1', '/chat/char1/memories', 'hello', 0.7, '2026-05-30T00:00:00Z')",
            [],
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memories WHERE path LIKE '/chat/char1/%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn fresh_db_is_stamped_current() {
        let conn = open_in_memory();
        init_schema(&conn).unwrap();
        assert_eq!(user_version(&conn), SCHEMA_VERSION);
    }

    #[test]
    fn pragmas_apply_on_every_open() {
        // Regression: per-connection PRAGMAs must be set even when the schema
        // is already current (the old code skipped them for existing DBs).
        let conn = open_in_memory();
        init_schema(&conn).unwrap(); // stamps version → next call takes fast path
        init_schema(&conn).unwrap();
        assert_eq!(pragma_i64(&conn, "foreign_keys"), 1);
        assert_eq!(pragma_i64(&conn, "busy_timeout"), 5000);
    }

    #[test]
    fn existing_file_db_is_initialized_on_reopen() {
        // Regression for the real-world bug: a DB created on a previous run,
        // reopened via `schema::open`, must come back fully set up — foreign
        // keys on, busy_timeout set, tables present, version stamped.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("char_memory.db");

        // First run creates and stamps the DB.
        {
            let conn = open(&path).unwrap();
            assert_eq!(user_version(&conn), SCHEMA_VERSION);
        }

        // Second run ("existing file") must still apply PRAGMAs + have tables.
        let conn = open(&path).unwrap();
        assert_eq!(pragma_i64(&conn, "foreign_keys"), 1);
        assert_eq!(pragma_i64(&conn, "busy_timeout"), 5000);
        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='table' AND name IN
                   ('memories','memory_edges','access_history','embedding_cache')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 4);
    }

    #[test]
    fn unversioned_existing_db_is_upgraded_and_stamped() {
        // Simulate a pre-versioning deployment: a partial schema with
        // user_version still at 0. init_schema must reconcile it to the full
        // baseline and stamp the version forward.
        let conn = open_in_memory();
        conn.execute_batch(
            "CREATE TABLE memories (
                 id TEXT PRIMARY KEY, path TEXT, summary TEXT, text TEXT,
                 importance REAL, timestamp TEXT, category TEXT, keywords TEXT,
                 entities TEXT, source TEXT, scope TEXT, archived INTEGER,
                 access_count INTEGER, last_access TEXT, retention_policy TEXT,
                 metadata TEXT, recall_count INTEGER, query_diversity INTEGER,
                 tier TEXT
             );",
        )
        .unwrap();
        assert_eq!(user_version(&conn), 0);

        init_schema(&conn).unwrap();

        assert_eq!(user_version(&conn), SCHEMA_VERSION);
        // A table that the partial schema lacked must now exist.
        let has_edges: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='memory_edges'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_edges, 1);
    }

    #[test]
    fn v1_unicode61_db_migrates_and_recalls_chinese() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("char_memory.db");
        let id = create_legacy_unicode61_db(&path);

        let conn = open(&path).unwrap();

        assert_eq!(user_version(&conn), SCHEMA_VERSION);
        assert_fts_uses_simple(&conn);
        assert_chinese_hit(&conn, &id);
    }

    #[test]
    fn fresh_db_lands_at_v2_with_simple() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("char_memory.db");

        let conn = open(&path).unwrap();

        assert_eq!(user_version(&conn), SCHEMA_VERSION);
        assert_fts_uses_simple(&conn);
    }

    #[test]
    fn migrated_db_reopen_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("char_memory.db");
        let id = create_legacy_unicode61_db(&path);

        {
            let conn = open(&path).unwrap();
            assert_eq!(user_version(&conn), SCHEMA_VERSION);
            assert_chinese_hit(&conn, &id);
        }

        let conn = open(&path).unwrap();
        assert_eq!(user_version(&conn), SCHEMA_VERSION);
        assert_fts_uses_simple(&conn);
        assert_chinese_hit(&conn, &id);
    }
}
