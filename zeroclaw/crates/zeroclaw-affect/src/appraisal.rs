//! Appraisal — picks *how* the companion meets the user's feeling.
//!
//! Pure function over (affect, context, persona). Strategy selection is
//! auditable, not a black box. See [`select_strategy`].

use crate::persona::{CompanionPersona, ExpressedStance, modulate};
use crate::state::{AffectState, UserEmotion};
use serde::{Deserialize, Serialize};

/// How the companion meets the user's current affect this turn.
///
/// Each variant maps to a modulation rule on `CompanionPersona`'s
/// baseline (see `persona::modulate`) plus a one-line generation hint
/// (`ExpressedStance::to_prompt_hint`).
///
/// Variants are ordered roughly by intensity. `Mirror` is the safe
/// default when confidence is low or signals are mixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum EmpathyStrategy {
    /// Reflect & validate the feeling without intensifying it. Default
    /// for low-to-mid intensity negatives or when confidence is weak.
    #[default]
    Mirror,
    /// User distressed / high-arousal-negative: comfort, lower the
    /// temperature. Must NOT deepen the distress.
    Soothe,
    /// User joyful: share and amplify the good feeling genuinely.
    Celebrate,
    /// User engaged and talking: draw them out, don't redirect.
    /// XiaoIce's "active listening" mode.
    ActiveListen,
    /// User flat / bored / stalled: gently bring energy or a fresh
    /// thread. XiaoIce's "drive" mode.
    Encourage,
    /// Rare, careful: offer a gentle reframe of a harsh self-belief.
    /// Never dismissive; never argues the user out of their feeling.
    GentleReframe,
}

/// Pick a strategy for this turn. Inputs:
/// - `affect`: the perceived user state (eQ).
/// - `user_engagement`: 0.0..=1.0 from `ConversationContext`. Low
///   engagement on flat affect shifts toward `Encourage`; high
///   engagement on positive/negative states shifts toward
///   `ActiveListen`.
///
/// Decision order:
/// 1. Low confidence (< 0.4) → `Mirror`. Don't over-read weak signals.
/// 2. Negative + high-arousal → `Soothe`.
/// 3. Negative + low-arousal → `Mirror`.
/// 4. Positive → `Celebrate`.
/// 5. Flat/bored + low engagement → `Encourage`.
/// 6. High engagement otherwise → `ActiveListen`.
/// 7. Default → `Mirror`.
pub fn select_strategy(affect: &AffectState, user_engagement: f32) -> EmpathyStrategy {
    use UserEmotion::*;

    if affect.confidence < 0.4 {
        return EmpathyStrategy::Mirror;
    }

    let negative_high_arousal = matches!(
        affect.label,
        Some(Anxiety) | Some(Fear) | Some(Overwhelm) | Some(Anger) | Some(Frustration)
    ) && affect.arousal > 0.6;

    if negative_high_arousal {
        return EmpathyStrategy::Soothe;
    }

    let negative_low_arousal =
        matches!(affect.label, Some(Sadness) | Some(Loneliness) | Some(Grief));

    if negative_low_arousal {
        return EmpathyStrategy::Mirror;
    }

    let positive = matches!(
        affect.label,
        Some(Joy) | Some(Excitement) | Some(Affection) | Some(Contentment)
    );

    if positive {
        return EmpathyStrategy::Celebrate;
    }

    let flat = matches!(affect.label, Some(Boredom) | Some(Calm));

    if flat && user_engagement < 0.3 {
        return EmpathyStrategy::Encourage;
    }

    if user_engagement > 0.6 {
        return EmpathyStrategy::ActiveListen;
    }

    EmpathyStrategy::Mirror
}

/// Full appraisal: pick strategy + modulate into an ExpressedStance.
/// One call for callers that don't need to inspect the strategy
/// separately.
pub fn appraise(
    affect: &AffectState,
    persona: &CompanionPersona,
    user_engagement: f32,
) -> ExpressedStance {
    let strategy = select_strategy(affect, user_engagement);
    modulate(strategy, persona, affect.arousal)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn affect(valence: f32, arousal: f32, label: UserEmotion, conf: f32) -> AffectState {
        AffectState {
            valence,
            arousal,
            label: Some(label),
            confidence: conf,
        }
    }

    #[test]
    fn low_confidence_defaults_to_mirror() {
        let a = affect(-0.8, 0.9, UserEmotion::Anxiety, 0.2);
        assert_eq!(select_strategy(&a, 0.5), EmpathyStrategy::Mirror);
    }

    #[test]
    fn high_arousal_negative_picks_soothe() {
        let a = affect(-0.7, 0.85, UserEmotion::Anxiety, 0.8);
        assert_eq!(select_strategy(&a, 0.5), EmpathyStrategy::Soothe);
    }

    #[test]
    fn low_arousal_negative_picks_mirror() {
        let a = affect(-0.6, 0.2, UserEmotion::Sadness, 0.8);
        assert_eq!(select_strategy(&a, 0.5), EmpathyStrategy::Mirror);
    }

    #[test]
    fn positive_picks_celebrate() {
        let a = affect(0.7, 0.8, UserEmotion::Excitement, 0.9);
        assert_eq!(select_strategy(&a, 0.5), EmpathyStrategy::Celebrate);
    }

    #[test]
    fn bored_with_low_engagement_picks_encourage() {
        let a = affect(0.0, 0.15, UserEmotion::Boredom, 0.7);
        assert_eq!(select_strategy(&a, 0.2), EmpathyStrategy::Encourage);
    }

    #[test]
    fn high_engagement_picks_active_listen() {
        let a = affect(0.0, 0.3, UserEmotion::Calm, 0.6);
        assert_eq!(select_strategy(&a, 0.8), EmpathyStrategy::ActiveListen);
    }

    #[test]
    fn appraise_returns_consistent_stance() {
        let a = affect(0.7, 0.8, UserEmotion::Excitement, 0.9);
        let persona = CompanionPersona::default();
        let stance = appraise(&a, &persona, 0.5);
        assert_eq!(stance.strategy, EmpathyStrategy::Celebrate);
        // Celebrate raises both warmth and energy
        assert!(stance.warmth > persona.base_warmth);
        assert!(stance.energy > persona.base_energy);
    }
}
