//! User affect state — the `eQ` analog (XiaoIce empathy vector for the
//! user's emotional state this turn).
//!
//! Dimensional model (valence + arousal) is source of truth; the discrete
//! `UserEmotion` label is derived for convenience and appraisal logic.

use serde::{Deserialize, Serialize};

/// The user's inferred emotional state this turn.
///
/// Valence + arousal are the source of truth (dimensional model). The
/// discrete `label` is derived via [`AffectState::classify`] for
/// convenience in appraisal match arms. `confidence` gates how strongly
/// the appraisal leans on the label — low confidence stays at safe
/// defaults instead of over-reading a sparse signal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AffectState {
    /// -1.0 (negative) ..= 1.0 (positive)
    pub valence: f32,
    /// 0.0 (calm) ..= 1.0 (activated)
    pub arousal: f32,
    /// Discrete label, derived from valence/arousal. `None` only when
    /// the dimensional values land in an unclassified band.
    pub label: Option<UserEmotion>,
    /// 0.0..=1.0. Low confidence ⇒ stay neutral/gentle, don't over-read.
    pub confidence: f32,
}

impl Default for AffectState {
    fn default() -> Self {
        Self::neutral()
    }
}

impl AffectState {
    /// Calm-neutral baseline. Appraisal falls back to this when signals
    /// are absent or confidence is too low to commit to a label.
    pub fn neutral() -> Self {
        Self {
            valence: 0.0,
            arousal: 0.2,
            label: Some(UserEmotion::Calm),
            confidence: 0.5,
        }
    }

    /// Emotion is a fast transient over a slow mood baseline. Relax
    /// toward baseline across idle time / turns so the companion
    /// doesn't cling to a stale spike.
    ///
    /// `rate` is the per-call relaxation factor in `0.0..=1.0`. Typical
    /// values: `0.05` per idle minute, `0.15` per turn of normal chat,
    /// `0.30` when the user explicitly changes topic.
    pub fn decay_toward(&mut self, baseline: &AffectState, rate: f32) {
        let r = rate.clamp(0.0, 1.0);
        self.valence += (baseline.valence - self.valence) * r;
        self.arousal += (baseline.arousal - self.arousal) * r;
        self.label = Self::classify(self.valence, self.arousal);
    }

    /// Map a (valence, arousal) pair to a discrete emotion.
    ///
    /// Quadrants:
    /// - low valence / high arousal  → Anxiety / Fear / Anger (we pick
    ///   Anxiety as the default high-arousal-negative; appraisal can
    ///   refine via separate signals)
    /// - low valence / low arousal   → Sadness / Loneliness
    /// - high valence / high arousal → Excitement / Joy
    /// - high valence / low arousal  → Contentment / Calm
    ///
    /// Dead band around `|valence| < 0.15` returns `Calm` to avoid
    /// flipping on noise. Thresholds chosen so `neutral()` classifies
    /// as `Calm`.
    pub fn classify(valence: f32, arousal: f32) -> Option<UserEmotion> {
        let v = valence.clamp(-1.0, 1.0);
        let a = arousal.clamp(0.0, 1.0);
        let positive = v >= 0.15;
        let negative = v <= -0.15;
        let activated = a >= 0.55;
        match (positive, negative, activated) {
            (true, false, true) => Some(UserEmotion::Excitement),
            (true, false, false) => Some(UserEmotion::Contentment),
            (false, true, true) => Some(UserEmotion::Anxiety),
            (false, true, false) => Some(UserEmotion::Sadness),
            // dead band or contradicting flags — fall back to calm
            _ => Some(UserEmotion::Calm),
        }
    }
}

/// Broader emotion set than the trading-agent affect module — companions
/// meet the full range of human affect.
///
/// Variants stay coarse on purpose: appraisal logic switches on these,
/// and fine-grained distinctions (frustration vs anger, grief vs sadness)
/// are downstream of the appraisal strategy, not part of the label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum UserEmotion {
    Joy,
    Excitement,
    Contentment,
    Calm,
    Affection,
    Sadness,
    Loneliness,
    Grief,
    Anxiety,
    Fear,
    Overwhelm,
    Anger,
    Frustration,
    Boredom,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_classifies_as_calm() {
        let s = AffectState::neutral();
        assert_eq!(s.label, Some(UserEmotion::Calm));
        assert!((s.confidence - 0.5).abs() < 1e-6);
    }

    #[test]
    fn classify_quadrants() {
        assert_eq!(
            AffectState::classify(0.8, 0.9),
            Some(UserEmotion::Excitement)
        );
        assert_eq!(
            AffectState::classify(0.6, 0.2),
            Some(UserEmotion::Contentment)
        );
        assert_eq!(AffectState::classify(-0.7, 0.8), Some(UserEmotion::Anxiety));
        assert_eq!(AffectState::classify(-0.6, 0.1), Some(UserEmotion::Sadness));
    }

    #[test]
    fn classify_dead_band_returns_calm() {
        // Inside |valence| < 0.15 the classifier refuses to commit.
        assert_eq!(AffectState::classify(0.0, 0.2), Some(UserEmotion::Calm));
        assert_eq!(AffectState::classify(0.1, 0.9), Some(UserEmotion::Calm));
        assert_eq!(AffectState::classify(-0.1, 0.5), Some(UserEmotion::Calm));
    }

    #[test]
    fn decay_relaxes_toward_baseline() {
        let mut spike = AffectState {
            valence: -0.9,
            arousal: 0.95,
            label: Some(UserEmotion::Anxiety),
            confidence: 0.9,
        };
        let baseline = AffectState::neutral();
        // One decay step at rate=0.5 should move halfway.
        spike.decay_toward(&baseline, 0.5);
        assert!((spike.valence - -0.45).abs() < 1e-3);
        assert!((spike.arousal - 0.575).abs() < 1e-3);
        // After enough steps, label should flip back to Calm.
        for _ in 0..10 {
            spike.decay_toward(&baseline, 0.5);
        }
        assert_eq!(spike.label, Some(UserEmotion::Calm));
    }

    #[test]
    fn decay_rate_is_clamped() {
        let mut s = AffectState {
            valence: 1.0,
            arousal: 1.0,
            label: Some(UserEmotion::Excitement),
            confidence: 1.0,
        };
        let baseline = AffectState::neutral();
        // Negative rate should be clamped to 0 — no movement.
        s.decay_toward(&baseline, -0.5);
        assert!((s.valence - 1.0).abs() < 1e-6);
        // Rate > 1 clamps to 1 — jumps straight to baseline.
        s.decay_toward(&baseline, 5.0);
        assert!((s.valence - baseline.valence).abs() < 1e-6);
    }
}
