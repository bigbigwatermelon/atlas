//! Narrow git helper used by local agent-directory injection.

use std::path::{Path, PathBuf};
use std::process::Command;

fn git_exclude_path(cwd: &Path) -> Option<PathBuf> {
    let out = Command::new("git")
        .args([
            "-C",
            &cwd.to_string_lossy(),
            "rev-parse",
            "--git-path",
            "info/exclude",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let rel = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if rel.is_empty() {
        return None;
    }
    let p = Path::new(&rel);
    Some(if p.is_absolute() {
        p.to_path_buf()
    } else {
        cwd.join(p)
    })
}

/// Best-effort: add `name` to the current directory's git exclude file.
pub fn git_exclude(cwd: &Path, name: &str) {
    let Some(exclude_path) = git_exclude_path(cwd) else {
        return;
    };
    if let Some(parent) = exclude_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let existing = std::fs::read_to_string(&exclude_path).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == name) {
        return;
    }
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(name);
    content.push('\n');
    let _ = std::fs::write(&exclude_path, content);
}
