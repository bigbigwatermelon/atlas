//! Spawn-time, ADDITIVE injection of the thread bus as an MCP server for each
//! tool. Never overrides a sub-repo's own config: claude/codex use file-less
//! launch flags; opencode deep-merges into the worktree opencode.json (which is
//! a throwaway worktree, not the canonical repo — architecture §2.1).

use std::path::Path;

/// Extra args to PREPEND to the tool's own args (global flags must precede any
/// subcommand, e.g. `codex -c k=v resume <id>`).
pub struct Injection {
    pub args: Vec<String>,
}

fn mcp_url(base: &str, thread: i32, dir: &str) -> String {
    format!("{base}/bus/{thread}/{dir}/mcp")
}

/// Build the injection. `cwd` is the worktree (used for the claude temp config
/// and the opencode merge). `dir` is the direction id as a string.
pub fn inject(base: &str, thread: i32, dir: &str, tool: &str, cwd: &Path) -> Injection {
    let url = mcp_url(base, thread, dir);
    match tool {
        "claude" => {
            // ephemeral --mcp-config file inside the worktree. It's an injected,
            // untracked file, so we add it to the worktree's git exclude (see
            // git_exclude) to keep it out of `git status` / diffs / commits.
            let cfg = cwd.join(".weft-bus.mcp.json");
            let json = serde_json::json!({
                "mcpServers": { "weft_bus": { "type": "http", "url": url } }
            });
            let _ = std::fs::write(&cfg, serde_json::to_vec_pretty(&json).unwrap_or_default());
            git_exclude(cwd, ".weft-bus.mcp.json");
            Injection {
                args: vec!["--mcp-config".into(), cfg.to_string_lossy().to_string()],
            }
        }
        "codex" => Injection {
            args: vec!["-c".into(), format!("mcp_servers.weft_bus.url={url}")],
        },
        "opencode" => {
            merge_opencode_config(cwd, &url);
            Injection { args: vec![] }
        }
        _ => Injection { args: vec![] },
    }
}

/// Deep-merge `mcp.weft_bus = {type:remote, url, enabled:true}` into the
/// worktree's opencode.json, preserving any existing config the sub-repo shipped.
fn merge_opencode_config(cwd: &Path, url: &str) {
    let path = cwd.join("opencode.json");
    let mut root: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }
    // root is guaranteed an object here; guard instead of unwrap so a panic is
    // impossible even if the invariant ever changes.
    let Some(obj) = root.as_object_mut() else {
        return;
    };
    obj.entry("$schema".to_string())
        .or_insert_with(|| serde_json::json!("https://opencode.ai/config.json"));
    let mcp = obj
        .entry("mcp".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if let Some(mcp_obj) = mcp.as_object_mut() {
        mcp_obj.insert(
            "weft_bus".to_string(),
            serde_json::json!({ "type": "remote", "url": url, "enabled": true }),
        );
    }
    let _ = std::fs::write(&path, serde_json::to_vec_pretty(&root).unwrap_or_default());
    // Best-effort: only hides opencode.json from git when the sub-repo does NOT
    // track it. If the repo ships a tracked opencode.json, the merge still shows
    // as a modification — an accepted limitation of the worktree-local merge.
    git_exclude(cwd, "opencode.json");
}

/// Append `name` to the worktree's git exclude file (so weft's injected,
/// untracked config files never show in `git status` / diffs / accidental
/// commits). Resolves the real exclude path via git (worktrees use a separate
/// gitdir). Best-effort: silently does nothing if git isn't available.
fn git_exclude(cwd: &Path, name: &str) {
    let out = std::process::Command::new("git")
        .args(["-C", &cwd.to_string_lossy(), "rev-parse", "--git-path", "info/exclude"])
        .output();
    let Ok(out) = out else { return };
    if !out.status.success() {
        return;
    }
    let rel = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if rel.is_empty() {
        return;
    }
    // rev-parse returns a path relative to cwd (or absolute); resolve against cwd.
    let p = std::path::Path::new(&rel);
    let exclude_path = if p.is_absolute() { p.to_path_buf() } else { cwd.join(p) };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_writes_mcp_config_and_flags() {
        let dir = std::env::temp_dir().join(format!("weft-inj-claude-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let inj = inject("http://127.0.0.1:9", 1, "10", "claude", &dir);
        assert_eq!(inj.args[0], "--mcp-config");
        let cfg = std::fs::read_to_string(dir.join(".weft-bus.mcp.json")).unwrap();
        assert!(cfg.contains("weft_bus") && cfg.contains("/bus/1/10/mcp"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn codex_uses_config_override() {
        let inj = inject("http://127.0.0.1:9", 2, "30", "codex", Path::new("/tmp"));
        assert_eq!(inj.args, vec!["-c".to_string(),
            "mcp_servers.weft_bus.url=http://127.0.0.1:9/bus/2/30/mcp".to_string()]);
    }

    #[test]
    fn opencode_merges_preserving_existing() {
        let dir = std::env::temp_dir().join(format!("weft-inj-oc-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        // sub-repo already ships an opencode.json with its own mcp server
        std::fs::write(
            dir.join("opencode.json"),
            r#"{"mcp":{"repo_own":{"type":"local","command":["x"]}}}"#,
        )
        .unwrap();
        let inj = inject("http://127.0.0.1:9", 1, "10", "opencode", &dir);
        assert!(inj.args.is_empty());
        let merged: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("opencode.json")).unwrap())
                .unwrap();
        // both the repo's server AND weft_bus must be present
        assert!(merged["mcp"]["repo_own"].is_object(), "repo's own server preserved");
        assert_eq!(merged["mcp"]["weft_bus"]["type"], "remote");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn injected_file_is_git_excluded() {
        use std::process::Command;
        let root = std::env::temp_dir().join(format!("weft-inj-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let repo = root.join("repo");
        let wt = root.join("wt");
        std::fs::create_dir_all(&repo).unwrap();
        let sh = |dir: &Path, args: &[&str]| {
            assert!(Command::new(args[0]).args(&args[1..]).current_dir(dir).status().unwrap().success());
        };
        sh(&repo, &["git", "init", "-q"]);
        sh(&repo, &["git", "config", "user.email", "t@t.t"]);
        sh(&repo, &["git", "config", "user.name", "t"]);
        std::fs::write(repo.join("README.md"), "x\n").unwrap();
        sh(&repo, &["git", "add", "-A"]);
        sh(&repo, &["git", "commit", "-q", "-m", "init"]);
        sh(&repo, &["git", "worktree", "add", "-q", wt.to_str().unwrap()]);

        let _ = inject("http://127.0.0.1:9", 1, "1", "claude", &wt);
        assert!(wt.join(".weft-bus.mcp.json").exists(), "file written");
        let status = Command::new("git").args(["status", "--porcelain"]).current_dir(&wt).output().unwrap();
        let s = String::from_utf8_lossy(&status.stdout);
        assert!(!s.contains(".weft-bus.mcp.json"), "injected file must be git-excluded, got: {s}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
