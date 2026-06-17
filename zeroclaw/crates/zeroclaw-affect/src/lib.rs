//! Companion empathetic computing module — affect estimation +
//! empathy strategy + stance modulation for ZeroClaw companion agents.
//!
//! Inspired by XiaoIce's empathetic computing module (eQ/eR vectors) and
//! Livia's multi-agent + memory-compression design. The skeleton is the
//! same as the trading-agent affect spec (perceive → appraise →
//! respond, over persistent state) but the optimization target is
//! companion warmth, not calibrated trust.
//!
//! ## Scope
//!
//! This crate handles **emotion tracking + stance modulation only**.
//! Crisis detection, dependency monitoring, minor-safety guardrails,
//! and content-filtering are out of scope — they belong to product-
//! level safety layers outside this crate. This module does not refuse
//! or rewrite responses; it only conditions generation via the
//! `ExpressedStance::to_prompt_hint` text that callers append to the
//! system prompt.
//!
//! ## Pipeline
//!
//! 1. **Perceive**: `AffectEstimator::estimate(ctx, signals) -> AffectState`
//!    — heuristic default, LLM-based variant possible behind the trait.
//! 2. **Appraise**: `appraise(affect, persona, engagement) -> ExpressedStance`
//!    — pick `EmpathyStrategy` + modulate warmth/energy around the
//!    `CompanionPersona` baseline.
//! 3. **Respond**: caller appends `stance.to_prompt_hint()` to the
//!    character card's system prompt, then invokes the LLM as usual.
//!    No response rewriting in this crate.
//!
//! ## Integration policy
//!
//! **Supplement, don't replace.** Character cards remain the source of
//! truth for identity / system prompt / lorebook. This module's prompt
//! hint is a small bracketed block prepended/appended to whatever the
//! card already says. Card authors who haven't configured a companion
//! persona get `CompanionPersona::default()` — the module is always on
//! but starts gentle.

pub mod appraisal;
pub mod perception;
pub mod persona;
pub mod state;

pub use appraisal::{EmpathyStrategy, appraise, select_strategy};
pub use perception::{AffectEstimator, ConversationContext, HeuristicEstimator, UserSignals};
pub use persona::{Archetype, CompanionPersona, ExpressedStance};
pub use state::{AffectState, UserEmotion};

/// Convenience: run the full perceive + appraise pipeline in one call.
/// Returns the `ExpressedStance` the caller should feed into prompt
/// construction.
pub fn perceive_and_appraise(
    estimator: &dyn AffectEstimator,
    ctx: &ConversationContext,
    signals: &UserSignals,
    persona: &CompanionPersona,
) -> (AffectState, ExpressedStance) {
    let affect = estimator.estimate(ctx, signals);
    let stance = appraise(&affect, persona, ctx.user_engagement);
    (affect, stance)
}

#[cfg(test)]
mod integration_tests {
    use super::*;

    #[test]
    fn end_to_end_distressed_user_gets_soothing_stance() {
        let estimator = HeuristicEstimator;
        let ctx = ConversationContext {
            user_engagement: 0.4,
            ..Default::default()
        };
        let signals = UserSignals {
            message_sentiment: None,
            message_text: "I'm so stressed and anxious about everything".into(),
            withdrawal: 0.0,
        };
        let persona = CompanionPersona::default();
        let (affect, stance) = perceive_and_appraise(&estimator, &ctx, &signals, &persona);
        assert!(affect.valence < 0.0);
        assert!(affect.arousal > 0.6);
        assert_eq!(stance.strategy, EmpathyStrategy::Soothe);
        let hint = stance.to_prompt_hint();
        assert!(hint.contains("Lower the temperature"));
    }

    #[test]
    fn end_to_end_neutral_text_keeps_mirror_stance() {
        let estimator = HeuristicEstimator;
        let ctx = ConversationContext::default();
        let signals = UserSignals {
            message_sentiment: None,
            message_text: "ok".into(),
            withdrawal: 0.0,
        };
        let persona = CompanionPersona::default();
        let (_, stance) = perceive_and_appraise(&estimator, &ctx, &signals, &persona);
        assert_eq!(stance.strategy, EmpathyStrategy::Mirror);
    }

    #[test]
    fn end_to_end_joyful_user_gets_celebrate() {
        let estimator = HeuristicEstimator;
        let ctx = ConversationContext::default();
        let signals = UserSignals {
            message_sentiment: None,
            message_text: "I got the job! I'm so excited!".into(),
            withdrawal: 0.0,
        };
        let persona = CompanionPersona::default();
        let (_, stance) = perceive_and_appraise(&estimator, &ctx, &signals, &persona);
        assert_eq!(stance.strategy, EmpathyStrategy::Celebrate);
    }
}
