//! PTY session manager for M1: spawn the native `claude` TUI in a worktree,
//! stream frame-batched output to the frontend, accept keystrokes back, capture
//! the native session id, and resume in the SAME cwd.
//!
//! M1 holds a single active session in Tauri state. Multi-session is M2+.

use crate::batch::FrameBatcher;
use crate::{claude, git};
use anyhow::{anyhow, Context, Result};
use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const OUTPUT_EVENT: &str = "pty://output";
const EXIT_EVENT: &str = "pty://exit";
const SESSION_ID_EVENT: &str = "session://id";
const FRAME_INTERVAL: Duration = Duration::from_millis(16);
const FRAME_MAX_BYTES: usize = 64 * 1024;

/// The live OS objects for the running child. Recreated on resume.
struct Active {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    alive: Arc<AtomicBool>,
}

/// Tauri-managed state. cwd/session_id survive across kill+resume.
#[derive(Default)]
pub struct PtyState {
    active: Mutex<Option<Active>>,
    cwd: Mutex<Option<PathBuf>>,
    repo: Mutex<Option<PathBuf>>,
    branch: Mutex<Option<String>>,
    session_id: Mutex<Option<String>>,
}

#[derive(Serialize, Clone)]
pub struct SessionInfo {
    repo: String,
    worktree: String,
    branch: String,
    resumed: bool,
    /// Present only when resuming an already-captured session.
    resume_id: Option<String>,
}

#[derive(Serialize, Clone)]
struct OutputPayload {
    /// base64 of raw PTY bytes (terminal output is binary).
    data: String,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Spawn `claude` into a fresh PTY at `cwd` and wire up output/exit/capture.
/// NOTE: PLAIN claude — no permission overrides (see claude.rs).
fn spawn(app: &AppHandle, cwd: &PathBuf, resume_id: Option<&str>) -> Result<Active> {
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
    cmd.cwd(cwd);
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;
    let alive = Arc::new(AtomicBool::new(true));

    // --- shared pending buffer drained by the flusher ---
    let pending = Arc::new(Mutex::new(FrameBatcher::new(FRAME_MAX_BYTES)));

    // reader thread: append bytes to the batcher
    {
        let pending = pending.clone();
        let alive_r = alive.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.lock().unwrap().push(&buf[..n]);
                    }
                }
            }
            alive_r.store(false, Ordering::SeqCst);
            // flush any tail, then signal exit
            if let Some(frame) = pending.lock().unwrap().take_frame() {
                emit_output(&app, &frame);
            }
            let _ = app.emit(EXIT_EVENT, ());
        });
    }

    // flusher thread: every ~16ms drain one coalesced frame
    {
        let pending = pending.clone();
        let alive_f = alive.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            while alive_f.load(Ordering::SeqCst) {
                std::thread::sleep(FRAME_INTERVAL);
                let frame = pending.lock().unwrap().take_frame();
                if let Some(frame) = frame {
                    emit_output(&app, &frame);
                }
            }
        });
    }

    // capture thread: poll the sidecar dir for the native session id
    if resume_id.is_none() {
        let app = app.clone();
        let cwd = cwd.clone();
        let alive_c = alive.clone();
        let t0 = now_secs();
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(30);
            while alive_c.load(Ordering::SeqCst) && Instant::now() < deadline {
                if let Ok(dir) = claude::projects_dir_for(&cwd) {
                    if let Some(id) = claude::capture_session_id(&dir, t0) {
                        let _ = app.emit(SESSION_ID_EVENT, id.clone());
                        if let Some(state) = app.try_state::<PtyState>() {
                            *state.session_id.lock().unwrap() = Some(id);
                        }
                        break;
                    }
                }
                std::thread::sleep(Duration::from_millis(400));
            }
        });
    }

    Ok(Active {
        child,
        writer,
        master: pair.master,
        alive,
    })
}

fn emit_output(app: &AppHandle, bytes: &[u8]) {
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    let _ = app.emit(OUTPUT_EVENT, OutputPayload { data });
}

/// Kill the active child (if any) and wait briefly so the pty closes.
fn kill_active(state: &PtyState) {
    if let Some(mut a) = state.active.lock().unwrap().take() {
        a.alive.store(false, Ordering::SeqCst);
        let _ = a.writer.write_all(&[0x03]); // Ctrl-C, polite
        let _ = a.writer.flush();
        std::thread::sleep(Duration::from_millis(150));
        let _ = a.child.kill();
        let _ = a.child.wait();
    }
}

// ===================== Tauri commands =====================

/// Open a brand-new session. If `repo_path` is a git repo, materialize a
/// worktree from it; otherwise spin up a throwaway demo repo so the app is
/// usable with zero setup.
#[tauri::command]
pub fn open_session(
    app: AppHandle,
    state: State<PtyState>,
    repo_path: Option<String>,
) -> Result<SessionInfo, String> {
    open_session_impl(app, state, repo_path).map_err(|e| e.to_string())
}

fn open_session_impl(
    app: AppHandle,
    state: State<PtyState>,
    repo_path: Option<String>,
) -> Result<SessionInfo> {
    kill_active(&state);

    // unique view root under the system temp dir
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let view_root = std::env::temp_dir().join(format!("weft/{nanos}"));
    std::fs::create_dir_all(&view_root).ok();

    let repo: PathBuf = match repo_path {
        Some(p) if !p.trim().is_empty() && git::is_git_repo(PathBuf::from(&p).as_path()) => {
            PathBuf::from(p)
        }
        _ => git::init_demo_repo(&view_root.join("demo-repo"))
            .context("init demo repo")?,
    };

    let branch = "ws/demo/t1/main".to_string();
    let worktree = view_root.join("wt-t1-main");
    git::add_worktree(&repo, &branch, &worktree).context("add worktree")?;

    let active = spawn(&app, &worktree, None).context("spawn claude")?;
    *state.active.lock().unwrap() = Some(active);
    *state.cwd.lock().unwrap() = Some(worktree.clone());
    *state.repo.lock().unwrap() = Some(repo.clone());
    *state.branch.lock().unwrap() = Some(branch.clone());
    *state.session_id.lock().unwrap() = None;

    Ok(SessionInfo {
        repo: repo.to_string_lossy().to_string(),
        worktree: worktree.to_string_lossy().to_string(),
        branch,
        resumed: false,
        resume_id: None,
    })
}

/// Resume the last session in the SAME cwd using the captured native id.
#[tauri::command]
pub fn resume_session(app: AppHandle, state: State<PtyState>) -> Result<SessionInfo, String> {
    resume_impl(app, state).map_err(|e| e.to_string())
}

fn resume_impl(app: AppHandle, state: State<PtyState>) -> Result<SessionInfo> {
    let cwd = state
        .cwd
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| anyhow!("no session to resume yet"))?;
    let sid = state
        .session_id
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| anyhow!("native session id not captured yet"))?;
    let repo = state.repo.lock().unwrap().clone().unwrap_or_default();
    let branch = state.branch.lock().unwrap().clone().unwrap_or_default();

    kill_active(&state);
    let active = spawn(&app, &cwd, Some(&sid)).context("spawn claude --resume")?;
    *state.active.lock().unwrap() = Some(active);

    Ok(SessionInfo {
        repo: repo.to_string_lossy().to_string(),
        worktree: cwd.to_string_lossy().to_string(),
        branch,
        resumed: true,
        resume_id: Some(sid),
    })
}

/// Forward keystrokes from xterm to the child's stdin (Ctrl-C, chars, etc.).
#[tauri::command]
pub fn write_pty(state: State<PtyState>, data: String) -> Result<(), String> {
    let mut guard = state.active.lock().unwrap();
    let active = guard.as_mut().ok_or("no active session")?;
    active
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    active.writer.flush().map_err(|e| e.to_string())
}

/// Keep the PTY size in sync with the xterm viewport.
#[tauri::command]
pub fn resize_pty(state: State<PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    let guard = state.active.lock().unwrap();
    if let Some(active) = guard.as_ref() {
        active
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Terminate the active session.
#[tauri::command]
pub fn kill_session(state: State<PtyState>) -> Result<(), String> {
    kill_active(&state);
    Ok(())
}
