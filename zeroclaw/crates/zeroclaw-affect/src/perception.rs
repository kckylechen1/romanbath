//! Perception — estimates user `AffectState` from `ConversationContext` +
//! `UserSignals`. Pluggable via the `AffectEstimator` trait so heuristic,
//! local-model, and LLM backends can swap without touching downstream.

use crate::state::{AffectState, UserEmotion};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// What the companion knows about the conversation shape this turn.
/// Affects appraisal (active-listen vs encourage) and decays into the
/// mood baseline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationContext {
    pub turns_this_session: u32,
    pub session_duration: Duration,
    /// Local wall-clock hour of the user, 0..=23. Used only for gentle
    /// non-creepy time awareness (late-night sadness reads differently
    /// than afternoon sadness). Caller is responsible for resolving
    /// timezone.
    pub local_hour: u8,
    pub topic: Option<String>,
    /// 0.0..=1.0. Is the user leaning in or fading? Drives
    /// ActiveListen vs redirect.
    pub user_engagement: f32,
}

impl Default for ConversationContext {
    fn default() -> Self {
        Self {
            turns_this_session: 0,
            session_duration: Duration::from_secs(0),
            local_hour: 12,
            topic: None,
            user_engagement: 0.5,
        }
    }
}

/// Raw signals extracted from the user's latest message + session
/// telemetry. Feeds the estimator. All fields optional / nullable so
/// callers can pass partial data.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserSignals {
    /// -1.0..=1.0 from a sentiment classifier, if available. `None`
    /// means no sentiment signal; estimator falls back to text heuristics.
    pub message_sentiment: Option<f32>,
    /// Raw message text for keyword/regex heuristics. Empty string
    /// when the turn has no user text (e.g. voice-only with failed STT).
    pub message_text: String,
    /// 0.0..=1.0. Cues like very short replies, long pauses, late-night
    /// patterns. Higher = more withdrawn.
    pub withdrawal: f32,
}

/// Pluggable affect estimator. The default [`HeuristicEstimator`] is
/// pure-Rust with no external calls; ship that first and add
/// `LlmEstimator` later behind the same trait + identical I/O contract.
pub trait AffectEstimator: Send + Sync {
    fn estimate(&self, ctx: &ConversationContext, signals: &UserSignals) -> AffectState;
}

/// Transparent, no-external-calls estimator. Intentionally conservative
/// on confidence — when signals are sparse (no sentiment, no keyword
/// hits, no withdrawal cue), confidence stays at 0.3 so appraisal falls
/// back to `Mirror` rather than committing to a strong label.
pub struct HeuristicEstimator;

impl Default for HeuristicEstimator {
    fn default() -> Self {
        Self
    }
}

impl AffectEstimator for HeuristicEstimator {
    fn estimate(&self, ctx: &ConversationContext, signals: &UserSignals) -> AffectState {
        // ── Sentiment shortcut ─────────────────────────────────────────
        // If the caller already ran a sentiment classifier, trust its
        // number with moderate confidence. This is the cleanest signal
        // and lets the heuristic estimator ride on top of a model-based
        // sentiment pass without coupling.
        if let Some(sent) = signals.message_sentiment {
            let valence = sent.clamp(-1.0, 1.0);
            // Without an arousal signal, infer from |valence| + withdrawal:
            // strong affect + low withdrawal => high arousal (activated);
            // strong affect + high withdrawal => low arousal (shut down).
            let arousal = if signals.withdrawal > 0.6 {
                0.25
            } else {
                (0.3 + valence.abs() * 0.5).clamp(0.0, 1.0)
            };
            let confidence = 0.65;
            let label = AffectState::classify(valence, arousal);
            return AffectState {
                valence,
                arousal,
                label,
                confidence,
            };
        }

        // ── Keyword heuristics ─────────────────────────────────────────
        // Hit the most reliable lexical bands first. Match is
        // case-insensitive whole-word where possible; substring where
        // the keyword has no common false-positive (English + 简体中文).
        let text = signals.message_text.to_lowercase();
        let text_ref = text.as_str();

        // Late-night + withdrawal shortcut: text很短 + 凌晨时段 => Sadness
        let late_night = matches!(ctx.local_hour, 0..=4 | 22..=23);
        let short_reply = signals.message_text.split_whitespace().count() < 4;

        if signals.withdrawal > 0.6 && late_night {
            return AffectState {
                valence: -0.5,
                arousal: 0.2,
                label: Some(UserEmotion::Loneliness),
                confidence: 0.55,
            };
        }

        // Joy / Excitement
        if any_contains(
            text_ref,
            &[
                "love",
                "great",
                "amazing",
                "happy",
                "excited",
                "太棒了",
                "开心",
                "兴奋",
                "喜欢",
            ],
        ) {
            let arousal = if short_reply { 0.5 } else { 0.75 };
            return AffectState {
                valence: 0.7,
                arousal,
                label: AffectState::classify(0.7, arousal),
                confidence: 0.6,
            };
        }

        // Sadness / Loneliness
        if any_contains(
            text_ref,
            &[
                "sad",
                "lonely",
                "tired",
                "exhausted",
                "depressed",
                "难过的",
                "孤独",
                "累",
                "心累",
                "难受",
            ],
        ) {
            let valence = -0.6;
            let arousal = if signals.withdrawal > 0.4 { 0.15 } else { 0.3 };
            return AffectState {
                valence,
                arousal,
                label: AffectState::classify(valence, arousal),
                confidence: 0.6,
            };
        }

        // Anxiety / Overwhelm
        if any_contains(
            text_ref,
            &[
                "anxious",
                "worried",
                "stressed",
                "overwhelmed",
                "panic",
                "焦虑",
                "担心",
                "压力",
                "崩溃",
            ],
        ) {
            return AffectState {
                valence: -0.5,
                arousal: 0.8,
                label: Some(UserEmotion::Anxiety),
                confidence: 0.6,
            };
        }

        // Anger / Frustration
        if any_contains(
            text_ref,
            &[
                "angry",
                "furious",
                "frustrated",
                "hate",
                "pissed",
                "气死",
                "愤怒",
                "烦死了",
                "讨厌",
            ],
        ) {
            return AffectState {
                valence: -0.7,
                arousal: 0.85,
                label: Some(UserEmotion::Anger),
                confidence: 0.6,
            };
        }

        // Nothing matched — keep neutral with low confidence so appraisal
        // falls back to Mirror. This is the right call when the user
        // sends an emotionless "ok" or a topic-shift message; we don't
        // want to invent an affect.
        AffectState {
            valence: 0.0,
            arousal: if short_reply { 0.15 } else { 0.3 },
            label: Some(UserEmotion::Calm),
            confidence: 0.3,
        }
    }
}

fn any_contains(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signals(text: &str) -> UserSignals {
        UserSignals {
            message_sentiment: None,
            message_text: text.into(),
            withdrawal: 0.0,
        }
    }

    #[test]
    fn sentiment_shortcut_overrides_keywords() {
        let est = HeuristicEstimator;
        let ctx = ConversationContext::default();
        let sig = UserSignals {
            message_sentiment: Some(0.8),
            message_text: "neutral wording".into(),
            withdrawal: 0.0,
        };
        let a = est.estimate(&ctx, &sig);
        assert!(a.valence > 0.5);
        assert!(a.confidence > 0.6);
    }

    #[test]
    fn joy_keyword_produces_positive_affect() {
        let est = HeuristicEstimator;
        let ctx = ConversationContext::default();
        let a = est.estimate(&ctx, &signals("I'm so happy today!"));
        assert!(a.valence > 0.5);
        assert!(a.confidence >= 0.5);
    }

    #[test]
    fn chinese_sadness_keyword() {
        let est = HeuristicEstimator;
        let ctx = ConversationContext::default();
        let a = est.estimate(&ctx, &signals("今天好累，心累"));
        assert!(a.valence < 0.0);
    }

    #[test]
    fn late_night_withdrawal_shortcut() {
        let est = HeuristicEstimator;
        let ctx = ConversationContext {
            local_hour: 2,
            ..Default::default()
        };
        let sig = UserSignals {
            message_sentiment: None,
            message_text: "嗯".into(),
            withdrawal: 0.8,
        };
        let a = est.estimate(&ctx, &sig);
        assert_eq!(a.label, Some(UserEmotion::Loneliness));
    }

    #[test]
    fn neutral_text_keeps_low_confidence() {
        let est = HeuristicEstimator;
        let ctx = ConversationContext::default();
        let a = est.estimate(&ctx, &signals("ok got it"));
        assert!(a.confidence <= 0.4);
    }

    #[test]
    fn empty_text_does_not_crash() {
        let est = HeuristicEstimator;
        let ctx = ConversationContext::default();
        let a = est.estimate(&ctx, &signals(""));
        assert_eq!(a.label, Some(UserEmotion::Calm));
    }
}
