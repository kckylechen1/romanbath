// enrichment.rs — LLM-powered memory enrichment for the dreaming pipeline.
//
// Light Sleep:  extract facts + summaries via cheap model
// Deep Sleep:   verify consolidation candidates via medium model
// REM Sleep:    cross-domain pattern discovery via strong model

use std::sync::Arc;
use zeroclaw_api::model_provider::ModelProvider;

// ─── Enricher ─────────────────────────────────────────────────────────────────

/// LLM-powered memory enrichment for the dreaming pipeline.
///
/// Holds two provider/model pairs:
/// - **extract**: cheap, fast model for extraction and summarization (Light Sleep)
/// - **distill**: stronger model for verification and pattern discovery (Deep/REM Sleep)
///
/// All methods gracefully handle LLM failures by returning `Err`, allowing
/// callers to fall back to pure-Rust heuristics.
pub struct MemoryEnricher {
    /// Provider for extraction/summarization (cheap, fast).
    pub extract_provider: Arc<dyn ModelProvider>,
    /// Model ID for extraction calls.
    pub extract_model: String,
    /// Provider for deep distillation (strong, expensive).
    pub distill_provider: Arc<dyn ModelProvider>,
    /// Model ID for distillation calls.
    pub distill_model: String,
}

impl MemoryEnricher {
    /// Create a new enricher with separate providers for extraction and distillation.
    pub fn new(
        extract_provider: Arc<dyn ModelProvider>,
        extract_model: &str,
        distill_provider: Arc<dyn ModelProvider>,
        distill_model: &str,
    ) -> Self {
        Self {
            extract_provider,
            extract_model: extract_model.to_string(),
            distill_provider,
            distill_model: distill_model.to_string(),
        }
    }

    /// Create an enricher that uses a single provider for both roles.
    pub fn with_single_provider(
        provider: Arc<dyn ModelProvider>,
        extract_model: &str,
        distill_model: &str,
    ) -> Self {
        let extract = Arc::clone(&provider);
        Self {
            extract_provider: extract,
            extract_model: extract_model.to_string(),
            distill_provider: provider,
            distill_model: distill_model.to_string(),
        }
    }

    /// Extract facts, summary, and keywords from raw chat text.
    ///
    /// Used by **Light Sleep**. Returns `(summary, keywords, entities, importance)`.
    pub async fn extract_facts(
        &self,
        text: &str,
        character_name: &str,
        user_name: &str,
    ) -> anyhow::Result<(String, Vec<String>, Vec<String>, f64)> {
        let system_prompt = format!(
            "You are a memory extraction system for {character_name}, an AI companion.\n\
             Extract factual information from the following chat message sent by {user_name}.\n\n\
             Output JSON:\n\
             {{\n\
               \"summary\": \"≤100 char summary in Chinese\",\n\
               \"keywords\": [\"tag1\", \"tag2\"],\n\
               \"entities\": [\"entity1\"],\n\
               \"importance\": 0.0-1.0\n\
             }}\n\n\
             Output ONLY valid JSON, no other text."
        );
        let user_msg = format!("Chat message: {text}");

        let response = self
            .extract_provider
            .chat_with_system(
                Some(&system_prompt),
                &user_msg,
                &self.extract_model,
                Some(0.3),
            )
            .await?;

        parse_extract_response(&response)
    }

    /// Verify whether a raw memory should be promoted to consolidated.
    ///
    /// Used by **Deep Sleep**. Returns `true` if the memory should be promoted.
    pub async fn verify_consolidation(
        &self,
        entry_summary: &str,
        entry_text: &str,
        recall_count: i64,
    ) -> anyhow::Result<bool> {
        let system_prompt = "You are a memory consolidation evaluator. Decide whether a memory should be \
             promoted from \"raw\" to \"consolidated\" tier based on its significance and \
             retrieval patterns. Reply ONLY \"yes\" or \"no\".";

        let user_msg = format!(
            "Memory candidate for consolidation:\n\
             Summary: {entry_summary}\n\
             Full text: {entry_text}\n\
             Recall count: {recall_count}\n\n\
             Should this memory be promoted from \"raw\" to \"consolidated\" tier?\n\
             Reply ONLY \"yes\" or \"no\"."
        );

        let response = self
            .distill_provider
            .chat_with_system(
                Some(system_prompt),
                &user_msg,
                &self.distill_model,
                Some(0.1),
            )
            .await?;

        Ok(parse_verify_response(&response))
    }

    /// Discover cross-domain patterns from a batch of consolidated memories.
    ///
    /// Used by **REM Sleep**. Returns a list of discovered pattern strings.
    pub async fn discover_patterns(
        &self,
        entries: &[String],
        character_name: &str,
    ) -> anyhow::Result<Vec<String>> {
        let memories = entries.join("\n---\n");

        let system_prompt = format!(
            "You are {character_name}'s memory distillation system.\n\
             Review the following consolidated memories and discover cross-domain \
             patterns and insights.\n\n\
             Output a JSON array of pattern strings:\n\
             [\"pattern1\", \"pattern2\"]\n\n\
             Output ONLY valid JSON, no other text."
        );

        let user_msg = format!("Consolidated memories from the past week:\n\n{memories}");

        let response = self
            .distill_provider
            .chat_with_system(
                Some(&system_prompt),
                &user_msg,
                &self.distill_model,
                Some(0.5),
            )
            .await?;

        parse_patterns_response(&response)
    }
}

// ─── Response Parsers ─────────────────────────────────────────────────────────

/// Parse the JSON response from `extract_facts`.
fn parse_extract_response(raw: &str) -> anyhow::Result<(String, Vec<String>, Vec<String>, f64)> {
    let cleaned = strip_json_fences(raw);
    let v: serde_json::Value = serde_json::from_str(&cleaned)?;

    let summary = v["summary"]
        .as_str()
        .unwrap_or("")
        .chars()
        .take(100)
        .collect::<String>();

    let keywords = v["keywords"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let entities = v["entities"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let importance = v["importance"].as_f64().unwrap_or(0.7).clamp(0.0, 1.0);

    Ok((summary, keywords, entities, importance))
}

/// Parse "yes" or "no" from the verification response.
fn parse_verify_response(raw: &str) -> bool {
    let lowered = raw.trim().to_ascii_lowercase();
    lowered.starts_with("yes")
}

/// Parse JSON array of patterns from the discovery response.
fn parse_patterns_response(raw: &str) -> anyhow::Result<Vec<String>> {
    let cleaned = strip_json_fences(raw);
    let arr: Vec<String> = serde_json::from_str(&cleaned)?;
    Ok(arr)
}

/// Strip markdown code fences (```json ... ```) from LLM output.
fn strip_json_fences(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("```") {
        // Find the closing fence
        let start = trimmed.find('\n').map(|i| i + 1).unwrap_or(3);
        let end = trimmed.rfind("```").unwrap_or(trimmed.len());
        trimmed[start..end].trim().to_string()
    } else {
        trimmed.to_string()
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_extract_response_valid_json() {
        let raw = r#"{"summary":"用户喜欢暗色模式","keywords":["dark mode","UI"],"entities":["Alice"],"importance":0.8}"#;
        let (summary, keywords, entities, importance) =
            parse_extract_response(raw).expect("should parse");
        assert_eq!(summary, "用户喜欢暗色模式");
        assert_eq!(keywords, vec!["dark mode", "UI"]);
        assert_eq!(entities, vec!["Alice"]);
        assert!((importance - 0.8).abs() < 1e-9);
    }

    #[test]
    fn parse_extract_response_with_code_fence() {
        let raw = "```json\n{\"summary\":\"test\",\"keywords\":[],\"entities\":[],\"importance\":0.5}\n```";
        let (summary, _, _, importance) = parse_extract_response(raw).expect("should parse");
        assert_eq!(summary, "test");
        assert!((importance - 0.5).abs() < 1e-9);
    }

    #[test]
    fn parse_extract_response_defaults_on_partial() {
        let raw = r#"{"summary":"partial"}"#;
        let (summary, keywords, entities, importance) =
            parse_extract_response(raw).expect("should parse");
        assert_eq!(summary, "partial");
        assert!(keywords.is_empty());
        assert!(entities.is_empty());
        assert!((importance - 0.7).abs() < 1e-9); // default
    }

    #[test]
    fn parse_extract_response_clamps_importance() {
        let raw = r#"{"summary":"test","keywords":[],"entities":[],"importance":2.5}"#;
        let (_, _, _, importance) = parse_extract_response(raw).expect("should parse");
        assert!((importance - 1.0).abs() < 1e-9);
    }

    #[test]
    fn parse_extract_response_truncates_long_summary() {
        let long = "x".repeat(200);
        let raw = format!(r#"{{"summary":"{long}","keywords":[],"entities":[],"importance":0.5}}"#);
        let (summary, _, _, _) = parse_extract_response(&raw).expect("should parse");
        assert_eq!(summary.len(), 100);
    }

    #[test]
    fn parse_verify_response_yes() {
        assert!(parse_verify_response("yes"));
        assert!(parse_verify_response("Yes"));
        assert!(parse_verify_response("YES"));
        assert!(parse_verify_response("  yes  "));
    }

    #[test]
    fn parse_verify_response_no() {
        assert!(!parse_verify_response("no"));
        assert!(!parse_verify_response("No"));
        assert!(!parse_verify_response("NO"));
        assert!(!parse_verify_response("  no  "));
    }

    #[test]
    fn parse_verify_response_other() {
        assert!(!parse_verify_response("maybe"));
        assert!(!parse_verify_response(""));
    }

    #[test]
    fn parse_patterns_response_valid() {
        let raw = r#"["pattern A","pattern B","pattern C"]"#;
        let patterns = parse_patterns_response(raw).expect("should parse");
        assert_eq!(patterns.len(), 3);
        assert_eq!(patterns[0], "pattern A");
    }

    #[test]
    fn parse_patterns_response_with_fence() {
        let raw = "```json\n[\"discovery 1\",\"discovery 2\"]\n```";
        let patterns = parse_patterns_response(raw).expect("should parse");
        assert_eq!(patterns.len(), 2);
    }

    #[test]
    fn parse_patterns_response_empty_array() {
        let raw = "[]";
        let patterns = parse_patterns_response(raw).expect("should parse");
        assert!(patterns.is_empty());
    }

    #[test]
    fn parse_patterns_response_invalid_json() {
        let raw = "not json";
        assert!(parse_patterns_response(raw).is_err());
    }

    #[test]
    fn parse_extract_response_invalid_json() {
        let raw = "not json";
        assert!(parse_extract_response(raw).is_err());
    }

    #[test]
    fn strip_json_fences_no_fence() {
        assert_eq!(strip_json_fences(r#"{"a":1}"#), r#"{"a":1}"#);
    }

    #[test]
    fn strip_json_fences_with_fence() {
        let input = "```json\n{\"a\":1}\n```";
        assert_eq!(strip_json_fences(input), r#"{"a":1}"#);
    }

    #[test]
    fn strip_json_fences_array_with_fence() {
        let input = "```\n[1,2,3]\n```";
        assert_eq!(strip_json_fences(input), "[1,2,3]");
    }
}
