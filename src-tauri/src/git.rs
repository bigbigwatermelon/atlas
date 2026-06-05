//! Minimal git worktree helpers for M1. Branch names are namespaced with the
//! thread dimension (`ws/<workspace>/<thread>/<direction>`) so the same branch
//! is never checked out in two worktrees at once.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .with_context(|| format!("spawn git {:?}", args))?;
    if !out.status.success() {
        bail!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// True if `path` is inside a git work tree.
pub fn is_git_repo(path: &Path) -> bool {
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Create a worktree for `repo` on a fresh `branch` at `worktree_path`.
/// Idempotent-ish: if the worktree path already exists it is reused.
pub fn add_worktree(repo: &Path, branch: &str, worktree_path: &Path) -> Result<PathBuf> {
    if worktree_path.exists() {
        return Ok(worktree_path.to_path_buf());
    }
    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    // -b creates the branch; if it already exists, fall back to plain add.
    let path_str = worktree_path.to_string_lossy().to_string();
    let res = git(repo, &["worktree", "add", "-b", branch, &path_str]);
    if res.is_err() {
        git(repo, &["worktree", "add", &path_str, branch])
            .context("worktree add (existing branch)")?;
    }
    Ok(worktree_path.to_path_buf())
}

/// Remove a worktree and prune. (Used by M2 worktree lifecycle management.)
#[allow(dead_code)]
pub fn remove_worktree(repo: &Path, worktree_path: &Path) -> Result<()> {
    let path_str = worktree_path.to_string_lossy().to_string();
    git(repo, &["worktree", "remove", "--force", &path_str]).ok();
    git(repo, &["worktree", "prune"]).ok();
    Ok(())
}

/// Create a throwaway demo repo (for trying the app without a real repo).
pub fn init_demo_repo(at: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(at)?;
    git(at, &["init", "-q"])?;
    git(at, &["config", "user.email", "demo@weft.local"])?;
    git(at, &["config", "user.name", "weft demo"])?;
    std::fs::write(at.join("README.md"), "# weft demo repo\n")?;
    git(at, &["add", "-A"])?;
    git(at, &["commit", "-q", "-m", "init"])?;
    Ok(at.to_path_buf())
}
