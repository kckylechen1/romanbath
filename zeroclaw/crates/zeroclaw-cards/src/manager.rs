use crate::{CardError, CharacterCard, extract_from_json, extract_from_png_bytes};
use std::fs;
use std::path::{Path, PathBuf};

/// Manages a local library of imported character cards.
pub struct CardManager {
    cards_dir: PathBuf,
}

impl CardManager {
    /// Create a new CardManager with the given storage directory.
    pub fn new(cards_dir: PathBuf) -> Self {
        Self { cards_dir }
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

        let card = match ext.as_str() {
            "json" => {
                let json = String::from_utf8_lossy(bytes);
                extract_from_json(&json)?
            }
            "png" | "webp" => extract_from_png_bytes(bytes)?,
            _ => extract_from_png_bytes(bytes)
                .or_else(|_| extract_from_json(&String::from_utf8_lossy(bytes)))
                .map_err(|_| CardError::UnrecognizedFormat)?,
        };

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

        Ok(name)
    }

    /// Save an already-parsed card (create or update).
    pub fn save(&self, card: &CharacterCard) -> Result<String, CardError> {
        self.save_card(card, &[], "json")
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
        let bytes = fs::read(&json_path)?;
        Ok(serde_json::from_slice(&bytes)?)
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

        Ok(())
    }

    /// Get the avatar path for a character, if it exists.
    pub fn avatar_path(&self, name: &str) -> Option<PathBuf> {
        let safe_name = sanitize_filename(name);
        let path = self.cards_dir.join(format!("{safe_name}.png"));
        path.exists().then_some(path)
    }
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

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("Hello World"), "Hello_World");
        assert_eq!(sanitize_filename("test/name:1"), "test_name_1");
    }
}
