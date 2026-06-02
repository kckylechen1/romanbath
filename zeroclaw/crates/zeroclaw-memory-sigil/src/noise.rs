// noise.rs — Text noise detection for RomanBath chat memory.
//
// Ported from Sigil with chat-specific additions:
// - Filters pure emoji, single-char replies, system role messages.

use regex::Regex;
use std::sync::OnceLock;

// ─── Noise Detection (for storing) ──────────────────────────────────────────

fn denial_patterns() -> &'static Vec<Regex> {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"(?i)i don'?t have (any )?(information|data|memory|record)").unwrap(),
            Regex::new(r"(?i)i'?m not sure about").unwrap(),
            Regex::new(r"(?i)i don'?t recall").unwrap(),
            Regex::new(r"(?i)i don'?t remember").unwrap(),
            Regex::new(r"(?i)i wasn'?t able to find").unwrap(),
            Regex::new(r"(?i)^i apologize\b").unwrap(),
            Regex::new(r"(?i)^as an ai\b").unwrap(),
            Regex::new(r"(?i)^i cannot\b").unwrap(),
            Regex::new(r"(?i)^i can'?t\b").unwrap(),
            Regex::new(r"(?i)^let me know if\b").unwrap(),
            Regex::new(r"(?i)^is there anything else\b").unwrap(),
        ]
    })
}

fn boilerplate_patterns() -> &'static Vec<Regex> {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"(?i)^(hi|hello|hey|good morning|good evening|greetings)\b").unwrap(),
            Regex::new(r"(?i)^HEARTBEAT").unwrap(),
        ]
    })
}

const BOILERPLATE_MAX_CHARS: usize = 30;

/// Check if a text is noise that should NOT be stored as memory.
/// Includes chat-specific filters for pure emoji, single chars, system role.
pub fn is_noise_text(text: &str, role: Option<&str>) -> bool {
    let trimmed = text.trim();
    let char_count = trimmed.chars().count();

    // System messages are noise
    if role == Some("system") {
        return true;
    }

    // Pure emoji / whitespace
    if is_pure_emoji(trimmed) {
        return true;
    }

    // Single character replies
    if char_count <= 1 {
        return true;
    }

    // Too short to be meaningful
    if char_count < 5 {
        return true;
    }

    // Denial patterns
    if denial_patterns().iter().any(|p| p.is_match(trimmed)) {
        return true;
    }

    // Boilerplate only for short texts
    if char_count <= BOILERPLATE_MAX_CHARS
        && boilerplate_patterns().iter().any(|p| p.is_match(trimmed))
    {
        return true;
    }

    false
}

// ─── Query Skip (for retrieval) ─────────────────────────────────────────────

fn skip_patterns() -> &'static Vec<Regex> {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"(?i)^(hi|hello|hey|good\s*(morning|afternoon|evening|night)|greetings|yo|sup|howdy)\b").unwrap(),
            Regex::new(r"^/").unwrap(),
            Regex::new(r"(?i)^(yes|no|yep|nope|ok|okay|sure|fine|thanks|thank you|thx|ty|got it|understood|cool|nice|great|good|perfect|awesome)\s*[.!]?$").unwrap(),
            Regex::new(r"(?i)^(go ahead|continue|proceed|do it|start|begin|next)\s*[.!]?$").unwrap(),
            Regex::new(r"(?i)HEARTBEAT").unwrap(),
            Regex::new(r"(?i)^\[System").unwrap(),
            Regex::new(r"(?i)^(ping|pong|test|debug)\s*[.!?]?$").unwrap(),
        ]
    })
}

fn force_retrieve_patterns() -> &'static Vec<Regex> {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"(?i)\b(remember|recall|forgot|memory|memories)\b").unwrap(),
            Regex::new(r"(?i)\b(last time|before|previously|earlier|yesterday|ago)\b").unwrap(),
            Regex::new(r"(?i)\b(my (name|email|phone|address|birthday|preference))\b").unwrap(),
        ]
    })
}

const SKIP_MAX_CHARS: usize = 40;

/// Check if a character is CJK.
#[inline]
pub fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{4E00}'..='\u{9FFF}'
        | '\u{3400}'..='\u{4DBF}'
        | '\u{F900}'..='\u{FAFF}'
        | '\u{3040}'..='\u{309F}'
        | '\u{30A0}'..='\u{30FF}'
        | '\u{AC00}'..='\u{D7AF}'
    )
}

fn is_pure_emoji(s: &str) -> bool {
    if s.is_empty() {
        return true;
    }
    s.chars()
        .all(|c| c.is_whitespace() || (!c.is_alphanumeric() && !is_cjk(c)))
}

/// Determine if a query should skip memory retrieval.
pub fn should_skip_query(query: &str) -> bool {
    let trimmed = query.trim();
    let char_count = trimmed.chars().count();

    if force_retrieve_patterns()
        .iter()
        .any(|p| p.is_match(trimmed))
    {
        return false;
    }

    if char_count < 3 {
        return true;
    }

    if is_pure_emoji(trimmed) {
        return true;
    }

    if char_count <= SKIP_MAX_CHARS && skip_patterns().iter().any(|p| p.is_match(trimmed)) {
        return true;
    }

    let has_cjk = trimmed.chars().any(is_cjk);
    let default_min_length = if has_cjk { 4 } else { 10 };
    let has_question = trimmed.contains('?') || trimmed.contains('？');

    if char_count < default_min_length && !has_question {
        return true;
    }

    false
}

/// Remove `<think ...>...</think >` tags from text.
pub fn scrub_think_tags(text: &str) -> String {
    static THINK_BLOCK_RE: OnceLock<Regex> = OnceLock::new();
    let re = THINK_BLOCK_RE.get_or_init(|| {
        Regex::new(r"(?is)<think\b[^>]*>.*?</think\s*>").expect("valid think-tag regex")
    });
    re.replace_all(text, "").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noise_too_short() {
        assert!(is_noise_text("hi", None));
        assert!(is_noise_text("ok", None));
        assert!(is_noise_text("   ", None));
    }

    #[test]
    fn noise_system_role() {
        assert!(is_noise_text("The user is talking about X", Some("system")));
    }

    #[test]
    fn noise_pure_emoji() {
        assert!(is_noise_text("👍", None));
        assert!(is_noise_text("👍👎", None));
    }

    #[test]
    fn noise_real_content_passes() {
        assert!(!is_noise_text(
            "I prefer using TypeScript for web development",
            None
        ));
        assert!(!is_noise_text(
            "Decision: use Rust for the memory core",
            None
        ));
    }

    #[test]
    fn skip_greetings() {
        assert!(should_skip_query("hi"));
        assert!(should_skip_query("hello"));
    }

    #[test]
    fn skip_affirmations() {
        assert!(should_skip_query("ok"));
        assert!(should_skip_query("yes"));
        assert!(should_skip_query("got it"));
    }

    #[test]
    fn force_memory_keywords() {
        assert!(!should_skip_query("Do you remember the config?"));
        assert!(!should_skip_query("What did I say about TypeScript?"));
    }

    #[test]
    fn real_queries_pass() {
        assert!(!should_skip_query(
            "How to implement hybrid search in Rust?"
        ));
    }

    #[test]
    fn skip_pure_emoji() {
        assert!(should_skip_query("👍"));
        assert!(should_skip_query("👍👎"));
    }

    #[test]
    fn test_scrub_think_tags() {
        let input = "<think>\nAnalyzing the context...\nLet's reply politely.\n</think>\nHello! How can I help you today?";
        assert_eq!(scrub_think_tags(input), "Hello! How can I help you today?");

        let input_multiple =
            "<think>first thought</think>Part 1<think>second thought</think>Part 2";
        assert_eq!(scrub_think_tags(input_multiple), "Part 1Part 2");
    }
}
