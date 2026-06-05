//! M1 risk-retirement spike: portable-pty interactive spawn of `claude` in a
//! git worktree, capture native session id from the sidecar jsonl dir, clean
//! kill, then interactive `--resume` in the SAME cwd — proving the load-bearing
//! materialization assumption end to end.
//!
//! Reusable pieces (encode_cwd / projects_dir_for / capture_session_id) are
//! written to carry forward into src-tauri unchanged.

use anyhow::{anyhow, bail, Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Claude encodes the *canonical* cwd into a projects-dir name by replacing
/// both '/' and '.' with '-'. Symlinks MUST be resolved first (macOS /tmp ->
/// /private/tmp), or the encoded dir won't match. Verified empirically.
fn encode_cwd(cwd: &Path) -> Result<String> {
    let canon = std::fs::canonicalize(cwd)
        .with_context(|| format!("canonicalize {}", cwd.display()))?;
    let s = canon.to_string_lossy();
    Ok(s.chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect())
}

fn projects_dir_for(cwd: &Path) -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME unset")?;
    Ok(PathBuf::from(home)
        .join(".claude")
        .join("projects")
        .join(encode_cwd(cwd)?))
}

fn mtime_secs(p: &Path) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Newest *.jsonl in the projects dir whose mtime is at/after `since`.
/// Returns (session_id == file stem) only after cross-checking that the file
/// actually contains a `"sessionId":"<stem>"` line.
fn capture_session_id(projects_dir: &Path, since: u64) -> Option<String> {
    let mut best: Option<(u64, PathBuf)> = None;
    for entry in std::fs::read_dir(projects_dir).ok()?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let mt = mtime_secs(&p);
        if mt + 2 < since {
            continue; // 2s slack for clock granularity
        }
        if best.as_ref().map_or(true, |(bm, _)| mt >= *bm) {
            best = Some((mt, p));
        }
    }
    let (_, path) = best?;
    let stem = path.file_stem()?.to_string_lossy().to_string();
    let content = std::fs::read_to_string(&path).ok()?;
    let needle = format!("\"sessionId\":\"{}\"", stem);
    if content.contains(&needle) {
        Some(stem)
    } else {
        None
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Spawn `claude` (with optional resume id) interactively in a PTY at `cwd`.
/// Returns the spawned child plus a shared buffer that a reader thread drains
/// (draining is required or the TUI blocks on a full pty).
struct PtySession {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    output: Arc<Mutex<Vec<u8>>>,
    _master: Box<dyn portable_pty::MasterPty + Send>,
}

fn spawn_claude(cwd: &Path, resume_id: Option<&str>) -> Result<PtySession> {
    let pair = native_pty_system().openpty(PtySize {
        rows: 40,
        cols: 120,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new("claude");
    if let Some(id) = resume_id {
        cmd.arg("--resume");
        cmd.arg(id);
    }
    // TEST-ONLY: the spike needs unattended, deterministic tool execution.
    // The PRODUCT must NOT inject this — it spawns plain `claude` and lets the
    // user's own config / permission mode apply, answering trust + permission
    // popups inside the embedded TUI (see spec "顺从用户自己的 Claude 配置").
    cmd.arg("--dangerously-skip-permissions");
    cmd.cwd(cwd);
    // Inherit the full environment so claude finds HOME/PATH/auth.
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }

    let child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;
    let output = Arc::new(Mutex::new(Vec::new()));
    let out2 = output.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => out2.lock().unwrap().extend_from_slice(&buf[..n]),
            }
        }
    });

    Ok(PtySession {
        child,
        writer,
        output,
        _master: pair.master,
    })
}

/// First-run `--dangerously-skip-permissions` shows a "Bypass Permissions mode"
/// screen ("1. No, exit" / "2. Yes, I accept", Enter to confirm). Pick option 2.
/// NOTE for the product: spawning claude programmatically hits onboarding / trust
/// / bypass first-screens; either drive these keystrokes or pre-set the accepted
/// flags in config (worktree-local, gitignored — never canonical).
fn accept_bypass_warning(writer: &mut Box<dyn Write + Send>) -> Result<()> {
    writer.write_all(b"2")?;
    writer.flush()?;
    std::thread::sleep(Duration::from_millis(400));
    writer.write_all(b"\r")?;
    writer.flush()?;
    std::thread::sleep(Duration::from_millis(1500));
    Ok(())
}

fn poll_until<F: Fn() -> bool>(timeout: Duration, f: F) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

fn sh(dir: &Path, args: &[&str]) -> Result<()> {
    let st = Command::new(args[0]).args(&args[1..]).current_dir(dir).status()?;
    if !st.success() {
        bail!("command {:?} failed in {}", args, dir.display());
    }
    Ok(())
}

fn main() -> Result<()> {
    // --- fresh demo repo + namespaced worktree (self-contained) ---
    let root = PathBuf::from("/private/tmp/weft-spike-rs");
    let _ = std::fs::remove_dir_all(&root);
    let repo = root.join("demo-repo");
    let wt = root.join("wt-t1-main");
    std::fs::create_dir_all(&repo)?;

    sh(&repo, &["git", "init", "-q"])?;
    sh(&repo, &["git", "config", "user.email", "t@t.t"])?;
    sh(&repo, &["git", "config", "user.name", "t"])?;
    std::fs::write(repo.join("README.md"), "# demo\n")?;
    sh(&repo, &["git", "add", "-A"])?;
    sh(&repo, &["git", "commit", "-q", "-m", "init"])?;
    sh(
        &repo,
        &[
            "git",
            "worktree",
            "add",
            "-q",
            "-b",
            "ws/demo/t1/main",
            wt.to_str().unwrap(),
        ],
    )?;
    println!("[setup] worktree: {}", wt.display());
    println!("[setup] encoded-cwd: {}", encode_cwd(&wt)?);
    let projects_dir = projects_dir_for(&wt)?;
    println!("[setup] projects dir: {}", projects_dir.display());

    // ===== Step A: interactive spawn, drive a tool call, capture id =====
    let t0 = now_secs();
    let mut sess = spawn_claude(&wt, None)?;
    std::thread::sleep(Duration::from_secs(3)); // let the TUI boot
    accept_bypass_warning(&mut sess.writer)?; // first-run "Yes, I accept" screen
    write!(
        sess.writer,
        "Create a file named hello.txt containing exactly: hi\r"
    )?;
    sess.writer.flush()?;

    let hello = wt.join("hello.txt");
    let file_ok = poll_until(Duration::from_secs(90), || hello.exists());
    let sid = {
        let pd = projects_dir.clone();
        poll_until(Duration::from_secs(20), || {
            capture_session_id(&pd, t0).is_some()
        });
        capture_session_id(&projects_dir, t0)
    };

    if sid.is_none() {
        let raw = sess.output.lock().unwrap().clone();
        eprintln!("---- TUI OUTPUT (lossy, {} bytes) ----", raw.len());
        eprintln!("{}", String::from_utf8_lossy(&raw));
        eprintln!("---- end TUI output ----");
        eprintln!("projects dir exists: {}", projects_dir.exists());
    }
    let sid = sid.ok_or_else(|| anyhow!("FAIL: did not capture a session id"))?;
    println!("[A] captured session id: {}", sid);
    println!("[A] hello.txt created: {}", file_ok);
    if !file_ok {
        bail!("FAIL: claude did not create hello.txt within timeout");
    }
    let jsonl = projects_dir.join(format!("{}.jsonl", sid));
    let lines_before = std::fs::read_to_string(&jsonl)?.lines().count();
    let files_before = std::fs::read_dir(&projects_dir)?.count();

    // clean kill (Ctrl-C twice, then hard kill if needed)
    let _ = sess.writer.write_all(&[0x03]);
    let _ = sess.writer.flush();
    std::thread::sleep(Duration::from_millis(500));
    let _ = sess.writer.write_all(&[0x03]);
    let _ = sess.writer.flush();
    std::thread::sleep(Duration::from_millis(800));
    let _ = sess.child.kill();
    let _ = sess.child.wait();
    println!("[A] killed. jsonl lines before resume: {}", lines_before);

    // ===== Step B: resume in SAME cwd, prove history + same jsonl =====
    let mut r = spawn_claude(&wt, Some(&sid))?;
    std::thread::sleep(Duration::from_secs(3));
    accept_bypass_warning(&mut r.writer)?;
    write!(
        r.writer,
        "Without using any tools, what filename did you create earlier? Reply with only the filename.\r"
    )?;
    r.writer.flush()?;

    // wait for the jsonl to grow (resume appends to the SAME file)
    let grew = poll_until(Duration::from_secs(60), || {
        std::fs::read_to_string(&jsonl)
            .map(|c| c.lines().count() > lines_before)
            .unwrap_or(false)
    });
    println!("[B] jsonl grew after resume: {}", grew);
    std::thread::sleep(Duration::from_secs(2));
    let _ = r.writer.write_all(&[0x03]);
    let _ = r.writer.flush();
    std::thread::sleep(Duration::from_millis(800));
    let _ = r.child.kill();
    let _ = r.child.wait();

    let files_after = std::fs::read_dir(&projects_dir)?.count();
    let content_after = std::fs::read_to_string(&jsonl)?;
    let lines_after = content_after.lines().count();
    let mentions_hello = content_after.contains("hello.txt");
    let tui_text = String::from_utf8_lossy(&r.output.lock().unwrap()).to_string();
    let tui_mentions = tui_text.contains("hello.txt");

    // ===== verdict =====
    println!("\n==== VERDICT ====");
    let c1 = file_ok;
    let c2 = !sid.is_empty();
    let c3 = files_after == files_before && lines_after > lines_before;
    println!("① worktree file change (hello.txt created): {}", pass(c1));
    println!(
        "② session id captured & cross-checked (stem==sessionId): {}",
        pass(c2)
    );
    println!(
        "③ resume reused SAME jsonl (files {}->{}, lines {}->{}): {}",
        files_before,
        files_after,
        lines_before,
        lines_after,
        pass(c3)
    );
    println!(
        "   (history evidence: jsonl mentions hello.txt={}, TUI reply mentions hello.txt={})",
        mentions_hello, tui_mentions
    );
    let all = c1 && c2 && c3;
    println!("\nRESULT: {}", if all { "✅ ALL PASS" } else { "❌ FAIL" });
    if !all {
        bail!("spike assertions failed");
    }
    Ok(())
}

fn pass(b: bool) -> &'static str {
    if b {
        "PASS"
    } else {
        "FAIL"
    }
}
