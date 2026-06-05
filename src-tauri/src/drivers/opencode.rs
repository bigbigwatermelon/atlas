//! OpenCode driver. Spawns `opencode <cwd>` (the positional project = working
//! dir). Resume via `opencode <cwd> --session <id>`. Sessions persist in the
//! SQLite db at ~/.local/share/opencode/opencode.db, table `session` with
//! `id` / `directory` (the cwd) / `time_created`.
//!
//! Capture queries that db with the `sqlite3` CLI (always present on macOS, and
//! avoids a second SQLite link alongside sea-orm's). Match by directory; a fresh
//! worktree path is unique so the newest matching row is unambiguously ours.

use super::{canon, SpawnSpec, ToolDriver};
use std::path::Path;
use std::process::Command;

pub struct OpenCodeDriver;

impl ToolDriver for OpenCodeDriver {
    fn command(&self, spec: &SpawnSpec) -> (String, Vec<String>) {
        let cwd = spec.cwd.to_string_lossy().to_string();
        let mut args = vec![cwd];
        if let Some(id) = &spec.resume_id {
            args.push("--session".into());
            args.push(id.clone());
        }
        ("opencode".into(), args)
    }

    fn capture_session_id(&self, cwd: &Path, _since: u64) -> Option<String> {
        let home = std::env::var("HOME").ok()?;
        let db = Path::new(&home)
            .join(".local")
            .join("share")
            .join("opencode")
            .join("opencode.db");
        if !db.exists() {
            return None;
        }
        let target = canon(cwd);
        let target_s = target.to_string_lossy().to_string();
        let raw_s = cwd.to_string_lossy().to_string();
        // Match either the canonical or raw cwd; newest by time_created.
        let sql = format!(
            "SELECT id FROM session WHERE directory IN ({}, {}) ORDER BY time_created DESC LIMIT 1;",
            sql_quote(&target_s),
            sql_quote(&raw_s),
        );
        let out = Command::new("sqlite3")
            .arg(&db)
            .arg("-readonly")
            .arg(&sql)
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let id = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if id.is_empty() {
            None
        } else {
            Some(id)
        }
    }
}

/// Single-quote a value for SQLite, escaping embedded quotes.
fn sql_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}
