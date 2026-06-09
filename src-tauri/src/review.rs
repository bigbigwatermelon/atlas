//! The review-agent rung of the verification ladder (§4.13, the last rung after
//! lint/type/unit/contract). This is a LIGHTWEIGHT, on-demand pre-PR self-review
//! — the agent reads its own uncommitted diff and flags bugs/incomplete work —
//! NOT a re-implementation of the repo's authoritative PR review/CI (§7: 别重造
//! review/CI). It never runs automatically (unlike the executable checks): it
//! costs tokens and is non-deterministic, so it's a button the human presses.
//!
//! The prompt + verdict parsing are pure and unit-tested; the agent invocation
//! is a thin shell-out. Claude only for now (the lead/default tool); other tools
//! report "skipped" rather than guessing their headless contract.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ReviewVerdict {
    /// "pass" | "fail" | "skipped"
    pub status: String,
    pub summary: String,
}

/// The review instruction. Asks the agent to inspect its own diff read-only and
/// end with two machine-parseable lines. Pure so the contract is testable.
pub fn build_review_prompt() -> String {
    "You are reviewing the UNCOMMITTED changes in this git repository before a pull request. \
Run `git status` and `git diff` to see them. Look for bugs, security issues, broken or \
incomplete work, and obvious regressions. Do NOT modify any files — this is review only. \
Be concise. End your reply with exactly these two lines:\n\
SUMMARY: <one sentence>\n\
VERDICT: PASS  (or)  VERDICT: FAIL"
        .to_string()
}

/// Parse the agent's reply into a verdict. Fail-closed: if no VERDICT line is
/// found, treat it as a fail (an unparseable review is not a pass). The LAST
/// VERDICT line wins (the agent may echo the instruction earlier).
pub fn parse_verdict(out: &str) -> ReviewVerdict {
    let mut pass: Option<bool> = None;
    let mut summary = String::new();
    for line in out.lines() {
        let l = line.trim();
        let up = l.to_uppercase();
        if let Some(rest) = up.strip_prefix("VERDICT:") {
            let r = rest.trim();
            if r.starts_with("PASS") {
                pass = Some(true);
            } else if r.starts_with("FAIL") {
                pass = Some(false);
            }
        } else if let Some(rest) = l.strip_prefix("SUMMARY:").or_else(|| l.strip_prefix("Summary:"))
        {
            summary = rest.trim().to_string();
        }
    }
    match pass {
        Some(true) => ReviewVerdict {
            status: "pass".into(),
            summary: if summary.is_empty() { "looks good".into() } else { summary },
        },
        Some(false) => ReviewVerdict {
            status: "fail".into(),
            summary: if summary.is_empty() { "issues found".into() } else { summary },
        },
        None => ReviewVerdict {
            status: "fail".into(),
            summary: "the reviewer returned no verdict".into(),
        },
    }
}

/// Run the review agent in `worktree`. Claude-only for now; other tools are
/// reported skipped rather than invoked with a guessed headless flag.
pub fn run_review(worktree: &Path, tool: &str) -> ReviewVerdict {
    if tool != "claude" {
        return ReviewVerdict {
            status: "skipped".into(),
            summary: format!("the review agent supports claude only for now (this is {tool})"),
        };
    }
    let out = Command::new("claude")
        .args(["-p", &build_review_prompt(), "--dangerously-skip-permissions"])
        .current_dir(worktree)
        .output();
    match out {
        Ok(o) => {
            let mut text = String::from_utf8_lossy(&o.stdout).into_owned();
            if text.trim().is_empty() {
                text = String::from_utf8_lossy(&o.stderr).into_owned();
            }
            parse_verdict(&text)
        }
        Err(e) => ReviewVerdict {
            status: "skipped".into(),
            summary: format!("could not run the review agent: {e}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pass_with_summary() {
        let v = parse_verdict("...\nSUMMARY: clean refactor, tests cover it\nVERDICT: PASS\n");
        assert_eq!(v.status, "pass");
        assert_eq!(v.summary, "clean refactor, tests cover it");
    }

    #[test]
    fn parses_fail() {
        let v = parse_verdict("SUMMARY: null deref in handler\nVERDICT: FAIL");
        assert_eq!(v.status, "fail");
        assert_eq!(v.summary, "null deref in handler");
    }

    #[test]
    fn last_verdict_wins_over_an_echoed_instruction() {
        // the agent quoted the instruction ("VERDICT: PASS (or) FAIL") then ruled
        let v = parse_verdict("I will end with VERDICT: PASS or fail.\nreviewing…\nVERDICT: FAIL");
        assert_eq!(v.status, "fail");
    }

    #[test]
    fn no_verdict_is_fail_closed() {
        let v = parse_verdict("looks fine to me, shipping it");
        assert_eq!(v.status, "fail");
        assert!(v.summary.contains("no verdict"));
    }

    #[test]
    fn non_claude_tool_is_skipped_not_invoked() {
        let v = run_review(Path::new("/tmp"), "codex");
        assert_eq!(v.status, "skipped");
        assert!(v.summary.contains("codex"));
    }
}
