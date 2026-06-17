//! Relationship memory — session-scoped affect trajectory + mood
//! baseline.
//!
//! MVP: in-memory only, resets at session start. Cross-session
//! persistence (via sigil ChatMemoryStore or a dedicated affect DB)
//! is a follow-up; the session arc alone already produces noticeable
//! warmth modulation within a single conversation.

use crate::state::AffectState;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// Maximum trajectory readings kept in memory. Older readings are
/// evicted FIFO. 50 ≈ a long session's worth of turns; enough for the
/// mood EMA to stabilize without unbounded growth.
const TRAJECTORY_CAPACITY: usize = 50;

/// In-session relationship state: recent affect readings + a slow mood
/// baseline that the trajectory decays toward.
///
/// The mood baseline uses Exponential Moving Average (EMA) — each new
/// affect reading nudges the baseline by `alpha` (default 0.1, so it
/// takes ~10 readings to mostly absorb a sustained shift). This is the
/// "set point" the companion implicitly works against; a user who's
/// been sad for 20 turns has a low mood baseline and the companion's
/// Mirror responses stay gentle rather than treating each new sad
/// message as a fresh spike.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipMemory {
    /// Fast transient: recent affect readings, newest last. Bounded
    /// at [`TRAJECTORY_CAPACITY`].
    pub trajectory: VecDeque<TimestampedAffect>,
    /// Slow mood baseline (EMA). `None` until the first reading
    /// initializes it.
    pub mood_baseline: Option<AffectState>,
}

impl Default for RelationshipMemory {
    fn default() -> Self {
        Self {
            trajectory: VecDeque::with_capacity(TRAJECTORY_CAPACITY),
            mood_baseline: None,
        }
    }
}

impl RelationshipMemory {
    /// Record a new affect reading. Pushes onto the trajectory
    /// (evicting oldest if at capacity) and updates the mood baseline
    /// via EMA.
    pub fn record(&mut self, at_ms: i64, state: AffectState) {
        if self.trajectory.len() == TRAJECTORY_CAPACITY {
            self.trajectory.pop_front();
        }
        self.trajectory.push_back(TimestampedAffect {
            at: at_ms,
            state: state.clone(),
        });
        self.update_mood(&state, 0.1);
    }

    /// Update the mood baseline using EMA. `alpha` in 0.0..=1.0; small
    /// alpha = slow baseline (good for mood), large alpha = baseline
    /// tracks every reading (not useful, just use the reading).
    pub fn update_mood(&mut self, latest: &AffectState, alpha: f32) {
        let a = alpha.clamp(0.0, 1.0);
        let new_baseline = match &self.mood_baseline {
            None => latest.clone(),
            Some(b) => AffectState {
                valence: b.valence + (latest.valence - b.valence) * a,
                arousal: b.arousal + (latest.arousal - b.arousal) * a,
                label: latest.label,
                confidence: latest.confidence,
            },
        };
        self.mood_baseline = Some(new_baseline);
    }

    /// Decay the latest trajectory reading toward the mood baseline.
    /// Called by the host on idle ticks (e.g. between turns when the
    /// user is reading but not typing) so a stale spike doesn't pin
    /// the companion's stance.
    pub fn decay_latest(&mut self, rate: f32) {
        let Some(baseline) = self.mood_baseline.clone() else {
            return;
        };
        if let Some(last) = self.trajectory.back_mut() {
            last.state.decay_toward(&baseline, rate);
        }
    }

    /// Return the most recent affect reading, or `None` if the
    /// trajectory is empty (caller should fall back to `neutral()`).
    pub fn latest(&self) -> Option<&AffectState> {
        self.trajectory.back().map(|t| &t.state)
    }

    /// True if the user has been in a sustained negative state across
    /// the last `window` readings. Used by the caller (not the affect
    /// crate itself) to decide whether to nudge variety.
    pub fn sustained_negative(&self, window: usize) -> bool {
        let n = self.trajectory.len().min(window);
        if n == 0 {
            return false;
        }
        let recent: Vec<&TimestampedAffect> = self.trajectory.iter().rev().take(n).collect();
        let avg_valence: f32 = recent.iter().map(|t| t.state.valence).sum::<f32>() / n as f32;
        avg_valence < -0.3
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimestampedAffect {
    pub at: i64,
    pub state: AffectState,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::UserEmotion;

    fn affect(v: f32, a: f32) -> AffectState {
        AffectState {
            valence: v,
            arousal: a,
            label: AffectState::classify(v, a),
            confidence: 0.7,
        }
    }

    #[test]
    fn record_initializes_baseline() {
        let mut mem = RelationshipMemory::default();
        assert!(mem.mood_baseline.is_none());
        mem.record(0, affect(0.8, 0.7));
        let baseline = mem.mood_baseline.unwrap();
        assert!((baseline.valence - 0.8).abs() < 1e-3);
    }

    #[test]
    fn record_ema_pulls_baseline_toward_new_state() {
        let mut mem = RelationshipMemory::default();
        mem.record(0, affect(0.8, 0.7));
        mem.record(1, affect(-0.6, 0.2));
        let baseline = mem.mood_baseline.unwrap();
        // After one negative reading at alpha=0.1, baseline should still
        // be positive but lower than the initial 0.8.
        assert!(baseline.valence > 0.0);
        assert!(baseline.valence < 0.8);
    }

    #[test]
    fn trajectory_evicts_oldest_at_capacity() {
        let mut mem = RelationshipMemory::default();
        for i in 0..(TRAJECTORY_CAPACITY + 10) as i64 {
            mem.record(i, affect(0.1, 0.2));
        }
        assert_eq!(mem.trajectory.len(), TRAJECTORY_CAPACITY);
    }

    #[test]
    fn decay_latest_relaxes_spike_toward_baseline() {
        let mut mem = RelationshipMemory::default();
        // Establish a calm baseline.
        for i in 0..10 {
            mem.record(i, affect(0.0, 0.2));
        }
        // Then a sharp negative spike.
        mem.record(11, affect(-0.9, 0.9));
        // Decay should pull the spike back toward the calm baseline.
        for _ in 0..5 {
            mem.decay_latest(0.5);
        }
        let latest = mem.latest().unwrap();
        assert!(latest.valence > -0.9, "decay should have moved valence up");
    }

    #[test]
    fn sustained_negative_detects_long_sad_streak() {
        let mut mem = RelationshipMemory::default();
        for i in 0..8 {
            mem.record(i, affect(-0.6, 0.2));
        }
        assert!(mem.sustained_negative(5));
    }

    #[test]
    fn sustained_negative_rejects_short_blip() {
        let mut mem = RelationshipMemory::default();
        for i in 0..10 {
            mem.record(i, affect(0.5, 0.5));
        }
        mem.record(11, affect(-0.6, 0.2));
        assert!(!mem.sustained_negative(5));
    }
}
