//! Portage isolé des règles G6u, sans accès aux flux et sans changement de lecteur.
//! Une proposition n'est jamais une commutation effective : le lecteur doit
//! certifier segments, horloges et droits avant de confirmer la bascule.
#![allow(dead_code)]

const COOLDOWN_MS: u64 = 7_000;
const MIN_BUFFER_UPGRADE_MS: u64 = 10_000;
const LOW_BUFFER_MS: u64 = 4_000;
const REQUIRED_GOOD_SAMPLES: u8 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Manual,
    Auto,
}

#[derive(Clone, Copy, Debug)]
pub struct Rendition {
    pub id: u32,
    pub bitrate_bps: u64,
    pub master_id: u64,
    pub timeline_aligned: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Measurement {
    pub capacity_bps: u64,
    pub buffer_ms: u64,
    pub monotonic_ms: u64,
    pub epoch: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Keep,
    PrepareLower(usize),
    PrepareHigher(usize),
}

#[derive(Debug)]
pub struct QualityPolicy {
    pub mode: Mode,
    pub active: usize,
    paused: bool,
    stable_fast_samples: u8,
    failed_candidates: u8,
    last_attempt_ms: Option<u64>,
    current_epoch: Option<u64>,
    pending: Option<usize>,
}

impl QualityPolicy {
    pub fn new(active: usize) -> Self {
        Self {
            mode: Mode::Manual,
            active,
            paused: false,
            stable_fast_samples: 0,
            failed_candidates: 0,
            last_attempt_ms: None,
            current_epoch: None,
            pending: None,
        }
    }

    pub fn set_manual(&mut self, active: usize) {
        self.mode = Mode::Manual;
        self.active = active;
        self.pending = None;
        self.stable_fast_samples = 0;
    }

    pub fn select_auto(&mut self) {
        self.mode = Mode::Auto;
        self.failed_candidates = 0;
        self.pending = None;
        self.current_epoch = None;
        self.stable_fast_samples = 0;
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
        if paused {
            self.pending = None;
            self.stable_fast_samples = 0;
        }
    }

    fn compatible(a: Rendition, b: Rendition) -> bool {
        a.timeline_aligned && b.timeline_aligned &&
            a.master_id == b.master_id &&
            a.master_id != 0 && a.id != b.id
    }

    pub fn evaluate(&mut self, options: &[Rendition], sample: Measurement) -> Decision {
        if self.mode != Mode::Auto || self.paused || self.pending.is_some() ||
           self.failed_candidates >= 2 || self.active >= options.len() ||
           sample.capacity_bps == 0 || options.is_empty() {
            return Decision::Keep;
        }
        if !options.iter().all(|r| r.bitrate_bps > 0 && r.master_id > 0) ||
           !options.windows(2).all(|r| r[0].bitrate_bps < r[1].bitrate_bps) {
            return Decision::Keep;
        }
        if self.current_epoch != Some(sample.epoch) {
            self.current_epoch = Some(sample.epoch);
            self.stable_fast_samples = 0;
        }
        if let Some(last) = self.last_attempt_ms {
            if sample.monotonic_ms.saturating_sub(last) < COOLDOWN_MS {
                return Decision::Keep;
            }
        }
        let current = options[self.active];
        // A downshift is selected before any attempt to promote quality.
        let risk = sample.buffer_ms < LOW_BUFFER_MS ||
            (u128::from(sample.capacity_bps) * 100 <
             u128::from(current.bitrate_bps) * 115);
        if risk && self.active > 0 {
            let lower = self.active - 1;
            if Self::compatible(current, options[lower]) {
                self.pending = Some(lower);
                self.last_attempt_ms = Some(sample.monotonic_ms);
                self.stable_fast_samples = 0;
                return Decision::PrepareLower(lower);
            }
        }

        if !risk && self.active + 1 < options.len() {
            let higher = self.active + 1;
            let next = options[higher];
            let enough_capacity = u128::from(sample.capacity_bps) * 100 >=
                u128::from(next.bitrate_bps) * 165;
            if Self::compatible(current, next) && enough_capacity &&
                sample.buffer_ms >= MIN_BUFFER_UPGRADE_MS {
                self.stable_fast_samples = self.stable_fast_samples.saturating_add(1);
                if self.stable_fast_samples >= REQUIRED_GOOD_SAMPLES {
                    self.stable_fast_samples = 0;
                    self.pending = Some(higher);
                    self.last_attempt_ms = Some(sample.monotonic_ms);
                    return Decision::PrepareHigher(higher);
                }
            } else {
                self.stable_fast_samples = 0;
            }
        }
        Decision::Keep
    }

    /// Called **only** after independently checking segment identity,
    /// decoded PCM continuity, audio/video clocks and a reversible switch.
    pub fn confirm_transition(&mut self, target: usize, verified: bool) -> bool {
        if self.pending != Some(target) {
            return false;
        }
        self.pending = None;
        if verified {
            self.active = target;
            self.failed_candidates = 0;
        } else {
            self.failed_candidates = self.failed_candidates.saturating_add(1);
            if self.failed_candidates >= 2 {
                self.mode = Mode::Manual;
            }
        }
        verified
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPTIONS: [Rendition; 3] = [
        Rendition { id: 1, bitrate_bps: 800_000, master_id: 3, timeline_aligned: true },
        Rendition { id: 2, bitrate_bps: 2_000_000, master_id: 3, timeline_aligned: true },
        Rendition { id: 3, bitrate_bps: 7_000_000, master_id: 3, timeline_aligned: true },
    ];
    fn sample(capacity_bps: u64, buffer_ms: u64, time: u64) -> Measurement {
        Measurement { capacity_bps, buffer_ms, monotonic_ms: time, epoch: 1 }
    }

    #[test]
    fn manual_mode_never_auto_switches() {
        let mut p = QualityPolicy::new(0);
        for _ in 0..6 {
            assert_eq!(p.evaluate(&OPTIONS, sample(30_000_000, 20000, 0)), Decision::Keep);
        }
    }

    #[test]
    fn auto_needs_stable_capacity_and_verified_handover() {
        let mut p = QualityPolicy::new(0);
        p.select_auto();
        assert_eq!(p.evaluate(&OPTIONS, sample(6_000_000, 15000, 0)), Decision::Keep);
        assert_eq!(p.evaluate(&OPTIONS, sample(6_000_000, 15000, 1000)), Decision::Keep);
        assert_eq!(p.evaluate(&OPTIONS, sample(6_000_000, 15000, 2000)), Decision::PrepareHigher(1));
        assert_eq!(p.active, 0, "suggestion does not touch the real video");
        assert!(!p.confirm_transition(2, true), "no arbitrary source injection");
        assert!(p.confirm_transition(1, true));
        assert_eq!(p.active, 1);
    }

    #[test]
    fn cross_master_and_unaligned_sources_are_forbidden() {
        let mut profiles = OPTIONS;
        profiles[1].master_id = 99;
        let mut p = QualityPolicy::new(0);
        p.select_auto();
        for i in 0..5 {
            assert_eq!(p.evaluate(&profiles, sample(20_000_000, 20000, i*1000)), Decision::Keep);
        }
        profiles[1].master_id = 3;
        profiles[1].timeline_aligned = false;
        for i in 0..5 {
            assert_eq!(p.evaluate(&profiles, sample(20_000_000, 20000, 10000+i*1000)), Decision::Keep);
        }
    }

    #[test]
    fn bad_network_prefers_lower_and_pause_never_changes_player() {
        let mut p = QualityPolicy::new(1);
        p.select_auto();
        p.set_paused(true);
        assert_eq!(p.evaluate(&OPTIONS, sample(500_000, 900, 100)), Decision::Keep);
        p.set_paused(false);
        assert_eq!(p.evaluate(&OPTIONS, sample(500_000, 900, 200)), Decision::PrepareLower(0));
        assert_eq!(p.active, 1);
        assert!(p.confirm_transition(0, true));
        assert_eq!(p.active, 0);
    }

    #[test]
    fn failed_candidates_cooldown_and_two_fail_closed() {
        let mut p = QualityPolicy::new(0);
        p.select_auto();
        for i in 0..3 { p.evaluate(&OPTIONS, sample(12_000_000, 16000, i*1000)); }
        assert!(!p.confirm_transition(1, false));
        assert_eq!(p.active, 0);
        assert_eq!(p.evaluate(&OPTIONS, sample(12_000_000, 16000, 2500)), Decision::Keep);
        for i in 0..3 {
            let d=p.evaluate(&OPTIONS, sample(12_000_000, 16000, 9500+i*1000));
            if i==2 { assert_eq!(d, Decision::PrepareHigher(1)); }
        }
        assert!(!p.confirm_transition(1, false));
        assert_eq!(p.mode, Mode::Manual);
        assert_eq!(p.evaluate(&OPTIONS, sample(12_000_000, 16000, 20000)), Decision::Keep);
        p.select_auto();  // explicit user reset
        assert_eq!(p.mode, Mode::Auto);
    }

    #[test]
    fn new_network_epoch_and_corrupt_ladder_reset_observation() {
        let mut p=QualityPolicy::new(0);
        p.select_auto();
        assert_eq!(p.evaluate(&OPTIONS, sample(15_000_000, 14000, 1000)), Decision::Keep);
        let mut switched=sample(15_000_000, 14000, 2000);
        switched.epoch=2;
        assert_eq!(p.evaluate(&OPTIONS, switched), Decision::Keep);
        let mut bad=OPTIONS;
        bad[1].bitrate_bps=500_000;
        assert_eq!(p.evaluate(&bad, sample(30_000_000, 14000, 9000)), Decision::Keep);
    }
}
