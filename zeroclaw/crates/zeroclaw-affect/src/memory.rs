//! Relationship memory — affect trajectory, mood baseline, and bond
//! state for tone/reminder-only prompt conditioning.
//!
//! MVP: in-memory only, resets at session start. Cross-session
//! persistence (via sigil ChatMemoryStore or a dedicated affect DB)
//! is a follow-up; the session arc alone already produces noticeable
//! warmth modulation within a single conversation.

use crate::state::AffectState;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fmt;

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
    #[serde(default)]
    pub trajectory: VecDeque<TimestampedAffect>,
    /// Slow mood baseline (EMA). `None` until the first reading
    /// initializes it.
    #[serde(default)]
    pub mood_baseline: Option<AffectState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipBond {
    #[serde(default)]
    pub closeness: f32,
    #[serde(default = "default_trust")]
    pub trust: f32,
    #[serde(default)]
    pub interaction_count: u64,
    #[serde(default)]
    pub days_interacted: u64,
    #[serde(default = "default_gain_day")]
    pub daily_gain_day: i64,
    #[serde(default)]
    pub daily_gain: f32,
    #[serde(default)]
    pub first_interaction_ms: i64,
    #[serde(default)]
    pub last_interaction_ms: i64,
}

impl Default for RelationshipBond {
    fn default() -> Self {
        Self {
            closeness: 0.0,
            trust: 0.5,
            interaction_count: 0,
            days_interacted: 0,
            daily_gain_day: default_gain_day(),
            daily_gain: 0.0,
            first_interaction_ms: 0,
            last_interaction_ms: 0,
        }
    }
}

impl RelationshipBond {
    pub fn record_turn(&mut self, at_ms: i64, affect: &AffectState) {
        const DAILY_CLOSENESS_CAP: f32 = 0.06;

        self.interaction_count += 1;
        self.last_interaction_ms = at_ms;
        if self.first_interaction_ms == 0 {
            self.first_interaction_ms = at_ms;
        }

        let w = affect.confidence;
        let v = affect.valence;

        let day = at_ms.div_euclid(86_400_000);
        if day != self.daily_gain_day {
            self.daily_gain_day = day;
            self.daily_gain = 0.0;
            self.days_interacted += 1;
        }

        let gain = (0.02 * v.abs() * w)
            .min(DAILY_CLOSENESS_CAP - self.daily_gain)
            .max(0.0);
        self.closeness = (self.closeness + gain).clamp(0.0, 1.0);
        self.daily_gain += gain;
    }

    pub fn stage(&self) -> BondStage {
        if self.closeness < 0.15 || self.days_interacted < 2 {
            BondStage::Stranger
        } else if self.closeness < 0.35 || self.days_interacted < 7 {
            BondStage::Acquaintance
        } else if self.closeness < 0.6 {
            BondStage::Friend
        } else if self.closeness < 0.85 {
            BondStage::Close
        } else {
            BondStage::Intimate
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BondStage {
    Stranger,
    Acquaintance,
    Friend,
    Close,
    Intimate,
}

impl BondStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stranger => "Stranger",
            Self::Acquaintance => "Acquaintance",
            Self::Friend => "Friend",
            Self::Close => "Close",
            Self::Intimate => "Intimate",
        }
    }
}

impl fmt::Display for BondStage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AffectSnapshot {
    #[serde(default = "default_snapshot_version")]
    pub version: u32,
    #[serde(default)]
    pub relationship: RelationshipMemory,
    #[serde(default)]
    pub bond: RelationshipBond,
    #[serde(default)]
    pub updated_at_ms: i64,
}

impl Default for AffectSnapshot {
    fn default() -> Self {
        Self {
            version: 1,
            relationship: RelationshipMemory::default(),
            bond: RelationshipBond::default(),
            updated_at_ms: 0,
        }
    }
}

impl AffectSnapshot {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }

    pub fn from_json(v: &serde_json::Value) -> Option<Self> {
        serde_json::from_value(v.clone()).ok()
    }

    pub fn apply_idle_decay(&mut self, now_ms: i64) {
        let hours = ((now_ms - self.updated_at_ms).max(0)) as f32 / 3_600_000.0;
        self.relationship.decay_latest(1.0 - (-hours / 2.0).exp());
        if let Some(baseline) = &mut self.relationship.mood_baseline {
            baseline.decay_toward(&AffectState::neutral(), 1.0 - (-hours / 72.0).exp());
        }
    }

    pub fn record_turn(&mut self, at_ms: i64, affect: &AffectState) {
        let prev_valence = self.relationship.latest().map(|s| s.valence);
        self.relationship.record(at_ms, affect.clone());
        self.bond.record_turn(at_ms, affect);
        // Trust only rises when the companion measurably helps repair a low
        // mood. Trust loss is deferred until companion-directed negativity is
        // detectable; user sadness should not be treated as distrust.
        if let Some(pv) = prev_valence
            && pv <= -0.3
            && affect.valence >= pv + 0.3
        {
            self.bond.trust = (self.bond.trust + 0.01 * affect.confidence).clamp(0.0, 1.0);
        }
        self.updated_at_ms = at_ms;
    }

    pub fn mood_hint(&self) -> Option<String> {
        let low_baseline = self
            .relationship
            .mood_baseline
            .as_ref()
            .is_some_and(|b| b.valence < -0.25);
        if self.relationship.sustained_negative(5) || low_baseline {
            Some(
                "[mood] The user's recent baseline has been low. Keep continuity of care — acknowledge what lingers; don't reset to cheerful."
                    .to_string(),
            )
        } else {
            None
        }
    }

    pub fn bond_hint(&self) -> Option<String> {
        let stage = self.bond.stage();
        if stage == BondStage::Stranger {
            None
        } else {
            Some(format!(
                "[bond] Relationship stage: {}. {} prior interactions. Let familiarity match this stage — no more, no less.",
                stage.as_str(),
                self.bond.interaction_count
            ))
        }
    }
}

fn default_trust() -> f32 {
    0.5
}

fn default_gain_day() -> i64 {
    -1
}

fn default_snapshot_version() -> u32 {
    1
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

    fn affect(v: f32, a: f32) -> AffectState {
        AffectState {
            valence: v,
            arousal: a,
            label: AffectState::classify(v, a),
            confidence: 0.7,
        }
    }

    fn affect_with_confidence(v: f32, a: f32, confidence: f32) -> AffectState {
        AffectState {
            valence: v,
            arousal: a,
            label: AffectState::classify(v, a),
            confidence,
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

    #[test]
    fn bond_stage_progresses_with_positive_turns() {
        let mut snapshot = AffectSnapshot::default();
        assert_eq!(snapshot.bond.stage(), BondStage::Stranger);
        let positive = affect_with_confidence(0.8, 0.7, 0.9);

        for day in 0..30 {
            snapshot.record_turn(day * 86_400_000 + 1, &positive);
        }

        assert_eq!(snapshot.bond.days_interacted, 30);
        assert!(snapshot.bond.closeness > 0.3);
        assert!(snapshot.bond.closeness <= 1.0);
        assert_ne!(snapshot.bond.stage(), BondStage::Stranger);
    }

    #[test]
    fn trust_rises_only_on_mood_repair() {
        let mut snapshot = AffectSnapshot::default();
        snapshot.record_turn(1, &affect_with_confidence(-0.6, 0.6, 0.9));
        assert_eq!(snapshot.bond.trust, 0.5);

        snapshot.record_turn(2, &affect_with_confidence(0.1, 0.3, 0.9));
        assert!(snapshot.bond.trust > 0.5);

        let trust = snapshot.bond.trust;
        snapshot.record_turn(3, &affect_with_confidence(-0.9, 0.9, 1.0));
        assert_eq!(snapshot.bond.trust, trust);
    }

    #[test]
    fn confiding_sadness_builds_closeness() {
        let mut snapshot = AffectSnapshot::default();
        snapshot.record_turn(1, &affect_with_confidence(-0.8, 0.7, 0.9));

        assert!(snapshot.bond.closeness > 0.0);
        assert!((snapshot.bond.closeness - 0.0144).abs() < 1e-6);
    }

    #[test]
    fn daily_cap_blocks_love_bombing() {
        let mut snapshot = AffectSnapshot::default();
        let excited = affect_with_confidence(1.0, 0.9, 1.0);

        for turn in 1..=60 {
            snapshot.record_turn(turn * 1_000, &excited);
        }

        assert!((snapshot.bond.closeness - 0.06).abs() < 1e-6);
        assert_eq!(snapshot.bond.days_interacted, 1);
        assert_eq!(snapshot.bond.stage(), BondStage::Stranger);
    }

    #[test]
    fn idle_decay_relaxes_mood_not_bond() {
        let now = 86_400_000;
        let mut snapshot = AffectSnapshot {
            updated_at_ms: 0,
            ..Default::default()
        };
        for i in 0..10 {
            snapshot.relationship.record(i, AffectState::neutral());
        }
        snapshot
            .relationship
            .record(10, affect_with_confidence(-0.9, 0.9, 0.9));
        snapshot.bond.closeness = 0.7;

        snapshot.apply_idle_decay(now);

        assert!(snapshot.relationship.latest().unwrap().valence > -0.5);
        assert_eq!(snapshot.bond.closeness, 0.7);
    }

    #[test]
    fn snapshot_json_round_trip() {
        let mut snapshot = AffectSnapshot {
            updated_at_ms: 1234,
            ..Default::default()
        };
        snapshot.bond.closeness = 0.42;
        snapshot.bond.trust = 0.67;
        snapshot.bond.interaction_count = 9;
        snapshot.bond.days_interacted = 3;
        snapshot.relationship.record(1, affect(0.4, 0.3));
        snapshot.relationship.record(2, affect(-0.2, 0.4));

        let parsed = AffectSnapshot::from_json(&snapshot.to_json()).unwrap();

        assert_eq!(parsed.bond.closeness, snapshot.bond.closeness);
        assert_eq!(parsed.bond.trust, snapshot.bond.trust);
        assert_eq!(
            parsed.bond.interaction_count,
            snapshot.bond.interaction_count
        );
        assert_eq!(parsed.bond.days_interacted, snapshot.bond.days_interacted);
        assert_eq!(parsed.updated_at_ms, snapshot.updated_at_ms);
        assert_eq!(
            parsed.relationship.trajectory.len(),
            snapshot.relationship.trajectory.len()
        );
    }

    #[test]
    fn bond_hint_gated_by_stage() {
        assert!(AffectSnapshot::default().bond_hint().is_none());

        let mut snapshot = AffectSnapshot::default();
        snapshot.bond.closeness = 0.5;
        snapshot.bond.interaction_count = 30;
        snapshot.bond.days_interacted = 30;

        assert!(snapshot.bond_hint().unwrap().contains("Friend"));
    }
}
