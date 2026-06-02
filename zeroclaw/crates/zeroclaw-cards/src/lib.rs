//! SillyTavern-compatible character card parser and manager.
//!
//! Reads TavernAI V1/V2/V3 character data from PNG tEXt chunks or raw JSON,
//! normalizes across versions, and manages a local character library.

mod manager;
pub mod tokenizer;
mod types;

pub use manager::CardManager;
pub use tokenizer::TokenMessage;
pub use types::{PromptOrder, *};

/// PNG signature bytes.
const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

/// Errors that can occur during card extraction.
#[derive(Debug, thiserror::Error)]
pub enum CardError {
    #[error("not a valid PNG file")]
    InvalidPng,
    #[error("no character data found in PNG (expected tEXt chunk with keyword 'chara' or 'ccv3')")]
    NoCharacterData,
    #[error("unrecognized character card format")]
    UnrecognizedFormat,
    #[error("base64 decode failed: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("JSON parse failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

/// Extract a character card from raw PNG bytes.
pub fn extract_from_png_bytes(bytes: &[u8]) -> Result<CharacterCard, CardError> {
    if bytes.len() < 8 || bytes[..8] != PNG_SIGNATURE {
        return Err(CardError::InvalidPng);
    }

    let text_chunks = read_png_text_chunks(bytes);

    // Prefer V3 (ccv3) over V2 (chara)
    if let Some(value) = text_chunks.iter().find_map(|(k, v)| (k == "ccv3").then_some(v)) {
        let json = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, value)?;
        let raw: serde_json::Value = serde_json::from_slice(&json)?;
        return normalize_card(&raw);
    }

    if let Some(value) = text_chunks.iter().find_map(|(k, v)| (k == "chara").then_some(v)) {
        let json = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, value)?;
        let raw: serde_json::Value = serde_json::from_slice(&json)?;
        return normalize_card(&raw);
    }

    Err(CardError::NoCharacterData)
}

/// Extract a character card from a JSON string.
pub fn extract_from_json(json: &str) -> Result<CharacterCard, CardError> {
    let raw: serde_json::Value = serde_json::from_str(json)?;
    normalize_card(&raw)
}

/// Read all tEXt chunks from a PNG byte buffer.
fn read_png_text_chunks(bytes: &[u8]) -> Vec<(String, String)> {
    let mut chunks = Vec::new();
    let mut offset = 8; // skip PNG signature

    while offset + 12 <= bytes.len() {
        let length = u32::from_be_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]) as usize;
        let chunk_type = &bytes[offset + 4..offset + 8];

        if offset + 12 + length > bytes.len() {
            break;
        }

        if chunk_type == b"tEXt" {
            let data = &bytes[offset + 8..offset + 8 + length];
            if let Some(null_pos) = data.iter().position(|&b| b == 0) {
                let keyword = String::from_utf8_lossy(&data[..null_pos]).into_owned();
                let value = String::from_utf8_lossy(&data[null_pos + 1..]).into_owned();
                chunks.push((keyword, value));
            }
        }

        offset += 12 + length; // length(4) + type(4) + data + crc(4)
    }

    chunks
}

/// Normalize raw JSON into a CharacterCard, handling V1/V2/V3 formats.
fn normalize_card(raw: &serde_json::Value) -> Result<CharacterCard, CardError> {
    // V2/V3: has spec wrapper
    if let Some(spec) = raw.get("spec").and_then(|v| v.as_str()) {
        if spec == "chara_card_v2" || spec == "chara_card_v3" {
            return Ok(serde_json::from_value(raw.clone())?);
        }
    }

    // V1: raw fields at top level, wrap in V2 envelope
    if raw.get("name").and_then(|v| v.as_str()).is_some()
        && raw.get("description").and_then(|v| v.as_str()).is_some()
        && raw.get("first_mes").and_then(|v| v.as_str()).is_some()
    {
        let data = CharacterData {
            name: raw["name"].as_str().unwrap_or("").to_string(),
            description: raw["description"].as_str().unwrap_or("").to_string(),
            personality: raw["personality"].as_str().unwrap_or("").to_string(),
            scenario: raw["scenario"].as_str().unwrap_or("").to_string(),
            first_mes: raw["first_mes"].as_str().unwrap_or("").to_string(),
            mes_example: raw["mes_example"].as_str().unwrap_or("").to_string(),
            system_prompt: String::new(),
            post_history_instructions: String::new(),
            alternate_greetings: Vec::new(),
            tags: Vec::new(),
            creator: String::new(),
            creator_notes: String::new(),
            character_version: String::new(),
            character_book: None,
            extensions: serde_json::Value::Object(serde_json::Map::new()),
        };
        return Ok(CharacterCard {
            spec: "chara_card_v2".to_string(),
            spec_version: "2.0".to_string(),
            data,
        });
    }

    Err(CardError::UnrecognizedFormat)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_v1_card() {
        let json = serde_json::json!({
            "name": "TestBot",
            "description": "A test character",
            "personality": "Friendly",
            "scenario": "Testing",
            "first_mes": "Hello!",
            "mes_example": "<START>Hi there!"
        });
        let card = normalize_card(&json).unwrap();
        assert_eq!(card.spec, "chara_card_v2");
        assert_eq!(card.data.name, "TestBot");
        assert_eq!(card.data.description, "A test character");
    }

    #[test]
    fn test_normalize_v2_card() {
        let json = serde_json::json!({
            "spec": "chara_card_v2",
            "spec_version": "2.0",
            "data": {
                "name": "TestBot",
                "description": "A test character",
                "personality": "",
                "scenario": "",
                "first_mes": "Hello!",
                "mes_example": "",
                "system_prompt": "",
                "post_history_instructions": "",
                "alternate_greetings": [],
                "tags": [],
                "creator": "",
                "creator_notes": "",
                "character_version": "",
                "character_book": null,
                "extensions": {}
            }
        });
        let card = normalize_card(&json).unwrap();
        assert_eq!(card.spec, "chara_card_v2");
        assert_eq!(card.data.name, "TestBot");
    }

    #[test]
    fn test_reject_invalid() {
        let json = serde_json::json!({"foo": "bar"});
        assert!(normalize_card(&json).is_err());
    }
}
