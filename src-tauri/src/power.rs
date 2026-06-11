//! Keep-awake: hold a system-level "prevent idle sleep" assertion while any
//! agent session is busy (Settings-controlled). Display sleep stays allowed.
//! Spec: docs/superpowers/specs/2026-06-11-keep-awake-remote-standby-design.md
//!
//! Two parts: `PowerState` is the pure decision logic (unit-tested); the
//! holder thread owns the OS handle, because keepawake's Windows backend is
//! thread-bound (`SetThreadExecutionState(ES_CONTINUOUS)`) — the handle must
//! be created AND dropped on the same thread.

use std::time::{Duration, Instant};

/// Hold the assertion for this long after the last session went idle, so
/// back-to-back turns (queued sends, coordinator nudge bursts) don't flap it.
const LINGER: Duration = Duration::from_secs(60);

/// Pure decision state: should the assertion be held right now?
struct PowerState {
    /// The "prevent sleep while running" setting (re-pushed on every launch).
    enabled: bool,
    /// Any engine busy as of the last event/sweep; held through the linger.
    busy: bool,
    /// When a sweep first saw all engines idle (linger anchor).
    idle_since: Option<Instant>,
}

impl Default for PowerState {
    fn default() -> Self {
        // Default ON, matching the frontend default ("weft-keep-awake" !== "0").
        Self { enabled: true, busy: false, idle_since: None }
    }
}

impl PowerState {
    /// A turn just began somewhere: hold immediately.
    fn note_busy(&mut self) {
        self.busy = true;
        self.idle_since = None;
    }

    /// Periodic reconciliation with ground truth + linger expiry.
    fn sweep(&mut self, any_busy: bool, now: Instant) {
        if any_busy {
            self.note_busy();
        } else if self.busy {
            let since = *self.idle_since.get_or_insert(now);
            if now.duration_since(since) >= LINGER {
                self.busy = false;
                self.idle_since = None;
            }
        }
    }

    fn desired(&self) -> bool {
        self.enabled && self.busy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn busy_state() -> PowerState {
        let mut st = PowerState::default();
        st.note_busy();
        st
    }

    #[test]
    fn disabled_never_desires_hold() {
        let mut st = busy_state();
        st.enabled = false;
        assert!(!st.desired());
    }

    #[test]
    fn busy_desires_hold_when_enabled() {
        assert!(busy_state().desired());
        assert!(!PowerState::default().desired());
    }

    #[test]
    fn idle_lingers_then_releases() {
        let mut st = busy_state();
        let t0 = Instant::now();
        st.sweep(false, t0);
        assert!(st.desired(), "still held during linger");
        st.sweep(false, t0 + LINGER - Duration::from_secs(1));
        assert!(st.desired(), "still held just before expiry");
        st.sweep(false, t0 + LINGER);
        assert!(!st.desired(), "released after linger");
    }

    #[test]
    fn busy_during_linger_restarts_anchor() {
        let mut st = busy_state();
        let t0 = Instant::now();
        st.sweep(false, t0);
        st.sweep(true, t0 + Duration::from_secs(30)); // busy again mid-linger
        let t1 = t0 + LINGER + Duration::from_secs(10);
        st.sweep(false, t1); // new linger anchored at t1
        assert!(st.desired(), "linger restarted by the busy sweep");
        st.sweep(false, t1 + LINGER);
        assert!(!st.desired());
    }
}
