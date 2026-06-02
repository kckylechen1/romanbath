// schema.rs — Simplified SQLite schema for RomanBath chat memory.
//
// Tables: memories, memories_fts, memory_edges, access_history, embedding_cache.
// Removed: persons, location, valid_from/until, superseded_by, hub/sandbox/pack/vault/foundry/audit.

use rusqlite::Connection;

use crate::memory_crud::MemoryError;

/// Initialize the schema (idempotent).
pub fn init_schema(conn: &Connection) -> Result<(), MemoryError> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        PRAGMA cache_size = -8000;

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
}
