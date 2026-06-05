//! Consumes bus Wake events and nudges the target direction's live session to
//! read its inbox. Rate-limited per direction. Relies on the agent TUIs queueing
//! mid-turn input (the wake runs after the current turn) rather than fragile idle
//! detection — this is the honest "push" half of bus + coordinator = near-realtime.

use crate::bus::Wake;
use crate::pty::PtyState;
use std::collections::HashMap;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const WAKE_PROMPT: &str =
    "You have new messages on the thread bus. Call the bus_inbox tool to read them.\r";
const RATE_LIMIT: Duration = Duration::from_secs(8);

/// Run the coordinator loop on a dedicated OS thread (the mpsc Receiver is
/// blocking). `app` provides access to the managed `PtyState`.
pub fn run(app: AppHandle, rx: Receiver<Wake>) {
    std::thread::spawn(move || {
        let mut last: HashMap<i32, Instant> = HashMap::new();
        while let Ok(w) = rx.recv() {
            // The bus identity is a direction id as a string; ignore non-numeric
            // targets (e.g. a human "you" never registers as a member anyway).
            let Ok(dir) = w.dir.parse::<i32>() else {
                continue;
            };
            let now = Instant::now();
            if let Some(t) = last.get(&dir) {
                if now.duration_since(*t) < RATE_LIMIT {
                    continue; // rate-limited: don't spam the agent
                }
            }
            let Some(state) = app.try_state::<PtyState>() else {
                continue;
            };
            if state.wake_direction(dir, WAKE_PROMPT) {
                last.insert(dir, now);
            }
        }
    });
}
