//! SQLite-backed session persistence with FTS5 search.
//!
//! Stores sessions in `{workspace}/sessions/sessions.db` using WAL mode.
//! Provides full-text search via FTS5 and automatic TTL-based cleanup.
//! Designed as the default backend, replacing JSONL for new installations.

use crate::session_backend::{
    ConversationNode, SessionBackend, SessionContext, SessionMetadata, SessionQuery, SessionState,
};
use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use parking_lot::Mutex;
use rusqlite::{Connection, params};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use zeroclaw_api::model_provider::ChatMessage;

/// SQLite-backed session store with FTS5 and WAL mode.
pub struct SqliteSessionBackend {
    conn: Mutex<Connection>,
}

impl SqliteSessionBackend {
    /// Open or create the sessions database.
    pub fn new(workspace_dir: &Path) -> Result<Self> {
        let sessions_dir = workspace_dir.join("sessions");
        std::fs::create_dir_all(&sessions_dir).context("Failed to create sessions directory")?;
        let db_path = sessions_dir.join("sessions.db");

        let conn = Connection::open(&db_path)
            .with_context(|| format!("Failed to open session DB: {}", db_path.display()))?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;
             PRAGMA mmap_size = 4194304;",
        )?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_key TEXT NOT NULL,
                role        TEXT NOT NULL,
                content     TEXT NOT NULL,
                created_at  TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(session_key);
             CREATE INDEX IF NOT EXISTS idx_sessions_key_id ON sessions(session_key, id);

             CREATE TABLE IF NOT EXISTS session_metadata (
                session_key  TEXT PRIMARY KEY,
                created_at   TEXT NOT NULL,
                last_activity TEXT NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0,
                name         TEXT
             );

             CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
                session_key, content, content=sessions, content_rowid=id
             );

             CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
                INSERT INTO sessions_fts(rowid, session_key, content)
                VALUES (new.id, new.session_key, new.content);
             END;
             CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
                INSERT INTO sessions_fts(sessions_fts, rowid, session_key, content)
                VALUES ('delete', old.id, old.session_key, old.content);
             END;
             CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
                INSERT INTO sessions_fts(sessions_fts, rowid, session_key, content)
                VALUES ('delete', old.id, old.session_key, old.content);
                INSERT INTO sessions_fts(rowid, session_key, content)
                VALUES (new.id, new.session_key, new.content);
             END;",
        )
        .context("Failed to initialize session schema")?;

        // Migration: add name column to existing databases
        let has_name: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('session_metadata') WHERE name = 'name'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !has_name {
            let _ = conn.execute("ALTER TABLE session_metadata ADD COLUMN name TEXT", []);
        }

        // Migration: add state tracking columns
        let has_state: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('session_metadata') WHERE name = 'state'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !has_state {
            let _ = conn.execute(
                "ALTER TABLE session_metadata ADD COLUMN state TEXT NOT NULL DEFAULT 'idle'",
                [],
            );
            let _ = conn.execute("ALTER TABLE session_metadata ADD COLUMN turn_id TEXT", []);
            let _ = conn.execute(
                "ALTER TABLE session_metadata ADD COLUMN turn_started_at TEXT",
                [],
            );
        }

        // Migration: add agent_alias column for per-agent attribution
        let has_agent_alias: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('session_metadata') WHERE name = 'agent_alias'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !has_agent_alias {
            let _ = conn.execute(
                "ALTER TABLE session_metadata ADD COLUMN agent_alias TEXT",
                [],
            );
            let _ = conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_session_metadata_agent_alias \
                 ON session_metadata(agent_alias)",
                [],
            );
        }

        // Migration: structured routing columns. Each session metadata row
        // gets the channel ref (`<type>.<alias>` like `discord.clamps`),
        // the platform-side room/thread id, and the inbound sender id so
        // dashboard filters and audit queries don't have to re-parse the
        // `session_key` composition that orchestrator::conversation_history_key
        // builds.  All three are nullable for backfill compatibility.
        for (column, ddl) in [
            (
                "channel_id",
                "ALTER TABLE session_metadata ADD COLUMN channel_id TEXT",
            ),
            (
                "room_id",
                "ALTER TABLE session_metadata ADD COLUMN room_id TEXT",
            ),
            (
                "sender_id",
                "ALTER TABLE session_metadata ADD COLUMN sender_id TEXT",
            ),
        ] {
            let present: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('session_metadata') \
                     WHERE name = ?1",
                    params![column],
                    |row| row.get(0),
                )
                .unwrap_or(false);
            if !present {
                let _ = conn.execute(ddl, []);
            }
        }
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_session_metadata_channel_id \
             ON session_metadata(channel_id)",
            [],
        );
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_session_metadata_room_id \
             ON session_metadata(room_id)",
            [],
        );
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_session_metadata_sender_id \
             ON session_metadata(sender_id)",
            [],
        );

        // Migration: conversation-tree columns (companion branching model).
        // All nullable and additive — purely linear rows leave them NULL, so
        // `load()`'s `ORDER BY id ASC` stays byte-identical and every existing
        // channel/CLI/cron session is unaffected. See
        // `session_backend::ConversationNode`. The tree's identity is the
        // client-minted `msg_id` (the autoincrement `id` is kept only as the
        // FTS rowid and sibling tie-break).
        for (column, ddl) in [
            ("msg_id", "ALTER TABLE sessions ADD COLUMN msg_id TEXT"),
            (
                "parent_id",
                "ALTER TABLE sessions ADD COLUMN parent_id TEXT",
            ),
            (
                "author_id",
                "ALTER TABLE sessions ADD COLUMN author_id TEXT",
            ),
            (
                "node_status",
                "ALTER TABLE sessions ADD COLUMN node_status TEXT",
            ),
            (
                "node_meta",
                "ALTER TABLE sessions ADD COLUMN node_meta TEXT",
            ),
        ] {
            let present: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('sessions') WHERE name = ?1",
                    params![column],
                    |row| row.get(0),
                )
                .unwrap_or(false);
            if !present {
                let _ = conn.execute(ddl, []);
            }
        }
        // UNIQUE over (session_key, msg_id): SQLite treats NULLs as distinct, so
        // the many NULL-msg_id linear rows don't collide; real tree nodes can't
        // duplicate a client id within a session.
        let _ = conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_msgid \
             ON sessions(session_key, msg_id)",
            [],
        );
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_tree \
             ON sessions(session_key, parent_id)",
            [],
        );
        let has_active_leaf: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('session_metadata') WHERE name = 'active_leaf'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !has_active_leaf {
            let _ = conn.execute(
                "ALTER TABLE session_metadata ADD COLUMN active_leaf TEXT",
                [],
            );
        }

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Migrate JSONL session files into SQLite. Renames migrated files to `.jsonl.migrated`.
    pub fn migrate_from_jsonl(&self, workspace_dir: &Path) -> Result<usize> {
        let sessions_dir = workspace_dir.join("sessions");
        let entries = match std::fs::read_dir(&sessions_dir) {
            Ok(e) => e,
            Err(_) => return Ok(0),
        };

        let mut migrated = 0;
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let name = match entry.file_name().into_string() {
                Ok(n) => n,
                Err(_) => continue,
            };
            let Some(key) = name.strip_suffix(".jsonl") else {
                continue;
            };

            let path = entry.path();
            let file = match std::fs::File::open(&path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let reader = std::io::BufReader::new(file);
            let mut count = 0;
            for line in std::io::BufRead::lines(reader) {
                let Ok(line) = line else { continue };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(msg) = serde_json::from_str::<ChatMessage>(trimmed)
                    && self.append(key, &msg).is_ok()
                {
                    count += 1;
                }
            }

            if count > 0 {
                let migrated_path = path.with_extension("jsonl.migrated");
                let _ = std::fs::rename(&path, &migrated_path);
                migrated += 1;
            }
        }

        Ok(migrated)
    }
}

impl SessionBackend for SqliteSessionBackend {
    fn load(&self, session_key: &str) -> Vec<ChatMessage> {
        let conn = self.conn.lock();
        let mut stmt = match conn
            .prepare("SELECT role, content FROM sessions WHERE session_key = ?1 ORDER BY id ASC")
        {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map(params![session_key], |row| {
            Ok(ChatMessage {
                role: row.get(0)?,
                content: row.get(1)?,
            })
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        rows.filter_map(|r| r.ok()).collect()
    }

    fn load_with_timestamps(
        &self,
        session_key: &str,
    ) -> Vec<crate::session_backend::TimestampedMessage> {
        use crate::session_backend::TimestampedMessage;
        let conn = self.conn.lock();
        let mut stmt = match conn.prepare(
            "SELECT role, content, created_at FROM sessions WHERE session_key = ?1 ORDER BY id ASC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map(params![session_key], |row| {
            let role: String = row.get(0)?;
            let content: String = row.get(1)?;
            let created_at_raw: Option<String> = row.get(2).ok();
            let created_at = created_at_raw
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc));
            Ok(TimestampedMessage {
                message: ChatMessage { role, content },
                created_at,
            })
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        rows.filter_map(|r| r.ok()).collect()
    }

    fn append(&self, session_key: &str, message: &ChatMessage) -> std::io::Result<()> {
        let conn = self.conn.lock();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO sessions (session_key, role, content, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![session_key, message.role, message.content, now],
        )
        .map_err(std::io::Error::other)?;

        // Upsert metadata
        conn.execute(
            "INSERT INTO session_metadata (session_key, created_at, last_activity, message_count)
             VALUES (?1, ?2, ?3, 1)
             ON CONFLICT(session_key) DO UPDATE SET
                last_activity = excluded.last_activity,
                message_count = message_count + 1",
            params![session_key, now, now],
        )
        .map_err(std::io::Error::other)?;

        Ok(())
    }

    fn remove_last(&self, session_key: &str) -> std::io::Result<bool> {
        let conn = self.conn.lock();

        let last_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM sessions WHERE session_key = ?1 ORDER BY id DESC LIMIT 1",
                params![session_key],
                |row| row.get(0),
            )
            .ok();

        let Some(id) = last_id else {
            return Ok(false);
        };

        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])
            .map_err(std::io::Error::other)?;

        // Update metadata count
        conn.execute(
            "UPDATE session_metadata SET message_count = MAX(0, message_count - 1)
             WHERE session_key = ?1",
            params![session_key],
        )
        .map_err(std::io::Error::other)?;

        Ok(true)
    }

    /// Efficiently update the last message in-place (single UPDATE instead of
    /// DELETE + INSERT). Used for incremental persistence during streaming.
    fn update_last(&self, session_key: &str, message: &ChatMessage) -> std::io::Result<bool> {
        let conn = self.conn.lock();

        let last_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM sessions WHERE session_key = ?1 ORDER BY id DESC LIMIT 1",
                params![session_key],
                |row| row.get(0),
            )
            .ok();

        let Some(id) = last_id else {
            return Ok(false);
        };

        conn.execute(
            "UPDATE sessions SET role = ?1, content = ?2 WHERE id = ?3",
            params![message.role, message.content, id],
        )
        .map_err(std::io::Error::other)?;

        // FTS stays in sync: the `sessions_au` AFTER UPDATE trigger re-indexes
        // the row on every UPDATE (not just INSERT/DELETE). update_last is used
        // for transient streaming snapshots; the final content is correct both
        // in the sessions table (load()) and in the FTS index (search()).

        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE session_metadata SET last_activity = ?1 WHERE session_key = ?2",
            params![now, session_key],
        )
        .map_err(std::io::Error::other)?;

        Ok(true)
    }

    fn list_sessions(&self) -> Vec<String> {
        let conn = self.conn.lock();
        let mut stmt = match conn
            .prepare("SELECT session_key FROM session_metadata ORDER BY last_activity DESC")
        {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map([], |row| row.get(0)) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        rows.filter_map(|r| r.ok()).collect()
    }

    fn list_sessions_with_metadata(&self) -> Vec<SessionMetadata> {
        let conn = self.conn.lock();
        let mut stmt = match conn.prepare(
            "SELECT session_key, created_at, last_activity, message_count, name, agent_alias, channel_id, room_id, sender_id
             FROM session_metadata ORDER BY last_activity DESC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map([], |row| {
            let key: String = row.get(0)?;
            let created_str: String = row.get(1)?;
            let activity_str: String = row.get(2)?;
            let count: i64 = row.get(3)?;
            let name: Option<String> = row.get(4)?;
            let agent_alias: Option<String> = row.get(5)?;
            let channel_id: Option<String> = row.get(6)?;
            let room_id: Option<String> = row.get(7)?;
            let sender_id: Option<String> = row.get(8)?;

            let created = DateTime::parse_from_rfc3339(&created_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let activity = DateTime::parse_from_rfc3339(&activity_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());

            #[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
            Ok(SessionMetadata {
                key,
                name,
                created_at: created,
                last_activity: activity,
                message_count: count as usize,
                agent_alias,
                channel_id,
                room_id,
                sender_id,
            })
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        rows.filter_map(|r| r.ok()).collect()
    }

    fn cleanup_stale(&self, ttl_hours: u32) -> std::io::Result<usize> {
        let conn = self.conn.lock();
        let cutoff = (Utc::now() - Duration::hours(i64::from(ttl_hours))).to_rfc3339();

        // Find stale sessions
        let stale_keys: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT session_key FROM session_metadata WHERE last_activity < ?1")
                .map_err(std::io::Error::other)?;
            let rows = stmt
                .query_map(params![cutoff], |row| row.get(0))
                .map_err(std::io::Error::other)?;
            rows.filter_map(|r| r.ok()).collect()
        };

        let count = stale_keys.len();
        for key in &stale_keys {
            let _ = conn.execute("DELETE FROM sessions WHERE session_key = ?1", params![key]);
            let _ = conn.execute(
                "DELETE FROM session_metadata WHERE session_key = ?1",
                params![key],
            );
        }

        Ok(count)
    }

    fn clear_messages(&self, session_key: &str) -> std::io::Result<usize> {
        let conn = self.conn.lock();

        conn.execute(
            "DELETE FROM sessions WHERE session_key = ?1",
            params![session_key],
        )
        .map_err(std::io::Error::other)?;

        let count = conn.changes() as usize;

        if count > 0 {
            conn.execute(
                "UPDATE session_metadata SET message_count = 0, last_activity = ?1 WHERE session_key = ?2",
                params![Utc::now().to_rfc3339(), session_key],
            )
            .map_err(std::io::Error::other)?;
        }

        Ok(count)
    }

    fn delete_session(&self, session_key: &str) -> std::io::Result<bool> {
        let conn = self.conn.lock();

        // Check if session exists
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM session_metadata WHERE session_key = ?1",
                params![session_key],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !exists {
            return Ok(false);
        }

        // Delete messages (FTS5 trigger handles sessions_fts cleanup)
        conn.execute(
            "DELETE FROM sessions WHERE session_key = ?1",
            params![session_key],
        )
        .map_err(std::io::Error::other)?;

        // Delete metadata
        conn.execute(
            "DELETE FROM session_metadata WHERE session_key = ?1",
            params![session_key],
        )
        .map_err(std::io::Error::other)?;

        Ok(true)
    }

    fn set_session_name(&self, session_key: &str, name: &str) -> std::io::Result<()> {
        let conn = self.conn.lock();
        let name_val = if name.is_empty() { None } else { Some(name) };
        conn.execute(
            "UPDATE session_metadata SET name = ?1 WHERE session_key = ?2",
            params![name_val, session_key],
        )
        .map_err(std::io::Error::other)?;
        Ok(())
    }

    fn get_session_name(&self, session_key: &str) -> std::io::Result<Option<String>> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT name FROM session_metadata WHERE session_key = ?1",
            params![session_key],
            |row| row.get(0),
        )
        .map_err(std::io::Error::other)
    }

    fn get_session_metadata(&self, session_key: &str) -> Option<SessionMetadata> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT session_key, created_at, last_activity, message_count, name, agent_alias, channel_id, room_id, sender_id
             FROM session_metadata WHERE session_key = ?1",
            params![session_key],
            |row| {
                let key: String = row.get(0)?;
                let created_str: String = row.get(1)?;
                let activity_str: String = row.get(2)?;
                let count: i64 = row.get(3)?;
                let name: Option<String> = row.get(4)?;
                let agent_alias: Option<String> = row.get(5)?;
                let channel_id: Option<String> = row.get(6)?;
                let room_id: Option<String> = row.get(7)?;
                let sender_id: Option<String> = row.get(8)?;

                let created = DateTime::parse_from_rfc3339(&created_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());
                let activity = DateTime::parse_from_rfc3339(&activity_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());

                #[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
                Ok(SessionMetadata {
                    key,
                    name,
                    created_at: created,
                    last_activity: activity,
                    message_count: count as usize,
                    agent_alias,
                    channel_id,
                    room_id,
                    sender_id,
                })
            },
        )
        .ok()
    }

    fn set_session_state(
        &self,
        session_key: &str,
        state: &str,
        turn_id: Option<&str>,
    ) -> std::io::Result<()> {
        let conn = self.conn.lock();
        let now = Utc::now().to_rfc3339();
        let started_at = if state == "running" {
            Some(now.as_str())
        } else {
            None
        };
        conn.execute(
            "UPDATE session_metadata SET state = ?1, turn_id = ?2, turn_started_at = ?3
             WHERE session_key = ?4",
            params![state, turn_id, started_at, session_key],
        )
        .map_err(std::io::Error::other)?;
        Ok(())
    }

    fn get_session_state(&self, session_key: &str) -> std::io::Result<Option<SessionState>> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT state, turn_id, turn_started_at FROM session_metadata WHERE session_key = ?1",
            params![session_key],
            |row| {
                let state: String = row.get(0)?;
                let turn_id: Option<String> = row.get(1)?;
                let started_str: Option<String> = row.get(2)?;
                let turn_started_at = started_str.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&Utc))
                });
                Ok(SessionState {
                    state,
                    turn_id,
                    turn_started_at,
                })
            },
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(std::io::Error::other(other)),
        })
    }

    fn list_running_sessions(&self) -> Vec<SessionMetadata> {
        let conn = self.conn.lock();
        let mut stmt = match conn.prepare(
            "SELECT session_key, created_at, last_activity, message_count, name, agent_alias, channel_id, room_id, sender_id
             FROM session_metadata WHERE state = 'running' ORDER BY turn_started_at DESC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map([], |row| {
            let key: String = row.get(0)?;
            let created_str: String = row.get(1)?;
            let activity_str: String = row.get(2)?;
            let count: i64 = row.get(3)?;
            let name: Option<String> = row.get(4)?;
            let agent_alias: Option<String> = row.get(5)?;
            let channel_id: Option<String> = row.get(6)?;
            let room_id: Option<String> = row.get(7)?;
            let sender_id: Option<String> = row.get(8)?;
            let created = DateTime::parse_from_rfc3339(&created_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let activity = DateTime::parse_from_rfc3339(&activity_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            #[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
            Ok(SessionMetadata {
                key,
                name,
                created_at: created,
                last_activity: activity,
                message_count: count as usize,
                agent_alias,
                channel_id,
                room_id,
                sender_id,
            })
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        rows.filter_map(|r| r.ok()).collect()
    }

    fn list_stuck_sessions(&self, threshold_secs: u64) -> Vec<SessionMetadata> {
        let conn = self.conn.lock();
        #[allow(clippy::cast_possible_wrap)]
        let cutoff = (Utc::now() - chrono::Duration::seconds(threshold_secs as i64)).to_rfc3339();
        let mut stmt = match conn.prepare(
            "SELECT session_key, created_at, last_activity, message_count, name, agent_alias, channel_id, room_id, sender_id
             FROM session_metadata
             WHERE state = 'running' AND turn_started_at < ?1
             ORDER BY turn_started_at ASC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map(params![cutoff], |row| {
            let key: String = row.get(0)?;
            let created_str: String = row.get(1)?;
            let activity_str: String = row.get(2)?;
            let count: i64 = row.get(3)?;
            let name: Option<String> = row.get(4)?;
            let agent_alias: Option<String> = row.get(5)?;
            let channel_id: Option<String> = row.get(6)?;
            let room_id: Option<String> = row.get(7)?;
            let sender_id: Option<String> = row.get(8)?;
            let created = DateTime::parse_from_rfc3339(&created_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let activity = DateTime::parse_from_rfc3339(&activity_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            #[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
            Ok(SessionMetadata {
                key,
                name,
                created_at: created,
                last_activity: activity,
                message_count: count as usize,
                agent_alias,
                channel_id,
                room_id,
                sender_id,
            })
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        rows.filter_map(|r| r.ok()).collect()
    }

    fn search(&self, query: &SessionQuery) -> Vec<SessionMetadata> {
        let Some(keyword) = &query.keyword else {
            return self.list_sessions_with_metadata();
        };

        let conn = self.conn.lock();
        #[allow(clippy::cast_possible_wrap)]
        let limit = query.limit.unwrap_or(50) as i64;

        // FTS5 search
        let mut stmt = match conn.prepare(
            "SELECT DISTINCT f.session_key
             FROM sessions_fts f
             WHERE sessions_fts MATCH ?1
             LIMIT ?2",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        // Quote each word for FTS5
        let fts_query: String = keyword
            .split_whitespace()
            .map(|w| format!("\"{w}\""))
            .collect::<Vec<_>>()
            .join(" OR ");

        let keys: Vec<String> = match stmt.query_map(params![fts_query, limit], |row| row.get(0)) {
            Ok(r) => r.filter_map(|r| r.ok()).collect(),
            Err(_) => return Vec::new(),
        };

        // Look up metadata for matched sessions
        keys.iter()
            .filter_map(|key| {
                conn.query_row(
                    "SELECT created_at, last_activity, message_count, name, agent_alias, channel_id, room_id, sender_id FROM session_metadata WHERE session_key = ?1",
                    params![key],
                    |row| {
                        let created_str: String = row.get(0)?;
                        let activity_str: String = row.get(1)?;
                        let count: i64 = row.get(2)?;
                        let name: Option<String> = row.get(3)?;
                        let agent_alias: Option<String> = row.get(4)?;
                        let channel_id: Option<String> = row.get(5)?;
                        let room_id: Option<String> = row.get(6)?;
                        let sender_id: Option<String> = row.get(7)?;
                        Ok(SessionMetadata {
                            key: key.clone(),
                            name,
                            created_at: DateTime::parse_from_rfc3339(&created_str)
                                .map(|dt| dt.with_timezone(&Utc))
                                .unwrap_or_else(|_| Utc::now()),
                            last_activity: DateTime::parse_from_rfc3339(&activity_str)
                                .map(|dt| dt.with_timezone(&Utc))
                                .unwrap_or_else(|_| Utc::now()),
                            #[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
                            message_count: count as usize,
                            agent_alias,
                            channel_id,
                            room_id,
                            sender_id,
                        })
                    },
                )
                .ok()
            })
            .collect()
    }

    fn set_session_agent_alias(&self, session_key: &str, agent_alias: &str) -> std::io::Result<()> {
        let conn = self.conn.lock();
        let alias_val = if agent_alias.is_empty() {
            None
        } else {
            Some(agent_alias)
        };
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO session_metadata (session_key, created_at, last_activity, message_count, agent_alias)
             VALUES (?1, ?2, ?3, 0, ?4)
             ON CONFLICT(session_key) DO UPDATE SET agent_alias = excluded.agent_alias",
            params![session_key, now, now, alias_val],
        )
        .map_err(std::io::Error::other)?;
        Ok(())
    }

    fn get_session_agent_alias(&self, session_key: &str) -> std::io::Result<Option<String>> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT agent_alias FROM session_metadata WHERE session_key = ?1",
            params![session_key],
            |row| row.get(0),
        )
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(std::io::Error::other(other)),
        })
    }

    fn set_session_context(
        &self,
        session_key: &str,
        context: SessionContext<'_>,
    ) -> std::io::Result<()> {
        let conn = self.conn.lock();
        fn normalize(v: Option<&str>) -> Option<&str> {
            v.map(str::trim).filter(|s| !s.is_empty())
        }
        let channel_id = normalize(context.channel_id);
        let room_id = normalize(context.room_id);
        let sender_id = normalize(context.sender_id);
        let now = Utc::now().to_rfc3339();
        // Insert a metadata stub row when missing so the per-platform
        // fields land even before the first message append fires the
        // upsert path. The COALESCE clauses preserve any field a prior
        // append/set already stamped — channel-side updates only fill in
        // gaps, they don't overwrite earlier routing context.
        conn.execute(
            "INSERT INTO session_metadata
                (session_key, created_at, last_activity, message_count, channel_id, room_id, sender_id)
             VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)
             ON CONFLICT(session_key) DO UPDATE SET
                channel_id = COALESCE(excluded.channel_id, session_metadata.channel_id),
                room_id    = COALESCE(excluded.room_id,    session_metadata.room_id),
                sender_id  = COALESCE(excluded.sender_id,  session_metadata.sender_id)",
            params![session_key, now, now, channel_id, room_id, sender_id],
        )
        .map_err(std::io::Error::other)?;
        Ok(())
    }

    // ── Conversation-tree overrides (companion branching) ─────────────

    fn append_node(&self, session_key: &str, node: &ConversationNode) -> std::io::Result<()> {
        let conn = self.conn.lock();
        let now = node
            .created_at
            .map(|d| d.to_rfc3339())
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        let meta_str = node.meta.as_ref().map(std::string::ToString::to_string);
        conn.execute(
            "INSERT INTO sessions
                (session_key, role, content, created_at, msg_id, parent_id, author_id, node_status, node_meta)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                session_key, node.role, node.content, now, node.msg_id,
                node.parent_id, node.author_id, node.status, meta_str
            ],
        )
        .map_err(std::io::Error::other)?;
        conn.execute(
            "INSERT INTO session_metadata (session_key, created_at, last_activity, message_count)
             VALUES (?1, ?2, ?3, 1)
             ON CONFLICT(session_key) DO UPDATE SET
                last_activity = excluded.last_activity,
                message_count = message_count + 1",
            params![session_key, now, now],
        )
        .map_err(std::io::Error::other)?;
        Ok(())
    }

    fn update_node(&self, session_key: &str, node: &ConversationNode) -> std::io::Result<bool> {
        let conn = self.conn.lock();
        let meta_str = node.meta.as_ref().map(std::string::ToString::to_string);
        // Targets the specific node by msg_id (not the tail like update_last),
        // so streaming updates land on the right tree node. The UPDATE fires
        // sessions_au, keeping FTS in sync (same as update_last).
        conn.execute(
            "UPDATE sessions SET role = ?1, content = ?2, node_status = ?3, node_meta = ?4
             WHERE session_key = ?5 AND msg_id = ?6",
            params![
                node.role,
                node.content,
                node.status,
                meta_str,
                session_key,
                node.msg_id
            ],
        )
        .map_err(std::io::Error::other)?;
        let mut changed = conn.changes() > 0;
        // Legacy fallback: a purely-linear row has msg_id IS NULL, so the
        // msg_id match above never fires. load_tree() surfaces such rows as
        // `lin-{rowid}`; resolve back to the rowid and update by id. Attempted
        // ONLY on a real miss and ONLY against NULL-msg_id rows, so a genuine
        // client id literally equal to "lin-7" stays matched by the msg_id path
        // and is never shadowed by this fallback.
        if !changed && let Some(rowid) = parse_lin_rowid(&node.msg_id) {
            conn.execute(
                "UPDATE sessions SET role = ?1, content = ?2, node_status = ?3, node_meta = ?4
                 WHERE session_key = ?5 AND id = ?6 AND msg_id IS NULL",
                params![
                    node.role,
                    node.content,
                    node.status,
                    meta_str,
                    session_key,
                    rowid
                ],
            )
            .map_err(std::io::Error::other)?;
            changed = conn.changes() > 0;
        }
        if changed {
            let now = Utc::now().to_rfc3339();
            let _ = conn.execute(
                "UPDATE session_metadata SET last_activity = ?1 WHERE session_key = ?2",
                params![now, session_key],
            );
        }
        Ok(changed)
    }

    fn load_tree(&self, session_key: &str) -> Vec<ConversationNode> {
        let conn = self.conn.lock();
        let mut stmt = match conn.prepare(
            "SELECT id, role, content, created_at, msg_id, parent_id, author_id, node_status, node_meta
             FROM sessions WHERE session_key = ?1 ORDER BY id ASC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = match stmt.query_map(params![session_key], |row| {
            let id: i64 = row.get(0)?;
            let role: String = row.get(1)?;
            let content: String = row.get(2)?;
            let created_raw: Option<String> = row.get(3)?;
            let msg_id: Option<String> = row.get(4)?;
            let parent_id: Option<String> = row.get(5)?;
            let author_id: Option<String> = row.get(6)?;
            let status: Option<String> = row.get(7)?;
            let meta_raw: Option<String> = row.get(8)?;
            Ok((
                id,
                role,
                content,
                created_raw,
                msg_id,
                parent_id,
                author_id,
                status,
                meta_raw,
            ))
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        // Legacy purely-linear rows have NULL tree columns; synthesize a chain
        // (lin-{rowid}, parent = previous) so tree queries are coherent for
        // pre-tree sessions too.
        let mut prev_synth: Option<String> = None;
        let mut out = Vec::new();
        for r in rows.flatten() {
            let (
                id,
                role,
                content,
                created_raw,
                msg_id_opt,
                parent_opt,
                author_id,
                status,
                meta_raw,
            ) = r;
            let created_at = created_raw
                .as_deref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc));
            let (msg_id, parent_id) = match msg_id_opt {
                Some(mid) => (mid, parent_opt),
                None => (format!("lin-{id}"), prev_synth.clone()),
            };
            prev_synth = Some(msg_id.clone());
            let meta = meta_raw.and_then(|s| serde_json::from_str(&s).ok());
            out.push(ConversationNode {
                msg_id,
                parent_id,
                role,
                content,
                author_id,
                status,
                meta,
                created_at,
            });
        }
        out
    }

    fn load_active_path(&self, session_key: &str) -> Vec<ChatMessage> {
        let leaf = self.get_active_leaf(session_key);
        flatten_active_path(&self.load_tree(session_key), leaf.as_deref())
    }

    fn load_path(&self, session_key: &str, leaf_id: &str) -> Vec<ChatMessage> {
        flatten_active_path(&self.load_tree(session_key), Some(leaf_id))
    }

    fn get_active_leaf(&self, session_key: &str) -> Option<String> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT active_leaf FROM session_metadata WHERE session_key = ?1",
            params![session_key],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    }

    fn set_active_leaf(&self, session_key: &str, msg_id: &str) -> std::io::Result<()> {
        let conn = self.conn.lock();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO session_metadata (session_key, created_at, last_activity, message_count, active_leaf)
             VALUES (?1, ?2, ?3, 0, ?4)
             ON CONFLICT(session_key) DO UPDATE SET active_leaf = excluded.active_leaf",
            params![session_key, now, now, msg_id],
        )
        .map_err(std::io::Error::other)?;
        Ok(())
    }

    fn conversation_tip(&self, session_key: &str) -> Option<String> {
        let tree = self.load_tree(session_key);
        let by_id: HashMap<&str, &ConversationNode> =
            tree.iter().map(|n| (n.msg_id.as_str(), n)).collect();
        // Trust the stored active leaf ONLY if it still exists in the tree —
        // mirror flatten_active_path's read-side guard. A dangling active_leaf
        // (deleted node, client desync) must fall back to the deepest leaf, or
        // the next turn would attach under a dangling parent and orphan history.
        if let Some(leaf) = self.get_active_leaf(session_key)
            && by_id.contains_key(leaf.as_str())
        {
            return Some(leaf);
        }
        deepest_leaf(&tree, &by_id)
    }

    fn delete_subtree(&self, session_key: &str, msg_id: &str) -> std::io::Result<Vec<String>> {
        let tree = self.load_tree(session_key);
        let existing: HashSet<&str> = tree.iter().map(|n| n.msg_id.as_str()).collect();
        if !existing.contains(msg_id) {
            return Ok(Vec::new());
        }
        // BFS: the node plus every descendant.
        let mut removed = vec![msg_id.to_string()];
        let mut i = 0;
        while i < removed.len() {
            let cur = removed[i].clone();
            for n in &tree {
                if n.parent_id.as_deref() == Some(cur.as_str()) {
                    removed.push(n.msg_id.clone());
                }
            }
            i += 1;
        }
        {
            let conn = self.conn.lock();
            // Atomic: a crash between two DELETEs must not leave an orphaned
            // descendant (its parent row already gone) that then resurfaces as a
            // NEW root via deepest_leaf on reload. Wrap the whole subtree removal
            // + message_count fixup in one transaction — all-or-nothing. If BEGIN
            // somehow fails we fall through unwrapped (never worse than before).
            let in_tx = conn.execute_batch("BEGIN").is_ok();
            for id in &removed {
                let deleted = conn
                    .execute(
                        "DELETE FROM sessions WHERE session_key = ?1 AND msg_id = ?2",
                        params![session_key, id],
                    )
                    .unwrap_or(0);
                // Legacy fallback (mirror update_node): a NULL-msg_id linear row
                // is surfaced as `lin-{rowid}` and never matched by the msg_id
                // DELETE, so it would silently survive. Resolve back to the rowid
                // and delete by id — only on a real miss, only against NULL rows.
                if deleted == 0
                    && let Some(rowid) = parse_lin_rowid(id)
                {
                    let _ = conn.execute(
                        "DELETE FROM sessions WHERE session_key = ?1 AND id = ?2 AND msg_id IS NULL",
                        params![session_key, rowid],
                    );
                }
            }
            let cnt: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sessions WHERE session_key = ?1",
                    params![session_key],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let _ = conn.execute(
                "UPDATE session_metadata SET message_count = ?1 WHERE session_key = ?2",
                params![cnt, session_key],
            );
            if in_tx {
                let _ = conn.execute_batch("COMMIT");
            }
        }
        Ok(removed)
    }
}

/// Resolve a synthesized legacy id back to its sqlite rowid. load_tree()
/// surfaces purely-linear (NULL-msg_id) rows as `lin-{rowid}`; the write ops
/// (update_node/delete_subtree) match on msg_id, which never hits a NULL row, so
/// they need this fallback to act on legacy history. Strictly `^lin-(\d+)$` —
/// any non-digit suffix (or a real client id that merely starts with "lin-")
/// returns None so the msg_id path is never shadowed.
fn parse_lin_rowid(msg_id: &str) -> Option<i64> {
    let suffix = msg_id.strip_prefix("lin-")?;
    if suffix.is_empty() || !suffix.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    suffix.parse::<i64>().ok()
}

/// Flatten a conversation tree to the active root→leaf path as a message list
/// — the exact context that gets seeded into the model. Mirrors the frontend
/// `useMessageTree` rule: use the explicit active leaf if present, else descend
/// to the most-recently-created child at each step (the "deepest leaf").
fn flatten_active_path(nodes: &[ConversationNode], active_leaf: Option<&str>) -> Vec<ChatMessage> {
    if nodes.is_empty() {
        return Vec::new();
    }
    let by_id: HashMap<&str, &ConversationNode> =
        nodes.iter().map(|n| (n.msg_id.as_str(), n)).collect();

    let leaf_id: Option<String> = active_leaf
        .filter(|l| by_id.contains_key(*l))
        .map(std::string::ToString::to_string)
        .or_else(|| deepest_leaf(nodes, &by_id));

    let Some(mut cur) = leaf_id else {
        return Vec::new();
    };

    // pathToRoot with a cycle guard (defensive — a malformed parent chain must
    // not loop forever).
    let mut path: Vec<&ConversationNode> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    while let Some(node) = by_id.get(cur.as_str()) {
        if !seen.insert(cur.clone()) {
            break;
        }
        path.push(node);
        match &node.parent_id {
            Some(p) => cur = p.clone(),
            None => break,
        }
    }
    path.reverse();
    path.into_iter()
        .map(|n| ChatMessage {
            role: n.role.clone(),
            content: n.content.clone(),
        })
        .collect()
}

/// The leaf reached by starting at the most-recent root and descending to the
/// most-recently-created child each step. Input is ordered by rowid ASC, so the
/// LAST child/root in iteration order is the most recent (rowid is monotonic
/// with insertion).
fn deepest_leaf(
    nodes: &[ConversationNode],
    by_id: &HashMap<&str, &ConversationNode>,
) -> Option<String> {
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut roots: Vec<&str> = Vec::new();
    for n in nodes {
        match &n.parent_id {
            Some(p) if by_id.contains_key(p.as_str()) => {
                children
                    .entry(p.as_str())
                    .or_default()
                    .push(n.msg_id.as_str());
            }
            _ => roots.push(n.msg_id.as_str()),
        }
    }
    // No root means every node's parent is itself in the tree — a cycle (only
    // reachable via a malformed/hostile client; current ops can't create one
    // now that parent refs are validated). Degrade gracefully to the most
    // recent node by input order rather than returning None (which would make
    // flatten_active_path read the whole session as empty, permanently).
    let mut cur = match roots.last() {
        Some(r) => *r,
        None => return nodes.last().map(|n| n.msg_id.clone()),
    };
    loop {
        match children.get(cur).and_then(|c| c.last().copied()) {
            Some(child) => cur = child,
            None => return Some(cur.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn round_trip_sqlite() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend
            .append("user1", &ChatMessage::user("hello"))
            .unwrap();
        backend
            .append("user1", &ChatMessage::assistant("hi"))
            .unwrap();

        let msgs = backend.load("user1");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, "user");
        assert_eq!(msgs[1].role, "assistant");
    }

    #[test]
    fn remove_last_sqlite() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("u", &ChatMessage::user("a")).unwrap();
        backend.append("u", &ChatMessage::user("b")).unwrap();

        assert!(backend.remove_last("u").unwrap());
        let msgs = backend.load("u");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "a");
    }

    #[test]
    fn remove_last_empty_sqlite() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        assert!(!backend.remove_last("nonexistent").unwrap());
    }

    #[test]
    fn list_sessions_sqlite() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("a", &ChatMessage::user("hi")).unwrap();
        backend.append("b", &ChatMessage::user("hey")).unwrap();

        let sessions = backend.list_sessions();
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn metadata_tracks_counts() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("a")).unwrap();
        backend.append("s1", &ChatMessage::user("b")).unwrap();
        backend.append("s1", &ChatMessage::user("c")).unwrap();

        let meta = backend.list_sessions_with_metadata();
        assert_eq!(meta.len(), 1);
        assert_eq!(meta[0].message_count, 3);
    }

    #[test]
    fn fts5_search_finds_content() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend
            .append(
                "code_chat",
                &ChatMessage::user("How do I parse JSON in Rust?"),
            )
            .unwrap();
        backend
            .append("weather", &ChatMessage::user("What's the weather today?"))
            .unwrap();

        let results = backend.search(&SessionQuery {
            keyword: Some("Rust".into()),
            limit: Some(10),
        });
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].key, "code_chat");
    }

    #[test]
    fn fts5_update_trigger_syncs_index() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend
            .append("chat", &ChatMessage::user("hello world"))
            .unwrap();

        // Verify initial content is searchable
        let results = backend.search(&SessionQuery {
            keyword: Some("hello".into()),
            limit: Some(10),
        });
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].key, "chat");

        // Directly update the session content (simulates update_last behavior)
        {
            let conn = backend.conn.lock();
            conn.execute(
                "UPDATE sessions SET content = ?1 WHERE session_key = ?2",
                params!["goodbye world", "chat"],
            )
            .unwrap();
        }

        // Old keyword should no longer match
        let results = backend.search(&SessionQuery {
            keyword: Some("hello".into()),
            limit: Some(10),
        });
        assert!(results.is_empty());

        // New keyword should match after UPDATE trigger syncs FTS index
        let results = backend.search(&SessionQuery {
            keyword: Some("goodbye".into()),
            limit: Some(10),
        });
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].key, "chat");
    }

    #[test]
    fn cleanup_stale_removes_old_sessions() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        // Insert a session with old timestamp
        {
            let conn = backend.conn.lock();
            let old_time = (Utc::now() - Duration::hours(100)).to_rfc3339();
            conn.execute(
                "INSERT INTO sessions (session_key, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
                params!["old_session", "user", "ancient", old_time],
            ).unwrap();
            conn.execute(
                "INSERT INTO session_metadata (session_key, created_at, last_activity, message_count) VALUES (?1, ?2, ?3, 1)",
                params!["old_session", old_time, old_time],
            ).unwrap();
        }

        backend
            .append("new_session", &ChatMessage::user("fresh"))
            .unwrap();

        let cleaned = backend.cleanup_stale(48).unwrap(); // 48h TTL
        assert_eq!(cleaned, 1);

        let sessions = backend.list_sessions();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0], "new_session");
    }

    #[test]
    fn clear_messages_removes_rows_keeps_metadata() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("hello")).unwrap();
        backend.append("s1", &ChatMessage::assistant("hi")).unwrap();
        backend.set_session_name("s1", "My Session").unwrap();

        let cleared = backend.clear_messages("s1").unwrap();
        assert_eq!(cleared, 2);
        assert!(backend.load("s1").is_empty());
        // Session still exists in metadata with name preserved
        let meta = backend.list_sessions_with_metadata();
        assert_eq!(meta.len(), 1);
        assert_eq!(meta[0].message_count, 0);
        assert_eq!(meta[0].name.as_deref(), Some("My Session"));
    }

    #[test]
    fn clear_messages_empty_returns_zero() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        assert_eq!(backend.clear_messages("nonexistent").unwrap(), 0);
    }

    #[test]
    fn clear_messages_does_not_affect_other_sessions() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("hello")).unwrap();
        backend.append("s2", &ChatMessage::user("world")).unwrap();

        backend.clear_messages("s1").unwrap();
        assert!(backend.load("s1").is_empty());
        assert_eq!(backend.load("s2").len(), 1);
    }

    #[test]
    fn clear_messages_then_append_works() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("old")).unwrap();
        backend.clear_messages("s1").unwrap();
        backend.append("s1", &ChatMessage::user("new")).unwrap();

        let messages = backend.load("s1");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "new");
        // Metadata count should reflect the new message
        let meta = backend.list_sessions_with_metadata();
        assert_eq!(meta[0].message_count, 1);
    }

    #[test]
    fn delete_session_removes_all_data() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("hello")).unwrap();
        backend.append("s1", &ChatMessage::assistant("hi")).unwrap();
        backend.append("s2", &ChatMessage::user("other")).unwrap();

        assert!(backend.delete_session("s1").unwrap());
        assert!(backend.load("s1").is_empty());
        assert_eq!(backend.list_sessions().len(), 1);
        assert_eq!(backend.list_sessions()[0], "s2");
    }

    #[test]
    fn delete_session_returns_false_for_missing() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        assert!(!backend.delete_session("nonexistent").unwrap());
    }

    #[test]
    fn migrate_from_jsonl_imports_and_renames() {
        let tmp = TempDir::new().unwrap();
        let sessions_dir = tmp.path().join("sessions");
        std::fs::create_dir_all(&sessions_dir).unwrap();

        // Create a JSONL file
        let jsonl_path = sessions_dir.join("test_user.jsonl");
        std::fs::write(
            &jsonl_path,
            "{\"role\":\"user\",\"content\":\"hello\"}\n{\"role\":\"assistant\",\"content\":\"hi\"}\n",
        )
        .unwrap();

        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        let migrated = backend.migrate_from_jsonl(tmp.path()).unwrap();
        assert_eq!(migrated, 1);

        // JSONL should be renamed
        assert!(!jsonl_path.exists());
        assert!(sessions_dir.join("test_user.jsonl.migrated").exists());

        // Messages should be in SQLite
        let msgs = backend.load("test_user");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].content, "hello");
    }

    #[test]
    fn set_session_name_persists() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("hello")).unwrap();
        backend.set_session_name("s1", "My Session").unwrap();

        let meta = backend.list_sessions_with_metadata();
        assert_eq!(meta.len(), 1);
        assert_eq!(meta[0].name.as_deref(), Some("My Session"));
    }

    #[test]
    fn set_session_name_updates_existing() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("hello")).unwrap();
        backend.set_session_name("s1", "First").unwrap();
        backend.set_session_name("s1", "Second").unwrap();

        let meta = backend.list_sessions_with_metadata();
        assert_eq!(meta[0].name.as_deref(), Some("Second"));
    }

    #[test]
    fn sessions_without_name_return_none() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("hello")).unwrap();

        let meta = backend.list_sessions_with_metadata();
        assert_eq!(meta.len(), 1);
        assert!(meta[0].name.is_none());
    }

    // ── session state tests ─────────────────────────────────────────

    #[test]
    fn session_state_idle_to_running() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        backend.append("s1", &ChatMessage::user("hello")).unwrap();

        backend
            .set_session_state("s1", "running", Some("turn-1"))
            .unwrap();
        let state = backend.get_session_state("s1").unwrap().unwrap();
        assert_eq!(state.state, "running");
        assert_eq!(state.turn_id.as_deref(), Some("turn-1"));
        assert!(state.turn_started_at.is_some());
    }

    #[test]
    fn session_state_running_to_idle() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        backend.append("s1", &ChatMessage::user("hello")).unwrap();

        backend
            .set_session_state("s1", "running", Some("turn-1"))
            .unwrap();
        backend.set_session_state("s1", "idle", None).unwrap();

        let state = backend.get_session_state("s1").unwrap().unwrap();
        assert_eq!(state.state, "idle");
        assert!(state.turn_id.is_none());
        assert!(state.turn_started_at.is_none());
    }

    #[test]
    fn session_state_running_to_error() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        backend.append("s1", &ChatMessage::user("hello")).unwrap();

        backend
            .set_session_state("s1", "running", Some("turn-1"))
            .unwrap();
        backend
            .set_session_state("s1", "error", Some("turn-1"))
            .unwrap();

        let state = backend.get_session_state("s1").unwrap().unwrap();
        assert_eq!(state.state, "error");
        assert_eq!(state.turn_id.as_deref(), Some("turn-1"));
    }

    #[test]
    fn list_running_sessions_returns_running_only() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("a")).unwrap();
        backend.append("s2", &ChatMessage::user("b")).unwrap();
        backend.append("s3", &ChatMessage::user("c")).unwrap();

        backend
            .set_session_state("s1", "running", Some("t1"))
            .unwrap();
        backend
            .set_session_state("s2", "running", Some("t2"))
            .unwrap();
        // s3 stays idle (default)

        let running = backend.list_running_sessions();
        assert_eq!(running.len(), 2);
        let keys: Vec<&str> = running.iter().map(|m| m.key.as_str()).collect();
        assert!(keys.contains(&"s1"));
        assert!(keys.contains(&"s2"));
    }

    #[test]
    fn list_stuck_sessions_detects_old_running() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        backend.append("s1", &ChatMessage::user("a")).unwrap();

        // Manually set an old turn_started_at
        {
            let conn = backend.conn.lock();
            let old_time = (Utc::now() - Duration::seconds(600)).to_rfc3339();
            conn.execute(
                "UPDATE session_metadata SET state = 'running', turn_id = 'old', turn_started_at = ?1 WHERE session_key = 's1'",
                params![old_time],
            ).unwrap();
        }

        let stuck = backend.list_stuck_sessions(300); // 5 min threshold
        assert_eq!(stuck.len(), 1);
        assert_eq!(stuck[0].key, "s1");

        // Not stuck if threshold is longer
        let not_stuck = backend.list_stuck_sessions(900); // 15 min threshold
        assert_eq!(not_stuck.len(), 0);
    }

    #[test]
    fn get_session_state_nonexistent() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        let state = backend.get_session_state("nonexistent").unwrap();
        assert!(state.is_none());
    }

    #[test]
    fn session_state_migration_preserves_data() {
        let tmp = TempDir::new().unwrap();
        // Create backend (runs migration)
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        backend.append("s1", &ChatMessage::user("hello")).unwrap();

        // Re-open (migration should be idempotent)
        drop(backend);
        let backend2 = SqliteSessionBackend::new(tmp.path()).unwrap();
        let msgs = backend2.load("s1");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "hello");

        // State should default to idle
        let state = backend2.get_session_state("s1").unwrap().unwrap();
        assert_eq!(state.state, "idle");
    }

    #[test]
    fn empty_name_clears_to_none() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("hello")).unwrap();
        backend.set_session_name("s1", "Named").unwrap();
        backend.set_session_name("s1", "").unwrap();

        let meta = backend.list_sessions_with_metadata();
        assert!(meta[0].name.is_none());
    }

    // ── get_session_metadata tests ─────────────────────────────────

    #[test]
    fn get_session_metadata_returns_full_metadata() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("hello")).unwrap();
        backend.append("s1", &ChatMessage::assistant("hi")).unwrap();
        backend.set_session_name("s1", "My Chat").unwrap();

        let meta = backend.get_session_metadata("s1").unwrap();
        assert_eq!(meta.key, "s1");
        assert_eq!(meta.name.as_deref(), Some("My Chat"));
        assert_eq!(meta.message_count, 2);
    }

    #[test]
    fn get_session_metadata_returns_none_for_missing() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        assert!(backend.get_session_metadata("nonexistent").is_none());
    }

    #[test]
    fn agent_alias_roundtrips_through_metadata() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("hello")).unwrap();
        backend.set_session_agent_alias("s1", "scout").unwrap();

        let meta = backend.get_session_metadata("s1").unwrap();
        assert_eq!(meta.agent_alias.as_deref(), Some("scout"));

        let listed = backend.list_sessions_with_metadata();
        let row = listed.iter().find(|m| m.key == "s1").unwrap();
        assert_eq!(row.agent_alias.as_deref(), Some("scout"));

        // Standalone getter also works.
        let alias = backend.get_session_agent_alias("s1").unwrap();
        assert_eq!(alias.as_deref(), Some("scout"));
    }

    #[test]
    fn agent_alias_set_before_any_append_upserts_metadata() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        // No prior append — metadata row does not exist yet. UPSERT
        // path must still record the alias so the WS handshake can
        // attribute the session before the first user message lands.
        backend.set_session_agent_alias("s1", "scout").unwrap();

        let alias = backend.get_session_agent_alias("s1").unwrap();
        assert_eq!(alias.as_deref(), Some("scout"));
    }

    #[test]
    fn session_context_roundtrips_channel_room_sender() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("hello")).unwrap();
        backend
            .set_session_context(
                "s1",
                SessionContext {
                    channel_id: Some("discord.clamps"),
                    room_id: Some("1234567890"),
                    sender_id: Some("@user:matrix"),
                },
            )
            .unwrap();

        let meta = backend.get_session_metadata("s1").unwrap();
        assert_eq!(meta.channel_id.as_deref(), Some("discord.clamps"));
        assert_eq!(meta.room_id.as_deref(), Some("1234567890"));
        assert_eq!(meta.sender_id.as_deref(), Some("@user:matrix"));

        // Second call with partial context must NOT clear the columns
        // already filled in — set_session_context is additive.
        backend
            .set_session_context(
                "s1",
                SessionContext {
                    channel_id: None,
                    room_id: Some("1234567890"),
                    sender_id: None,
                },
            )
            .unwrap();
        let meta = backend.get_session_metadata("s1").unwrap();
        assert_eq!(meta.channel_id.as_deref(), Some("discord.clamps"));
        assert_eq!(meta.sender_id.as_deref(), Some("@user:matrix"));
    }

    #[test]
    fn session_context_creates_metadata_row_before_first_append() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend
            .set_session_context(
                "s1",
                SessionContext {
                    channel_id: Some("telegram.production"),
                    room_id: None,
                    sender_id: Some("@alice"),
                },
            )
            .unwrap();

        let meta = backend.get_session_metadata("s1").unwrap();
        assert_eq!(meta.channel_id.as_deref(), Some("telegram.production"));
        assert_eq!(meta.sender_id.as_deref(), Some("@alice"));
        assert!(meta.room_id.is_none());
    }

    // ── conversation-tree (companion branching) tests ───────────────

    fn node(msg_id: &str, parent: Option<&str>, role: &str, content: &str) -> ConversationNode {
        ConversationNode {
            msg_id: msg_id.into(),
            parent_id: parent.map(Into::into),
            role: role.into(),
            content: content.into(),
            author_id: None,
            status: None,
            meta: None,
            created_at: None,
        }
    }

    #[test]
    fn linear_load_byte_identical_after_tree_migration() {
        // The whole safety premise: adding tree columns must not change the
        // linear read path one byte.
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        backend.append("s", &ChatMessage::user("one")).unwrap();
        backend.append("s", &ChatMessage::assistant("two")).unwrap();

        let linear = backend.load("s");
        assert_eq!(linear.len(), 2);
        assert_eq!(linear[0].content, "one");
        assert_eq!(linear[1].content, "two");

        // A linear session has exactly one path; the tree view of it equals load().
        let path = backend.load_active_path("s");
        assert_eq!(
            path.iter().map(|m| m.content.clone()).collect::<Vec<_>>(),
            vec!["one".to_string(), "two".to_string()]
        );
        // load_tree synthesizes a coherent 2-node chain for the legacy rows.
        let tree = backend.load_tree("s");
        assert_eq!(tree.len(), 2);
        assert_eq!(tree[1].parent_id.as_deref(), Some(tree[0].msg_id.as_str()));
    }

    #[test]
    fn tree_active_path_follows_selected_leaf_and_defaults_to_deepest() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        // root user → two assistant swipes (siblings) → continue under swipe B.
        backend
            .append_node("c", &node("u1", None, "user", "hi"))
            .unwrap();
        backend
            .append_node("c", &node("aA", Some("u1"), "assistant", "reply A"))
            .unwrap();
        backend
            .append_node("c", &node("aB", Some("u1"), "assistant", "reply B"))
            .unwrap();
        backend
            .append_node("c", &node("u2", Some("aB"), "user", "go on"))
            .unwrap();

        // No active leaf set → deepest leaf = most-recent descendant = u2 under aB.
        let deepest = backend.load_active_path("c");
        assert_eq!(
            deepest
                .iter()
                .map(|m| m.content.clone())
                .collect::<Vec<_>>(),
            vec!["hi".to_string(), "reply B".to_string(), "go on".to_string()]
        );

        // Explicitly select swipe A → path is u1 → aA, ignoring the aB subtree.
        backend.set_active_leaf("c", "aA").unwrap();
        let selected = backend.load_active_path("c");
        assert_eq!(
            selected
                .iter()
                .map(|m| m.content.clone())
                .collect::<Vec<_>>(),
            vec!["hi".to_string(), "reply A".to_string()]
        );

        // load_path can fetch any leaf regardless of the active selection.
        let via_b = backend.load_path("c", "u2");
        assert_eq!(via_b.len(), 3);
    }

    #[test]
    fn update_node_targets_by_msg_id_and_syncs_fts() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        backend
            .append_node("c", &node("u1", None, "user", "question"))
            .unwrap();
        backend
            .append_node("c", &node("a1", Some("u1"), "assistant", "draft"))
            .unwrap();

        // Stream-finalize the assistant node by msg_id.
        let mut finalized = node("a1", Some("u1"), "assistant", "polished final answer");
        finalized.status = Some("complete".into());
        assert!(backend.update_node("c", &finalized).unwrap());
        assert!(
            !backend
                .update_node("c", &node("nope", None, "assistant", "x"))
                .unwrap()
        );

        let tree = backend.load_tree("c");
        let a1 = tree.iter().find(|n| n.msg_id == "a1").unwrap();
        assert_eq!(a1.content, "polished final answer");
        assert_eq!(a1.status.as_deref(), Some("complete"));

        // FTS reflects the update (the new word matches, the old does not):
        // the UPDATE fires sessions_au, re-indexing the row.
        let hit = backend.search(&SessionQuery {
            keyword: Some("polished".into()),
            limit: Some(10),
        });
        assert_eq!(hit.len(), 1);
        let stale = backend.search(&SessionQuery {
            keyword: Some("draft".into()),
            limit: Some(10),
        });
        assert!(stale.is_empty());
    }

    #[test]
    fn delete_subtree_removes_node_and_descendants_only() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        backend
            .append_node("c", &node("u1", None, "user", "hi"))
            .unwrap();
        backend
            .append_node("c", &node("aA", Some("u1"), "assistant", "A"))
            .unwrap();
        backend
            .append_node("c", &node("aB", Some("u1"), "assistant", "B"))
            .unwrap();
        backend
            .append_node("c", &node("u2", Some("aB"), "user", "under B"))
            .unwrap();

        // Delete swipe B's subtree (aB + u2); swipe A and the root survive.
        let removed = backend.delete_subtree("c", "aB").unwrap();
        assert_eq!(
            removed.iter().cloned().collect::<HashSet<_>>(),
            ["aB".to_string(), "u2".to_string()].into_iter().collect()
        );

        let surviving: HashSet<String> = backend
            .load_tree("c")
            .into_iter()
            .map(|n| n.msg_id)
            .collect();
        assert_eq!(
            surviving,
            ["u1".to_string(), "aA".to_string()].into_iter().collect()
        );

        // Deleting a non-existent node is a no-op.
        assert!(backend.delete_subtree("c", "ghost").unwrap().is_empty());
    }

    #[test]
    fn conversation_tip_ignores_dangling_active_leaf() {
        // The data-loss guard: a stale/dangling active_leaf (e.g. a deleted node
        // or client desync) must NOT be trusted as the attach point — it would
        // orphan history. conversation_tip falls back to the real deepest leaf,
        // and node_exists reports the dangling ref as absent.
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        backend
            .append_node("c", &node("u1", None, "user", "hi"))
            .unwrap();
        backend
            .append_node("c", &node("a1", Some("u1"), "assistant", "hello"))
            .unwrap();

        // Point active_leaf at a node that doesn't exist.
        backend.set_active_leaf("c", "ghost").unwrap();
        assert!(!backend.node_exists("c", "ghost"));
        // Tip ignores the dangling leaf and returns the real deepest leaf.
        assert_eq!(backend.conversation_tip("c").as_deref(), Some("a1"));
        // So a new turn still attaches to real history (no orphaning).
        backend
            .append_node(
                "c",
                &node(
                    "u2",
                    backend.conversation_tip("c").as_deref(),
                    "user",
                    "again",
                ),
            )
            .unwrap();
        let path = backend.load_active_path("c");
        assert_eq!(
            path.len(),
            3,
            "full history preserved despite the dangling leaf"
        );
    }

    #[test]
    fn deepest_leaf_degrades_gracefully_on_cycle() {
        // A poisoned tree (every node's parent in-tree → no root → a cycle) must
        // not read as a permanently-empty session. We can't create a cycle via
        // the validated ops, so construct one directly in the table.
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        {
            let conn = backend.conn.lock();
            let now = Utc::now().to_rfc3339();
            // a→b and b→a: both parents resolve in-tree, leaving zero roots.
            conn.execute(
                "INSERT INTO sessions (session_key, role, content, created_at, msg_id, parent_id) VALUES ('c','user','x',?1,'a','b')",
                params![now],
            ).unwrap();
            conn.execute(
                "INSERT INTO sessions (session_key, role, content, created_at, msg_id, parent_id) VALUES ('c','assistant','y',?1,'b','a')",
                params![now],
            ).unwrap();
        }
        // Degrades to the most-recent node rather than returning None/empty.
        assert!(backend.conversation_tip("c").is_some());
    }

    #[test]
    fn new_tree_turn_attaches_to_legacy_linear_tip_preserving_history() {
        // The migration hazard: a session created before the tree existed has
        // linear rows (NULL msg_id). A new tree turn must attach to that
        // chain's tip via conversation_tip, or load_active_path would orphan
        // the legacy history behind a second root and drop it on resume.
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        // Legacy linear history (the old append path).
        backend
            .append("c", &ChatMessage::user("legacy one"))
            .unwrap();
        backend
            .append("c", &ChatMessage::assistant("legacy two"))
            .unwrap();

        // New turn attaches at the resolved tip.
        let tip = backend.conversation_tip("c");
        assert!(tip.is_some(), "tip resolves to the legacy chain's tail");
        backend
            .append_node("c", &node("u_new", tip.as_deref(), "user", "new question"))
            .unwrap();
        backend
            .append_node(
                "c",
                &node("a_new", Some("u_new"), "assistant", "new answer"),
            )
            .unwrap();

        // Full history survives, in order — nothing orphaned.
        let path = backend.load_active_path("c");
        assert_eq!(
            path.iter().map(|m| m.content.clone()).collect::<Vec<_>>(),
            vec![
                "legacy one".to_string(),
                "legacy two".to_string(),
                "new question".to_string(),
                "new answer".to_string(),
            ]
        );
    }

    #[test]
    fn get_session_metadata_matches_list() {
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        backend.append("s1", &ChatMessage::user("a")).unwrap();
        backend.append("s1", &ChatMessage::user("b")).unwrap();
        backend.append("s2", &ChatMessage::user("c")).unwrap();

        let single = backend.get_session_metadata("s1").unwrap();
        let all = backend.list_sessions_with_metadata();
        let from_list = all.iter().find(|m| m.key == "s1").unwrap();

        assert_eq!(single.message_count, from_list.message_count);
        assert_eq!(single.name, from_list.name);
        assert_eq!(single.created_at, from_list.created_at);
        assert_eq!(single.last_activity, from_list.last_activity);
    }

    fn session_row_count(backend: &SqliteSessionBackend, session_key: &str) -> i64 {
        let conn = backend.conn.lock();
        conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE session_key = ?1",
            params![session_key],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn delete_subtree_removes_legacy_linear_rows() {
        // BI-2: legacy rows have msg_id IS NULL, so the msg_id-only DELETE never
        // matched them — delete_subtree returned a populated removed-list while
        // deleting NOTHING (false success). The rowid fallback must actually
        // delete the synthesized lin-* subtree.
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        // Build via the LINEAR append path -> every row has msg_id = NULL.
        backend.append("c", &ChatMessage::user("one")).unwrap();
        backend.append("c", &ChatMessage::assistant("two")).unwrap();
        backend.append("c", &ChatMessage::user("three")).unwrap();
        backend
            .append("c", &ChatMessage::assistant("four"))
            .unwrap();
        assert_eq!(session_row_count(&backend, "c"), 4);

        // load_tree synthesizes the lin-{rowid} ids + parent chain.
        let tree = backend.load_tree("c");
        assert_eq!(tree.len(), 4);
        assert!(
            parse_lin_rowid(&tree[1].msg_id).is_some(),
            "legacy ids surface as lin-*"
        );
        // Delete the 2nd (non-leaf) node's subtree: it + every descendant.
        let target = tree[1].msg_id.clone();
        let expected: HashSet<String> = tree[1..].iter().map(|n| n.msg_id.clone()).collect();

        let removed = backend.delete_subtree("c", &target).unwrap();
        assert_eq!(removed.into_iter().collect::<HashSet<_>>(), expected);
        // The actual rows are gone: count dropped by the 3-node subtree.
        assert_eq!(session_row_count(&backend, "c"), 1);
    }

    #[test]
    fn update_node_updates_legacy_linear_row() {
        // BI-2: update_node on a synthesized lin-* id must reach the NULL-msg_id
        // legacy row (via the rowid fallback) AND fire sessions_au so FTS stays
        // in sync.
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();
        backend
            .append("c", &ChatMessage::user("alpha question"))
            .unwrap();
        backend
            .append("c", &ChatMessage::assistant("beta draft"))
            .unwrap();

        let tree = backend.load_tree("c");
        let lin_id = tree[1].msg_id.clone();
        assert!(
            parse_lin_rowid(&lin_id).is_some(),
            "legacy row surfaces as lin-*"
        );
        let updated = node(
            &lin_id,
            tree[1].parent_id.as_deref(),
            "assistant",
            "gamma revised",
        );
        assert!(backend.update_node("c", &updated).unwrap());

        let tree2 = backend.load_tree("c");
        let n = tree2.iter().find(|n| n.msg_id == lin_id).unwrap();
        assert_eq!(n.content, "gamma revised");

        // FTS reflects the update: the new word matches, the replaced one does not.
        let hit = backend.search(&SessionQuery {
            keyword: Some("gamma".into()),
            limit: Some(10),
        });
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].key, "c");
        let stale = backend.search(&SessionQuery {
            keyword: Some("beta".into()),
            limit: Some(10),
        });
        assert!(stale.is_empty());
    }

    #[test]
    fn update_node_real_msgid_not_shadowed_by_lin_fallback() {
        // The ordering invariant: a REAL client msg_id literally equal to
        // "lin-7" must be matched by the msg_id path, never shadowed by the
        // rowid fallback onto a different NULL-msg_id row at rowid 7.
        let tmp = TempDir::new().unwrap();
        let backend = SqliteSessionBackend::new(tmp.path()).unwrap();

        // A real tree node whose literal msg_id IS the string "lin-7" (rowid 1).
        backend
            .append_node("c", &node("lin-7", None, "user", "real lin-7 content"))
            .unwrap();
        // Six linear (NULL-msg_id) rows -> the 6th lands at rowid 7.
        for i in 2..=6 {
            backend
                .append("c", &ChatMessage::user(format!("filler {i}")))
                .unwrap();
        }
        backend
            .append("c", &ChatMessage::user("untouched legacy seven"))
            .unwrap();
        // Confirm the rowid-7 row is the NULL legacy row we expect.
        {
            let conn = backend.conn.lock();
            let (mid, content): (Option<String>, String) = conn
                .query_row(
                    "SELECT msg_id, content FROM sessions WHERE id = 7",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert!(mid.is_none());
            assert_eq!(content, "untouched legacy seven");
        }

        // Update by the real msg_id "lin-7": must hit the real node, NOT rowid 7.
        assert!(
            backend
                .update_node("c", &node("lin-7", None, "user", "updated real content"))
                .unwrap()
        );

        let conn = backend.conn.lock();
        let real: String = conn
            .query_row(
                "SELECT content FROM sessions WHERE session_key = 'c' AND msg_id = 'lin-7'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            real, "updated real content",
            "msg_id path updated the real node"
        );
        let legacy7: String = conn
            .query_row(
                "SELECT content FROM sessions WHERE id = 7 AND msg_id IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            legacy7, "untouched legacy seven",
            "rowid-7 row was NOT shadowed"
        );
    }
}
