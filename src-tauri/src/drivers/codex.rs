//! Codex driver. Spawns `codex` (it uses the process cwd we set). Resume via
//! `codex resume <id>`. Sessions are rollout jsonl under ~/.codex/sessions/
//! whose first line is `{type:"session_meta", payload:{id, cwd, ...}}`.
//!
//! NOTE: never isolate via CODEX_HOME — `codex resume` has a known bug (#5247)
//! with a custom home; we use the standard home + the worktree cwd.

use super::{canon, SpawnSpec, ToolDriver};
use std::path::Path;
use std::time::UNIX_EPOCH;

pub struct CodexDriver;

impl ToolDriver for CodexDriver {
    fn command(&self, spec: &SpawnSpec) -> (String, Vec<String>) {
        let mut args = Vec::new();
        if let Some(id) = &spec.resume_id {
            args.push("resume".into());
            args.push(id.clone());
        }
        ("codex".into(), args)
    }

    fn capture_session_id(&self, cwd: &Path, since: u64) -> Option<String> {
        let home = std::env::var("HOME").ok()?;
        let root = Path::new(&home).join(".codex").join("sessions");
        let target = canon(cwd);
        let mut best: Option<(u64, String)> = None;
        for path in newest_rollouts(&root, since) {
            if let Some((mtime, id, scwd)) = read_session_meta(&path) {
                if paths_match(&scwd, &target) && best.as_ref().map_or(true, |(m, _)| mtime >= *m) {
                    best = Some((mtime, id));
                }
            }
        }
        best.map(|(_, id)| id)
    }
}

fn paths_match(stored: &str, target: &std::path::Path) -> bool {
    let s = Path::new(stored);
    s == target || canon(s) == *target
}

fn mtime_secs(p: &Path) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Recursively collect *.jsonl rollouts under `root` with mtime at/after `since`.
fn newest_rollouts(root: &Path, since: u64) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    collect(root, since, &mut out, 0);
    out
}

fn collect(dir: &Path, since: u64, out: &mut Vec<std::path::PathBuf>, depth: u8) {
    if depth > 6 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect(&p, since, out, depth + 1);
        } else if p.extension().and_then(|e| e.to_str()) == Some("jsonl")
            && mtime_secs(&p) + 2 >= since
        {
            out.push(p);
        }
    }
}

/// Read the first line and pull (mtime, payload.id, payload.cwd) if it's a
/// session_meta record.
fn read_session_meta(path: &Path) -> Option<(u64, String, String)> {
    let content = std::fs::read_to_string(path).ok()?;
    let first = content.lines().next()?;
    let v: serde_json::Value = serde_json::from_str(first).ok()?;
    if v.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let payload = v.get("payload")?;
    let id = payload.get("id")?.as_str()?.to_string();
    let cwd = payload.get("cwd")?.as_str()?.to_string();
    Some((mtime_secs(path), id, cwd))
}
