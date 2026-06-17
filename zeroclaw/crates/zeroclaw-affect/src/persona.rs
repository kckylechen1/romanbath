//! Companion persona + expressed stance — the `eR` analog (XiaoIce
//! empathy vector for the companion's response, derived from user
//! affect + a stable persona).

use crate::appraisal::EmpathyStrategy;
use serde::{Deserialize, Serialize};

/// Stable companion identity. The archetype + baseline warmth/energy
/// anchor every response — modulations stay close to the baseline so
/// the companion doesn't drift in tone across turns.
///
/// `CompanionPersona` covers only the *affective* axes (warmth, energy,
/// archetype). The character's name, backstory, system prompt etc.
/// remain on the character card — this is a complementary struct that
/// rides alongside, typically loaded from
/// `character_card.extensions.companion`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionPersona {
    pub name: String,
    pub archetype: Archetype,
    /// Stable baseline warmth (0.0..=1.0). Stance warmth modulates
    /// around this; stays within ±0.2 unless the strategy demands more.
    pub base_warmth: f32,
    /// Stable baseline energy (0.0..=1.0). Matches `base_warmth` by
    /// default; some archetypes (Playful) run hotter on energy than
    /// warmth by design.
    pub base_energy: f32,
}

impl Default for CompanionPersona {
    fn default() -> Self {
        Self {
            name: "Companion".to_string(),
            archetype: Archetype::Nurturing,
            base_warmth: 0.6,
            base_energy: 0.5,
        }
    }
}

impl CompanionPersona {
    /// Convenience: archetypal defaults so the caller doesn't have to
    /// hand-tune warmth/energy. Override individual fields after.
    pub fn for_archetype(name: impl Into<String>, archetype: Archetype) -> Self {
        let (warmth, energy) = match archetype {
            Archetype::Nurturing => (0.7, 0.4),
            Archetype::Playful => (0.6, 0.8),
            Archetype::Steady => (0.5, 0.3),
        };
        Self {
            name: name.into(),
            archetype,
            base_warmth: warmth,
            base_energy: energy,
        }
    }
}

/// Livia's Fire / Water / Earth archetypes, generalized. The archetype
/// picks default (warmth, energy) and biases how strongly each strategy
/// modulates the stance.
///
/// Pick is per-user at onboarding; stored on the persona. The user can
/// change it later — the persona is mutable state, not character card
/// identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Archetype {
    /// High warmth, lower energy. Good default for emotionally heavy
    /// conversations; soothes by presence rather than activity.
    #[default]
    Nurturing,
    /// Moderate warmth, high energy. Lifts lows without dismissing them;
    /// shares highs generously.
    Playful,
    /// Even warmth, even energy. Reliable, undramatic; preferred for
    /// users who don't want the companion's mood to swing.
    Steady,
}

/// The companion's expressed stance for this turn. Computed by
/// [`crate::appraise`] from the user's [`crate::AffectState`] + the
/// [`CompanionPersona`] baseline + the chosen [`EmpathyStrategy`].
///
/// `warmth` and `energy` are the dimensional modulation that conditions
/// generation; `strategy` is the discrete choice the LLM is told to
/// apply (mirror / soothe / celebrate / etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpressedStance {
    /// 0.0..=1.0. Clamped to ±0.2 of `persona.base_warmth` unless the
    /// strategy explicitly demands more (e.g. Soothe raises warmth
    /// further, Celebrate raises both).
    pub warmth: f32,
    /// 0.0..=1.0. Match-the-user (Mirror, ActiveListen) or complement
    /// (Soothe lowers, Celebrate raises) depending on strategy.
    pub energy: f32,
    pub strategy: EmpathyStrategy,
}

impl ExpressedStance {
    /// Clamp into the valid [0, 1] range after arithmetic.
    fn clamp(self) -> Self {
        Self {
            warmth: self.warmth.clamp(0.0, 1.0),
            energy: self.energy.clamp(0.0, 1.0),
            strategy: self.strategy,
        }
    }

    /// Build the system-prompt hint that conditions generation. This is
    /// what gets appended to the existing character-card system prompt
    /// (per the "supplement, don't replace" integration policy).
    ///
    /// The hint is intentionally compact — character card authors put
    /// work into their prompt; we don't want to bury it under a wall
    /// of affect-management text. The LLM gets enough to modulate,
    /// not enough to dominate.
    pub fn to_prompt_hint(&self) -> String {
        let strategy_guidance = match self.strategy {
            EmpathyStrategy::Mirror => {
                "Reflect the user's emotional register without intensifying it. \
                 Acknowledge the feeling; don't amplify it."
            }
            EmpathyStrategy::Soothe => {
                "Lower the temperature. Warm, present, grounded. Comfort \
                 without adding ruminative detail."
            }
            EmpathyStrategy::Celebrate => {
                "Share the user's positive affect genuinely. Match their \
                 energy without overshadowing them."
            }
            EmpathyStrategy::ActiveListen => {
                "Draw the user out. Ask one good follow-up; don't redirect. \
                 Treat their thread as the topic."
            }
            EmpathyStrategy::Encourage => {
                "Gently raise the energy. Offer a small reframe or a fresh \
                 thread — never dismissive of whatever made the user flat."
            }
            EmpathyStrategy::GentleReframe => {
                "Offer one careful reframe of a harsh self-belief. Stay close \
                 to the feeling; never argue the user out of it."
            }
        };
        format!(
            "[affect] warmth={:.2} energy={:.2} strategy={:?}\n{}",
            self.warmth, self.energy, self.strategy, strategy_guidance
        )
    }
}

/// Helper for appraisal: produce a stance from (strategy, persona)
/// applying the strategy's modulation rules. Defined here next to the
/// stance type so the arithmetic is auditable in one place.
pub fn modulate(
    strategy: EmpathyStrategy,
    persona: &CompanionPersona,
    user_arousal: f32,
) -> ExpressedStance {
    use EmpathyStrategy::*;
    let (warmth, energy) = match strategy {
        Mirror => (
            persona.base_warmth,
            persona.base_energy.lerp(user_arousal, 0.5),
        ),
        Soothe => (persona.base_warmth + 0.15, persona.base_energy * 0.6),
        Celebrate => (persona.base_warmth + 0.1, persona.base_energy + 0.2),
        ActiveListen => (
            persona.base_warmth,
            persona.base_energy.lerp(user_arousal, 0.3),
        ),
        Encourage => (persona.base_warmth, persona.base_energy + 0.15),
        GentleReframe => (persona.base_warmth + 0.05, persona.base_energy * 0.8),
    };
    ExpressedStance {
        warmth,
        energy,
        strategy,
    }
    .clamp()
}

/// Float lerp extension local to this crate. Can't depend on an
/// external crate for one operation.
trait LerpExt {
    fn lerp(self, other: f32, t: f32) -> f32;
}

impl LerpExt for f32 {
    fn lerp(self, other: f32, t: f32) -> f32 {
        self + (other - self) * t.clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archetype_defaults_are_distinct() {
        let n = CompanionPersona::for_archetype("A", Archetype::Nurturing);
        let p = CompanionPersona::for_archetype("B", Archetype::Playful);
        let s = CompanionPersona::for_archetype("C", Archetype::Steady);
        assert!(n.base_warmth > s.base_warmth);
        assert!(p.base_energy > n.base_energy);
    }

    #[test]
    fn modulate_clamps_to_unit_range() {
        // Persona with extreme baselines + Celebrate (raises both)
        // should still clamp inside [0, 1].
        let persona = CompanionPersona {
            name: "X".into(),
            archetype: Archetype::Playful,
            base_warmth: 0.95,
            base_energy: 0.95,
        };
        let stance = modulate(EmpathyStrategy::Celebrate, &persona, 0.9);
        assert!(stance.warmth <= 1.0);
        assert!(stance.energy <= 1.0);
    }

    #[test]
    fn soothe_lowers_energy_regardless_of_user_arousal() {
        let persona = CompanionPersona::default();
        let stance = modulate(EmpathyStrategy::Soothe, &persona, 0.95);
        assert!(stance.energy < persona.base_energy);
        assert!(stance.warmth > persona.base_warmth);
    }

    #[test]
    fn prompt_hint_includes_strategy_and_dimensions() {
        let stance = ExpressedStance {
            warmth: 0.7,
            energy: 0.3,
            strategy: EmpathyStrategy::Mirror,
        };
        let hint = stance.to_prompt_hint();
        assert!(hint.contains("[affect]"));
        assert!(hint.contains("warmth=0.70"));
        assert!(hint.contains("strategy=Mirror"));
    }

    #[test]
    fn lerp_clamps_t() {
        assert_eq!(0.5_f32.lerp(1.0, -1.0), 0.5);
        assert_eq!(0.5_f32.lerp(1.0, 5.0), 1.0);
        assert!((0.5_f32.lerp(1.0, 0.5) - 0.75).abs() < 1e-6);
    }
}
