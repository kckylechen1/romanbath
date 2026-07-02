use crate::{CardError, CharacterCard, CharacterData, extract_from_json, extract_from_png_bytes};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct CardManager {
    cards_dir: PathBuf,
    cache: Arc<Mutex<HashMap<String, CachedCard>>>,
}

struct CachedCard {
    card: CharacterCard,
    mtime: SystemTime,
}

impl CardManager {
    pub fn new(cards_dir: PathBuf) -> Self {
        Self {
            cards_dir,
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Default cards directory: `~/.zeroclaw/characters/`
    ///
    /// Inherent associated function (not `Default::default`) because
    /// construction can fail on directories resolution — `#[allow]` keeps
    /// the public name stable while satisfying clippy's `should_implement_trait`
    /// lint.
    #[allow(clippy::should_implement_trait)]
    pub fn default() -> anyhow::Result<Self> {
        let home = directories::UserDirs::new()
            .map(|d| d.home_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        Ok(Self::new(home.join(".zeroclaw").join("characters")))
    }

    /// Storage directory for character cards.
    pub fn cards_dir(&self) -> &Path {
        &self.cards_dir
    }

    /// Import a character card from a file path (PNG, WEBP, or JSON).
    ///
    /// Returns the imported character's name.
    pub fn import(&self, file_path: &Path) -> Result<String, CardError> {
        let bytes = fs::read(file_path)?;
        let filename = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("card.json");
        self.import_bytes(&bytes, filename)
    }

    /// Import a character card from raw bytes (PNG, WEBP, or JSON).
    pub fn import_bytes(&self, bytes: &[u8], filename: &str) -> Result<String, CardError> {
        let ext = Path::new(filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let mut card = match ext.as_str() {
            "json" => {
                let json = String::from_utf8_lossy(bytes);
                extract_from_json(&json)?
            }
            "png" | "webp" => extract_from_png_bytes(bytes)?,
            _ => extract_from_png_bytes(bytes)
                .or_else(|_| extract_from_json(&String::from_utf8_lossy(bytes)))
                .map_err(|_| CardError::UnrecognizedFormat)?,
        };

        // First-time back-fill: legacy cards may carry entries without
        // stable ids. Assign once and persist; subsequent saves preserve
        // them. Import does NOT touch creation_date — the source card is
        // authoritative for "when was this made" — but does stamp
        // modification_date to the import moment and rewrites the spec
        // envelope so the canonical on-disk card matches detect_spec.
        assign_stable_entry_ids(&mut card.data);
        card.sync_spec();
        self.save_card(&card, bytes, &ext)
    }

    /// Persist a parsed card and optional avatar bytes.
    fn save_card(
        &self,
        card: &CharacterCard,
        raw_bytes: &[u8],
        ext: &str,
    ) -> Result<String, CardError> {
        let name = card.data.name.clone();
        let safe_name = sanitize_filename(&name);

        fs::create_dir_all(&self.cards_dir)?;

        let json_path = self.cards_dir.join(format!("{safe_name}.json"));
        let json = serde_json::to_string_pretty(card)?;
        fs::write(&json_path, json)?;

        if ext == "png" || ext == "webp" {
            let avatar_path = self.cards_dir.join(format!("{safe_name}.png"));
            fs::write(avatar_path, raw_bytes)?;
        }

        if let Ok(mut cache) = self.cache.lock() {
            cache.remove(&safe_name);
        }

        Ok(name)
    }

    /// Save an already-parsed card (create or update).
    ///
    /// Source of truth for `creation_date` / `modification_date` lives in
    /// the card JSON on disk. On create (no existing file under this name),
    /// we stamp `creation_date`. On every save we refresh `modification_date`.
    /// Both fields use UTC seconds-since-epoch rendered as decimal seconds
    /// (RFC 3339 profile: integer part is seconds, sub-second zero) — matches
    /// what ST V3 records and round-trips cleanly through serde.
    pub fn save(&self, card: &CharacterCard) -> Result<String, CardError> {
        let safe_name = sanitize_filename(&card.data.name);
        let json_path = self.cards_dir.join(format!("{safe_name}.json"));

        if json_path.exists()
            && let Ok(existing_bytes) = fs::read(&json_path)
            && let Ok(existing_card) = serde_json::from_slice::<CharacterCard>(&existing_bytes)
            && existing_card.data.name != card.data.name
        {
            return Err(CardError::AlreadyExists(format!(
                "A different character '{}' already occupies this slot",
                existing_card.data.name
            )));
        }

        let preserved_creation = if json_path.exists() {
            fs::read(&json_path)
                .ok()
                .and_then(|b| serde_json::from_slice::<CharacterCard>(&b).ok())
                .map(|existing| existing.data.creation_date)
                .filter(|s| !s.is_empty())
        } else {
            None
        };

        let mut to_write = card.clone();
        assign_stable_entry_ids(&mut to_write.data);
        to_write.sync_spec();
        let now = now_iso8601_utc();
        if let Some(preserved) = preserved_creation {
            to_write.data.creation_date = preserved;
        } else if to_write.data.creation_date.is_empty() {
            to_write.data.creation_date = now.clone();
        }
        // modification_date is always refreshed — every save is a real edit.
        to_write.data.modification_date = now;
        self.save_card(&to_write, &[], "json")
    }

    /// Create a new card, refusing to clobber an existing one.
    ///
    /// [`save`](Self::save) is a create-*or*-update: it writes
    /// `{sanitize(name)}.json` unconditionally, which is correct when editing
    /// a card but silently overwrites a *different* card whose name sanitizes
    /// to the same file (e.g. "Aria!" vs "Aria?"). Create and duplicate must
    /// not do that — they call this instead and get an error on collision.
    pub fn save_new(&self, card: &CharacterCard) -> Result<String, CardError> {
        let safe_name = sanitize_filename(&card.data.name);
        if self.cards_dir.join(format!("{safe_name}.json")).exists() {
            return Err(CardError::AlreadyExists(card.data.name.clone()));
        }
        self.save(card)
    }

    /// Whether a card already exists under this (sanitized) name.
    pub fn exists(&self, name: &str) -> bool {
        let safe_name = sanitize_filename(name);
        self.cards_dir.join(format!("{safe_name}.json")).exists()
    }

    /// List all imported character names.
    pub fn list(&self) -> Result<Vec<String>, CardError> {
        if !self.cards_dir.exists() {
            return Ok(Vec::new());
        }

        let mut names = Vec::new();
        for entry in fs::read_dir(&self.cards_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json")
                && let Some(stem) = path.file_stem().and_then(|s| s.to_str())
            {
                // Try to read the actual name from the card
                if let Ok(bytes) = fs::read(&path)
                    && let Ok(card) = serde_json::from_slice::<CharacterCard>(&bytes)
                {
                    names.push(card.data.name);
                    continue;
                }
                names.push(stem.to_string());
            }
        }
        names.sort();
        Ok(names)
    }

    /// Load a character card by name.
    pub fn load(&self, name: &str) -> Result<CharacterCard, CardError> {
        let safe_name = sanitize_filename(name);
        let json_path = self.cards_dir.join(format!("{safe_name}.json"));

        let mtime = fs::metadata(&json_path)
            .and_then(|m| m.modified())
            .unwrap_or(UNIX_EPOCH);

        if let Ok(cache) = self.cache.lock()
            && let Some(cached) = cache.get(&safe_name)
            && cached.mtime == mtime
        {
            return Ok(cached.card.clone());
        }

        let bytes = fs::read(&json_path)?;
        let card: CharacterCard = serde_json::from_slice(&bytes)?;

        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(
                safe_name,
                CachedCard {
                    card: card.clone(),
                    mtime,
                },
            );
        }

        Ok(card)
    }

    /// Delete a character card by name.
    pub fn delete(&self, name: &str) -> Result<(), CardError> {
        let safe_name = sanitize_filename(name);
        let json_path = self.cards_dir.join(format!("{safe_name}.json"));
        let avatar_path = self.cards_dir.join(format!("{safe_name}.png"));

        if json_path.exists() {
            fs::remove_file(&json_path)?;
        }
        if avatar_path.exists() {
            fs::remove_file(&avatar_path)?;
        }

        if let Ok(mut cache) = self.cache.lock() {
            cache.remove(&safe_name);
        }

        Ok(())
    }

    /// Get the avatar path for a character, if it exists.
    pub fn avatar_path(&self, name: &str) -> Option<PathBuf> {
        let safe_name = sanitize_filename(name);
        let path = self.cards_dir.join(format!("{safe_name}.png"));
        path.exists().then_some(path)
    }
}

/// Assign a UUID v4 to any lorebook entry whose `id` is empty. Existing ids
/// are preserved untouched. Idempotent — running it twice on the same card
/// leaves the second pass with nothing to do.
fn assign_stable_entry_ids(data: &mut CharacterData) {
    if let Some(book) = data.character_book.as_mut() {
        for entry in &mut book.entries {
            if entry.id.is_empty() {
                entry.id = uuid::Uuid::new_v4().to_string();
            }
        }
    }
}

/// Current UTC time rendered as RFC 3339 with second precision. We avoid
/// pulling in `chrono` — the seconds-since-epoch representation is what ST
/// V3 uses for its `creation_date` / `modification_date` and round-trips
/// cleanly through serde.
fn now_iso8601_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Render as a UTC calendar timestamp from civil-from-days algorithm
    // (Howard Hinnant's `civil_from_days`). Avoids the `time` crate dep.
    civil_from_unix(secs)
}

/// Convert a Unix timestamp (seconds since 1970-01-01 UTC) to an RFC 3339
/// string like `2026-06-17T12:34:56Z`. Howard Hinnant's date algorithm —
/// no external dependency.
fn civil_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    let hour = rem / 3_600;
    let minute = (rem % 3_600) / 60;
    let second = rem % 60;
    format!("{year:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Sanitize a string for use as a filename.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .replace(' ', "_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CharacterBookEntry;

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("Hello World"), "Hello_World");
        assert_eq!(sanitize_filename("test/name:1"), "test_name_1");
    }

    fn unique_temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("zc-cards-test-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn save_new_refuses_to_clobber_and_duplicate_suffixes() {
        let dir = unique_temp_dir();
        let mgr = CardManager::new(dir.clone());
        let card = extract_from_json(
            r#"{"spec":"chara_card_v2","spec_version":"2.0","data":{"name":"Aria","description":"d","first_mes":"hi"}}"#,
        )
        .unwrap();

        // First create lands.
        assert_eq!(mgr.save_new(&card).unwrap(), "Aria");
        assert!(mgr.exists("Aria"));
        assert!(!mgr.exists("Nobody"));

        // Second create under the same (sanitized) name is refused, not a
        // silent overwrite of the first card.
        assert!(matches!(
            mgr.save_new(&card).unwrap_err(),
            CardError::AlreadyExists(_)
        ));

        // Two *different* display names that sanitize to the same file collide
        // — the real footgun (both "Aria!" and "Aria?" map to "Aria_.json").
        let mut bang = card.clone();
        bang.data.name = "Aria!".into();
        assert_eq!(mgr.save_new(&bang).unwrap(), "Aria!");
        let mut question = card.clone();
        question.data.name = "Aria?".into();
        assert!(matches!(
            mgr.save_new(&question).unwrap_err(),
            CardError::AlreadyExists(_)
        ));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn civil_from_unix_matches_known_epoch() {
        // 1970-01-01T00:00:00Z
        assert_eq!(civil_from_unix(0), "1970-01-01T00:00:00Z");
        // 2000-01-01T00:00:00Z = 946_684_800
        assert_eq!(civil_from_unix(946_684_800), "2000-01-01T00:00:00Z");
        // 2026-01-01T00:00:00Z = 1_767_225_600
        assert_eq!(civil_from_unix(1_767_225_600), "2026-01-01T00:00:00Z");
    }

    #[test]
    fn assign_stable_entry_ids_is_idempotent() {
        let mut data = crate::CharacterData {
            name: "Test".into(),
            description: "x".into(),
            personality: String::new(),
            scenario: String::new(),
            first_mes: "hi".into(),
            mes_example: String::new(),
            system_prompt: String::new(),
            post_history_instructions: String::new(),
            alternate_greetings: Vec::new(),
            tags: Vec::new(),
            creator: String::new(),
            creator_notes: String::new(),
            character_version: String::new(),
            character_book: Some(crate::CharacterBook {
                name: String::new(),
                description: String::new(),
                entries: vec![
                    CharacterBookEntry {
                        id: String::new(),
                        keys: vec!["a".into()],
                        content: "A".into(),
                        enabled: true,
                        selective: false,
                        secondary_keys: Vec::new(),
                        constant: false,
                        position: "before_char".into(),
                        token_budget: None,
                        priority: None,
                        recursive: false,
                    },
                    CharacterBookEntry {
                        id: "fixed-id".into(),
                        keys: vec!["b".into()],
                        content: "B".into(),
                        enabled: true,
                        selective: false,
                        secondary_keys: Vec::new(),
                        constant: false,
                        position: "after_char".into(),
                        token_budget: None,
                        priority: None,
                        recursive: false,
                    },
                ],
            }),
            nickname: String::new(),
            group_only_greetings: Vec::new(),
            source: Vec::new(),
            assets: Vec::new(),
            extensions: serde_json::Value::Object(serde_json::Map::new()),
            creation_date: String::new(),
            modification_date: String::new(),
        };

        assign_stable_entry_ids(&mut data);
        let book = data.character_book.as_ref().unwrap();
        assert!(!book.entries[0].id.is_empty(), "first entry gets an id");
        assert_eq!(book.entries[1].id, "fixed-id", "existing id preserved");

        let id_after_first = book.entries[0].id.clone();
        assign_stable_entry_ids(&mut data);
        let book = data.character_book.as_ref().unwrap();
        assert_eq!(
            book.entries[0].id, id_after_first,
            "second pass does not reassign"
        );
    }
}
