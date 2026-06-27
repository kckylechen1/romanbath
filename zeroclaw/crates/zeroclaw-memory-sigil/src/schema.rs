// schema.rs — Simplified SQLite schema for RomanBath chat memory.
//
// Tables: memories, memories_fts, memory_edges, access_history, embedding_cache.
// Removed: persons, location, valid_from/until, superseded_by, hub/sandbox/pack/vault/foundry/audit.

use rusqlite::Connection;
use std::path::Path;

use crate::memory_crud::MemoryError;

/// Current on-disk schema version.
///
/// Bump this by 1 for every schema change that cannot be expressed as a
/// `CREATE ... IF NOT EXISTS` in [`create_baseline`] — i.e. new columns or
/// constraint changes — and add a matching guarded step in [`init_schema`]'s
/// migration section. Existing databases are upgraded forward to this version
/// on open; fresh databases are created at it directly.
pub const SCHEMA_VERSION: i64 = 1;

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

    // Baseline (v1) tables. CREATE ... IF NOT EXISTS, so this is a harmless
    // no-op on databases that already have them — including pre-versioning
    // deployments that report `user_version = 0`.
    create_baseline(conn)?;

    // PRAGMA does not accept bind parameters; SCHEMA_VERSION is a trusted i64.
    conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
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
            tokenize = 'unicode61'
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn user_version(conn: &Connection) -> i64 {
        conn.query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap()
    }

    fn pragma_i64(conn: &Connection, name: &str) -> i64 {
        conn.query_row(&format!("PRAGMA {name}"), [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn init_schema_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        init_schema(&conn).unwrap();
    }

    #[test]
    fn can_insert_and_query() {
        let conn = Connection::open_in_memory().unwrap();
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
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        assert_eq!(user_version(&conn), SCHEMA_VERSION);
    }

    #[test]
    fn pragmas_apply_on_every_open() {
        // Regression: per-connection PRAGMAs must be set even when the schema
        // is already current (the old code skipped them for existing DBs).
        let conn = Connection::open_in_memory().unwrap();
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
        let conn = Connection::open_in_memory().unwrap();
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
}
