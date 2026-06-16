//! Codex folder-trust pre-accept — the Codex analog of `claude::ensure_trusted`.
//!
//! Codex prompts "Do you trust this folder?" on first run in an untrusted repo,
//! which stalls an unattended Atlas worker. Trust is keyed by the git repository
//! root. Atlas passes that trust as an inline `-c` override for spawned Codex
//! workers so session startup does not mutate the user's global
//! `~/.codex/config.toml`.

use std::path::{Path, PathBuf};

pub fn trusted_project_config_arg(cwd: &Path) -> Option<String> {
    let Some(root) = repo_root(cwd) else {
        return None;
    };
    Some(format!(
        "projects.{}.trust_level={}",
        toml_quote(&root),
        toml_quote("trusted")
    ))
}

/// The git repository root Codex trusts (a worktree → its main repo root).
fn repo_root(cwd: &Path) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .current_dir(cwd)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let gitdir = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let p = PathBuf::from(&gitdir); // e.g. /repo/.git
    Some(p.parent()?.to_string_lossy().to_string())
}

fn toml_quote(value: &str) -> String {
    toml::Value::String(value.to_string()).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trusted_project_config_arg_uses_git_root_without_writing_config() {
        let base =
            std::env::temp_dir().join(format!("atlas-codex-trust-arg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(&base)
            .status()
            .unwrap();

        let arg = trusted_project_config_arg(&base).unwrap();
        assert!(arg.starts_with("projects."));
        assert!(arg.ends_with(".trust_level=\"trusted\""));

        let parsed: toml::Value = toml::from_str(&format!("{arg}\n")).unwrap();
        let root = repo_root(&base).unwrap();
        assert_eq!(
            parsed["projects"][root.as_str()]["trust_level"].as_str(),
            Some("trusted")
        );
        assert!(!base.join(".codex").join("config.toml").exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn returns_none_outside_git_repo() {
        let base = std::env::temp_dir().join(format!("atlas-codex-no-repo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        assert!(trusted_project_config_arg(&base).is_none());
        let _ = std::fs::remove_dir_all(&base);
    }
}
