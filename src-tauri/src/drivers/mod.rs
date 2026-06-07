//! Tool drivers: how weft spawns, resumes, and captures the native session id
//! for each heterogeneous agent CLI. All spawns are PLAIN binaries under the
//! user's own config (no permission overrides). The PTY layer (pty.rs) is
//! tool-agnostic and dispatches through `driver_for`.

mod codex;
mod opencode;

use std::path::{Path, PathBuf};

/// What to spawn for a session.
pub struct SpawnSpec {
    pub cwd: PathBuf,
    pub resume_id: Option<String>,
}

pub trait ToolDriver: Send + Sync {
    /// (program, args) to spawn a fresh or resumed interactive session at cwd.
    fn command(&self, spec: &SpawnSpec) -> (String, Vec<String>);

    /// How this tool takes a seeded initial prompt (the lead prompt / worker
    /// brief). Most CLIs accept it as a positional first arg; OpenCode's
    /// positional is the project dir, so it needs the `--prompt` flag instead.
    fn seed_args(&self, prompt: &str) -> Vec<String> {
        vec![prompt.to_string()]
    }

    /// Best-effort capture of the native session id for `cwd`, considering only
    /// sessions created at/after `since` (unix secs). Returns None until the
    /// tool has actually started persisting the session (e.g. after the user
    /// clears trust/onboarding gates).
    fn capture_session_id(&self, cwd: &Path, since: u64) -> Option<String>;
}

/// Resolve a tool name to its driver. Unknown tools fall back to Claude.
pub fn driver_for(tool: &str) -> Box<dyn ToolDriver> {
    match tool {
        "codex" => Box::new(codex::CodexDriver),
        "opencode" => Box::new(opencode::OpenCodeDriver),
        _ => Box::new(ClaudeDriver),
    }
}

/// Canonicalize a cwd (resolve symlinks) for matching against tool-stored paths.
pub(crate) fn canon(cwd: &Path) -> PathBuf {
    std::fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf())
}

// ───────────────────────── Claude ─────────────────────────

pub struct ClaudeDriver;

impl ToolDriver for ClaudeDriver {
    fn command(&self, spec: &SpawnSpec) -> (String, Vec<String>) {
        let mut args = Vec::new();
        if let Some(id) = &spec.resume_id {
            args.push("--resume".into());
            args.push(id.clone());
        }
        ("claude".into(), args)
    }

    fn capture_session_id(&self, cwd: &Path, since: u64) -> Option<String> {
        // claude.rs already encodes the canonical cwd + cross-checks stem==id.
        let dir = crate::claude::projects_dir_for(cwd).ok()?;
        crate::claude::capture_session_id(&dir, since)
    }
}
