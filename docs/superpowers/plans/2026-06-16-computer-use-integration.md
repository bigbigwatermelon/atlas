# Computer Use Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build macOS-only, globally-enabled Computer Use for new Atlas sessions by bundling `open-computer-use` and injecting it as a direct stdio MCP server.

**Architecture:** Atlas owns Settings, helper discovery, diagnostics, packaging, and per-session MCP injection. Agent MCP clients start the bundled `open-computer-use mcp` sidecar directly; Atlas does not proxy, audit, or block Computer Use tool calls.

**Tech Stack:** Tauri v2, Rust 2021, Tokio, SeaORM app settings, React 19, TypeScript, Vite, existing Claude/Codex/OpenCode MCP injection paths.

---

## Source Spec

- Design: `docs/superpowers/specs/2026-06-16-computer-use-integration-design.md`

## File Structure

Create backend module:

- `src-tauri/src/computer_use/mod.rs`
  Module entry point, shared DTOs, command exports.
- `src-tauri/src/computer_use/settings.rs`
  Loads and saves `computer_use_enabled` from the existing `app_setting` table.
- `src-tauri/src/computer_use/helper.rs`
  Resolves bundled helper path, validates executable state, and exposes testable helper status.
- `src-tauri/src/computer_use/diagnostics.rs`
  Runs `--version` and `doctor` with timeouts and maps output to user-facing status.
- `src-tauri/src/computer_use/inject.rs`
  Builds direct stdio MCP injection for Claude, Codex, and OpenCode.

Modify backend integration:

- `src-tauri/src/lib.rs`
  Register `computer_use` module and Tauri commands.
- `src-tauri/src/lead_chat/commands.rs`
  Add Computer Use injection when creating new lead and worker engines.
- `src-tauri/tauri.conf.json`
  Bundle the helper binary as a resource.

Modify frontend:

- `src/lib/types.ts`
  Add Computer Use DTO types.
- `src/lib/api.ts`
  Add Tauri command wrappers.
- `src/settings/ComputerUse.tsx`
  New Settings panel for enablement and diagnostics.
- `src/nav/SettingsDialog.tsx`
  Add Settings navigation entry and render the panel.
- `src/i18n/en.ts` and `src/i18n/zh.ts`
  Add user-facing copy.

Create release metadata:

- `src-tauri/sidecars/README.md`
  Documents where the helper binary goes in development and how to pin its upstream version.
- `src-tauri/sidecars/open-computer-use.version.json`
  Records upstream repo, commit or release, license, and binary name.

Do not create a new database table. Do not modify global `~/.codex/config.toml`, `~/.claude.json`, Gemini config, or global OpenCode config.

---

### Task 1: Backend Settings Commands

**Files:**
- Create: `src-tauri/src/computer_use/mod.rs`
- Create: `src-tauri/src/computer_use/settings.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/api.ts`
- Test: `src-tauri/src/computer_use/settings.rs`

- [ ] **Step 1: Create the backend module shell**

Create `src-tauri/src/computer_use/mod.rs`:

```rust
pub mod diagnostics;
pub mod helper;
pub mod inject;
pub mod settings;

pub mod commands {
    use super::diagnostics::{self, ComputerUseStatus};
    use super::settings;
    use crate::store::Db;
    use tauri::{AppHandle, State};

    type R<T> = Result<T, String>;

    #[tauri::command]
    pub async fn computer_use_get_status(
        app: AppHandle,
        db: State<'_, Db>,
    ) -> R<ComputerUseStatus> {
        diagnostics::status(&app, &db).await.map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub async fn computer_use_set_enabled(db: State<'_, Db>, enabled: bool) -> R<()> {
        settings::set_enabled(&db, enabled)
            .await
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub async fn computer_use_run_doctor(app: AppHandle) -> R<String> {
        diagnostics::run_doctor_text(&app)
            .await
            .map_err(|e| e.to_string())
    }
}
```

- [ ] **Step 2: Write settings tests first**

Create `src-tauri/src/computer_use/settings.rs` with the test module first:

```rust
use crate::store::{repo, Db};
use anyhow::Result;

pub const K_ENABLED: &str = "computer_use_enabled";

pub async fn enabled(db: &Db) -> Result<bool> {
    Ok(matches!(
        repo::get_setting(db, K_ENABLED).await?.as_deref(),
        Some("1") | Some("true")
    ))
}

pub async fn set_enabled(db: &Db, on: bool) -> Result<()> {
    repo::set_setting(db, K_ENABLED, if on { "1" } else { "0" }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn computer_use_enabled_defaults_false() {
        let db = Db::open_memory().await.unwrap();
        assert!(!enabled(&db).await.unwrap());
    }

    #[tokio::test]
    async fn computer_use_enabled_roundtrips() {
        let db = Db::open_memory().await.unwrap();
        set_enabled(&db, true).await.unwrap();
        assert!(enabled(&db).await.unwrap());
        set_enabled(&db, false).await.unwrap();
        assert!(!enabled(&db).await.unwrap());
    }
}
```

- [ ] **Step 3: Run the settings tests**

Run:

```bash
cd src-tauri && cargo test computer_use_enabled
```

Expected: the tests compile and pass. If `cargo` is not available in the local environment, record the exact shell error and continue with the remaining file edits; do not claim Rust tests passed.

- [ ] **Step 4: Register the Rust module and commands**

Modify `src-tauri/src/lib.rs`.

Add the module near the other backend modules:

```rust
mod computer_use;
```

Add commands to the `tauri::generate_handler!` list near other settings commands:

```rust
computer_use::commands::computer_use_get_status,
computer_use::commands::computer_use_set_enabled,
computer_use::commands::computer_use_run_doctor,
```

- [ ] **Step 5: Add frontend DTO types**

Modify `src/lib/types.ts`:

```ts
export type ComputerUseStatusKind =
  | "disabled"
  | "unsupported_platform"
  | "missing"
  | "not_executable"
  | "found"
  | "doctor_failed"
  | "permission_missing"
  | "ready"
  | "unknown";

export interface ComputerUseStatus {
  enabled: boolean;
  supported: boolean;
  status: ComputerUseStatusKind;
  helper_path: string | null;
  helper_version: string | null;
  doctor_summary: string;
  error: string | null;
}
```

- [ ] **Step 6: Add frontend API wrappers**

Modify the import in `src/lib/api.ts` to include `ComputerUseStatus`:

```ts
  ComputerUseStatus,
```

Add methods in `api` near other Settings APIs:

```ts
computerUseGetStatus: () =>
  invoke<ComputerUseStatus>("computer_use_get_status"),
computerUseSetEnabled: (enabled: boolean) =>
  invoke<void>("computer_use_set_enabled", { enabled }),
computerUseRunDoctor: () =>
  invoke<string>("computer_use_run_doctor"),
```

- [ ] **Step 7: Verify frontend types compile**

Run:

```bash
pnpm build
```

Expected: build may fail because `diagnostics`/`helper` modules are still empty references from `mod.rs`. If it fails with missing Rust modules during Tauri checks, continue to Task 2. It must not fail from TypeScript syntax errors in `api.ts` or `types.ts`.

- [ ] **Step 8: Commit Task 1**

```bash
git add src-tauri/src/computer_use/mod.rs src-tauri/src/computer_use/settings.rs src-tauri/src/lib.rs src/lib/types.ts src/lib/api.ts
git commit -m "feat(computer-use): add settings commands"
```

---

### Task 2: Helper Resolution and Diagnostics

**Files:**
- Create: `src-tauri/src/computer_use/helper.rs`
- Create: `src-tauri/src/computer_use/diagnostics.rs`
- Test: `src-tauri/src/computer_use/helper.rs`
- Test: `src-tauri/src/computer_use/diagnostics.rs`

- [ ] **Step 1: Write helper resolver tests**

Create `src-tauri/src/computer_use/helper.rs`:

```rust
use anyhow::Result;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const ENV_HELPER: &str = "ATLAS_COMPUTER_USE_HELPER";
pub const HELPER_NAME: &str = "open-computer-use";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum HelperState {
    Missing,
    NotExecutable,
    Found,
}

#[derive(Debug, Clone, Serialize)]
pub struct HelperInfo {
    pub state: HelperState,
    pub path: Option<PathBuf>,
    pub error: Option<String>,
}

pub fn helper_info(app: Option<&AppHandle>) -> HelperInfo {
    match resolve_helper_path(app) {
        Ok(path) => validate_helper_path(path),
        Err(err) => HelperInfo {
            state: HelperState::Missing,
            path: None,
            error: Some(err.to_string()),
        },
    }
}

pub fn resolve_helper_path(app: Option<&AppHandle>) -> Result<PathBuf> {
    if let Ok(path) = std::env::var(ENV_HELPER) {
        if !path.trim().is_empty() {
            return Ok(PathBuf::from(path));
        }
    }

    if let Some(app) = app {
        if let Ok(resources) = app.path().resource_dir() {
            return Ok(resources.join("sidecars").join(HELPER_NAME));
        }
    }

    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("sidecars")
        .join(HELPER_NAME))
}

pub fn validate_helper_path(path: PathBuf) -> HelperInfo {
    if !path.exists() {
        return HelperInfo {
            state: HelperState::Missing,
            path: Some(path),
            error: None,
        };
    }
    if !is_executable(&path) {
        return HelperInfo {
            state: HelperState::NotExecutable,
            path: Some(path),
            error: None,
        };
    }
    HelperInfo {
        state: HelperState::Found,
        path: Some(path),
        error: None,
    }
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn missing_helper_reports_missing() {
        let dir = tempfile::tempdir().unwrap();
        let info = validate_helper_path(dir.path().join("open-computer-use"));
        assert_eq!(info.state, HelperState::Missing);
        assert!(info.path.unwrap().ends_with("open-computer-use"));
    }

    #[test]
    fn non_executable_helper_reports_not_executable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("open-computer-use");
        std::fs::File::create(&path).unwrap();
        let info = validate_helper_path(path);
        assert_eq!(info.state, HelperState::NotExecutable);
    }

    #[cfg(unix)]
    #[test]
    fn executable_helper_reports_found() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("open-computer-use");
        let mut f = std::fs::File::create(&path).unwrap();
        writeln!(f, "#!/usr/bin/env bash").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let info = validate_helper_path(path);
        assert_eq!(info.state, HelperState::Found);
    }
}
```

- [ ] **Step 2: Run helper tests**

Run:

```bash
cd src-tauri && cargo test computer_use::helper
```

Expected: PASS.

- [ ] **Step 3: Add diagnostics implementation**

Create `src-tauri/src/computer_use/diagnostics.rs`:

```rust
use super::helper::{self, HelperState};
use super::settings;
use crate::store::Db;
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tauri::AppHandle;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct ComputerUseStatus {
    pub enabled: bool,
    pub supported: bool,
    pub status: String,
    pub helper_path: Option<String>,
    pub helper_version: Option<String>,
    pub doctor_summary: String,
    pub error: Option<String>,
}

pub async fn status(app: &AppHandle, db: &Db) -> Result<ComputerUseStatus> {
    let enabled = settings::enabled(db).await?;
    let supported = cfg!(target_os = "macos");
    if !enabled {
        return Ok(ComputerUseStatus {
            enabled,
            supported,
            status: "disabled".into(),
            helper_path: None,
            helper_version: None,
            doctor_summary: String::new(),
            error: None,
        });
    }
    if !supported {
        return Ok(ComputerUseStatus {
            enabled,
            supported,
            status: "unsupported_platform".into(),
            helper_path: None,
            helper_version: None,
            doctor_summary: String::new(),
            error: None,
        });
    }

    let info = helper::helper_info(Some(app));
    let helper_path = info.path.as_ref().map(|p| p.to_string_lossy().to_string());
    match info.state {
        HelperState::Missing => Ok(ComputerUseStatus {
            enabled,
            supported,
            status: "missing".into(),
            helper_path,
            helper_version: None,
            doctor_summary: String::new(),
            error: info.error,
        }),
        HelperState::NotExecutable => Ok(ComputerUseStatus {
            enabled,
            supported,
            status: "not_executable".into(),
            helper_path,
            helper_version: None,
            doctor_summary: String::new(),
            error: None,
        }),
        HelperState::Found => {
            let path = info
                .path
                .ok_or_else(|| anyhow!("helper state found without path"))?;
            let version = run_text(&path, &["--version"], Duration::from_secs(2))
                .await
                .ok()
                .map(clean_text);
            let doctor = run_text(&path, &["doctor"], Duration::from_secs(5)).await;
            let (status, doctor_summary, error) = match doctor {
                Ok(text) => {
                    let clean = clean_text(text);
                    let state = classify_doctor(&clean);
                    (state, clean, None)
                }
                Err(err) => ("doctor_failed".into(), String::new(), Some(err.to_string())),
            };
            Ok(ComputerUseStatus {
                enabled,
                supported,
                status,
                helper_path,
                helper_version: version,
                doctor_summary,
                error,
            })
        }
    }
}

pub async fn run_doctor_text(app: &AppHandle) -> Result<String> {
    let info = helper::helper_info(Some(app));
    let path = info
        .path
        .ok_or_else(|| anyhow!("open-computer-use helper was not found"))?;
    if info.state != HelperState::Found {
        return Err(anyhow!("open-computer-use helper is not executable"));
    }
    run_text(&path, &["doctor"], Duration::from_secs(10)).await
}

async fn run_text(path: &std::path::Path, args: &[&str], timeout: Duration) -> Result<String> {
    let mut child = Command::new(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let status = tokio::time::timeout(timeout, child.wait()).await??;
    let mut out = String::new();
    if let Some(mut s) = stdout.take() {
        let mut buf = String::new();
        let _ = s.read_to_string(&mut buf).await;
        out.push_str(&buf);
    }
    if let Some(mut s) = stderr.take() {
        let mut buf = String::new();
        let _ = s.read_to_string(&mut buf).await;
        if !buf.trim().is_empty() {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&buf);
        }
    }
    if !status.success() {
        return Err(anyhow!("helper exited with status {status}: {}", clean_text(out)));
    }
    Ok(out)
}

fn clean_text(text: String) -> String {
    text.lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn classify_doctor(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    if lower.contains("missing")
        || lower.contains("denied")
        || lower.contains("accessibility: false")
        || lower.contains("screen recording: false")
    {
        "permission_missing".into()
    } else {
        "ready".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doctor_text_with_missing_permission_is_permission_missing() {
        assert_eq!(classify_doctor("Accessibility: false"), "permission_missing");
    }

    #[test]
    fn doctor_text_without_missing_permission_is_ready() {
        assert_eq!(classify_doctor("Accessibility: granted\nScreen Recording: granted"), "ready");
    }
}
```

- [ ] **Step 4: Run diagnostics tests**

Run:

```bash
cd src-tauri && cargo test computer_use::diagnostics
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src-tauri/src/computer_use/helper.rs src-tauri/src/computer_use/diagnostics.rs
git commit -m "feat(computer-use): add helper diagnostics"
```

---

### Task 3: Stdio MCP Injection Builders

**Files:**
- Create: `src-tauri/src/computer_use/inject.rs`
- Modify: `src-tauri/src/computer_use/mod.rs`
- Test: `src-tauri/src/computer_use/inject.rs`

- [ ] **Step 1: Write injection builder implementation with tests**

Create `src-tauri/src/computer_use/inject.rs`:

```rust
use crate::bus::inject::Injection;
use std::path::{Path, PathBuf};

const SERVER: &str = "open_computer_use";
const STEM: &str = "computer-use";

pub fn build_stdio_injection(tool: &str, cwd: &Path, helper: &Path) -> Injection {
    match tool {
        "claude" => inject_claude(cwd, helper),
        "codex" => inject_codex(helper),
        "opencode" => {
            merge_opencode_config(cwd, helper);
            Injection { args: vec![] }
        }
        _ => Injection { args: vec![] },
    }
}

pub async fn maybe_inject(
    app: &tauri::AppHandle,
    db: &crate::store::Db,
    tool: &str,
    cwd: &Path,
) -> Injection {
    if !cfg!(target_os = "macos") {
        return Injection { args: vec![] };
    }
    if !crate::computer_use::settings::enabled(db).await.unwrap_or(false) {
        return Injection { args: vec![] };
    }
    let info = crate::computer_use::helper::helper_info(Some(app));
    if info.state != crate::computer_use::helper::HelperState::Found {
        return Injection { args: vec![] };
    }
    match info.path {
        Some(path) => build_stdio_injection(tool, cwd, &path),
        None => Injection { args: vec![] },
    }
}

fn inject_claude(cwd: &Path, helper: &Path) -> Injection {
    let file = format!(".atlas-{STEM}.mcp.json");
    let cfg = cwd.join(&file);
    let json = serde_json::json!({
        "mcpServers": {
            SERVER: {
                "command": helper.to_string_lossy(),
                "args": ["mcp"]
            }
        }
    });
    if std::fs::write(&cfg, serde_json::to_vec_pretty(&json).unwrap_or_default()).is_err() {
        return Injection { args: vec![] };
    }
    crate::git::git_exclude(cwd, &file);
    Injection {
        args: vec!["--mcp-config".into(), cfg.to_string_lossy().to_string()],
    }
}

fn inject_codex(helper: &Path) -> Injection {
    Injection {
        args: vec![
            "-c".into(),
            format!(
                "mcp_servers.{SERVER}.command={}",
                toml_quote(&helper.to_string_lossy())
            ),
            "-c".into(),
            format!("mcp_servers.{SERVER}.args=[\"mcp\"]"),
        ],
    }
}

fn toml_quote(value: &str) -> String {
    format!("{:?}", value)
}

fn merge_opencode_config(cwd: &Path, helper: &Path) {
    let path = cwd.join("opencode.json");
    let mut root: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }
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
            SERVER.to_string(),
            serde_json::json!({
                "type": "local",
                "command": [helper.to_string_lossy(), "mcp"],
                "enabled": true
            }),
        );
    }
    let _ = std::fs::write(&path, serde_json::to_vec_pretty(&root).unwrap_or_default());
    crate::git::git_exclude(cwd, "opencode.json");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn helper() -> PathBuf {
        PathBuf::from("/tmp/open-computer-use")
    }

    #[test]
    fn claude_injection_writes_stdio_mcp_config() {
        let dir = tempfile::tempdir().unwrap();
        let inj = build_stdio_injection("claude", dir.path(), &helper());
        assert_eq!(inj.args[0], "--mcp-config");
        let cfg = std::fs::read_to_string(dir.path().join(".atlas-computer-use.mcp.json")).unwrap();
        assert!(cfg.contains("open_computer_use"));
        assert!(cfg.contains("/tmp/open-computer-use"));
        assert!(cfg.contains("\"mcp\""));
    }

    #[test]
    fn codex_injection_uses_inline_stdio_config() {
        let dir = tempfile::tempdir().unwrap();
        let inj = build_stdio_injection("codex", dir.path(), &helper());
        assert!(inj.args.contains(&"-c".to_string()));
        let joined = inj.args.join("\n");
        assert!(joined.contains("mcp_servers.open_computer_use.command"));
        assert!(joined.contains("mcp_servers.open_computer_use.args=[\"mcp\"]"));
    }

    #[test]
    fn opencode_injection_preserves_existing_config_and_adds_local_mcp() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("opencode.json"),
            r#"{"mcp":{"existing":{"type":"remote","url":"http://127.0.0.1/mcp"}}}"#,
        )
        .unwrap();
        let inj = build_stdio_injection("opencode", dir.path(), &helper());
        assert!(inj.args.is_empty());
        let merged: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.path().join("opencode.json")).unwrap())
                .unwrap();
        assert!(merged["mcp"]["existing"].is_object());
        assert_eq!(merged["mcp"]["open_computer_use"]["type"], "local");
        assert_eq!(merged["mcp"]["open_computer_use"]["command"][1], "mcp");
    }

    #[test]
    fn unknown_tool_gets_no_injection() {
        let dir = tempfile::tempdir().unwrap();
        let inj = build_stdio_injection("none", dir.path(), &helper());
        assert!(inj.args.is_empty());
    }
}
```

- [ ] **Step 2: Run injection tests**

Run:

```bash
cd src-tauri && cargo test computer_use::inject
```

Expected: PASS.

- [ ] **Step 3: Run git status to confirm no global config was written**

Run:

```bash
git status --short
```

Expected: only repository files under the task scope are changed. There must be no changes under user home config files because this code only writes worktree-local config in tests.

- [ ] **Step 4: Commit Task 3**

```bash
git add src-tauri/src/computer_use/inject.rs src-tauri/src/computer_use/mod.rs
git commit -m "feat(computer-use): build stdio mcp injection"
```

---

### Task 4: Wire Injection Into New Sessions

**Files:**
- Modify: `src-tauri/src/lead_chat/commands.rs:135-146`
- Modify: `src-tauri/src/lead_chat/commands.rs:448-466`
- Test: `src-tauri/src/lead_chat/commands.rs` compile coverage through Rust tests

- [ ] **Step 1: Add Computer Use injection to lead engine construction**

Modify `lead_engine` in `src-tauri/src/lead_chat/commands.rs`. Replace the existing `extra` construction:

```rust
let mut extra = ask.args;
extra.extend(inj.args);
```

with:

```rust
let computer = crate::computer_use::inject::maybe_inject(app, db, &t.lead_tool, &cwd).await;
let mut extra = ask.args;
extra.extend(inj.args);
extra.extend(computer.args);
```

This injects Computer Use only when a new lead engine is created. It does not hot-reload existing lead engines.

- [ ] **Step 2: Add Computer Use injection to worker/run engine construction**

Modify `chat_open_worker_impl` in `src-tauri/src/lead_chat/commands.rs`. Replace:

```rust
let mut extra = ask.args;
extra.extend(inj.args);
```

with:

```rust
let computer = crate::computer_use::inject::maybe_inject(app, db, &dir.tool, &cwd).await;
let mut extra = ask.args;
extra.extend(inj.args);
extra.extend(computer.args);
```

This covers both repository-backed workers and repo-less runs because `chat_open_run` calls the same implementation with `repo_id == 0`.

- [ ] **Step 3: Run targeted Rust tests**

Run:

```bash
cd src-tauri && cargo test computer_use
```

Expected: PASS.

- [ ] **Step 4: Run a broader backend compile check**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS. If the local environment lacks `cargo`, record the exact error and run `pnpm build` during frontend verification; do not mark Rust verification as passed.

- [ ] **Step 5: Commit Task 4**

```bash
git add src-tauri/src/lead_chat/commands.rs
git commit -m "feat(computer-use): inject into new sessions"
```

---

### Task 5: Settings UI

**Files:**
- Create: `src/settings/ComputerUse.tsx`
- Modify: `src/nav/SettingsDialog.tsx`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Create the Settings panel component**

Create `src/settings/ComputerUse.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/Button";
import { Toggle } from "../components/ui/Toggle";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import type { ComputerUseStatus } from "../lib/types";

export function ComputerUseSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [doctor, setDoctor] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const next = await api.computerUseGetStatus();
      setStatus(next);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const setEnabled = async (enabled: boolean) => {
    await api.computerUseSetEnabled(enabled);
    await reload();
  };

  const runDoctor = async () => {
    setLoading(true);
    try {
      const output = await api.computerUseRunDoctor();
      setDoctor(output);
      await reload();
    } catch (e: unknown) {
      setDoctor(String(e));
    } finally {
      setLoading(false);
    }
  };

  const enabled = status?.enabled ?? false;

  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup title={t("settings.computerUseGroup")}>
        <SettingRow
          label={t("settings.computerUseEnable")}
          hint={t("settings.computerUseEnableHint")}
        >
          <Toggle
            on={enabled}
            onChange={(v) => void setEnabled(v)}
            label={t("settings.computerUseEnable")}
          />
        </SettingRow>
        <div className="px-3 py-3 text-[12px] leading-relaxed text-ink-muted">
          {t("settings.computerUseTrustHint")}
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settings.computerUseDiagnostics")}>
        <SettingRow label={t("settings.computerUseStatus")}>
          <StatusText status={status} />
        </SettingRow>
        <SettingRow label={t("settings.computerUseHelperPath")}>
          <code className="max-w-[360px] truncate rounded-[var(--radius-sm)] bg-bg px-2 py-1 text-[11px] text-ink-muted">
            {status?.helper_path ?? t("settings.computerUseNoHelper")}
          </code>
        </SettingRow>
        <SettingRow label={t("settings.computerUseVersion")}>
          <span className="text-[12px] text-ink-muted">
            {status?.helper_version || t("settings.computerUseUnknown")}
          </span>
        </SettingRow>
        <div className="flex justify-end gap-2 px-3 py-3">
          <Button variant="default" onClick={() => void reload()} disabled={loading}>
            {loading ? t("settings.computerUseChecking") : t("settings.computerUseRecheck")}
          </Button>
          <Button variant="default" onClick={() => void runDoctor()} disabled={loading || !enabled}>
            {t("settings.computerUseRunDoctor")}
          </Button>
        </div>
        {(doctor || status?.doctor_summary || status?.error) && (
          <pre className="max-h-48 overflow-auto border-t border-border bg-bg px-3 py-3 text-[11px] leading-relaxed text-ink-muted">
            {doctor || status?.doctor_summary || status?.error}
          </pre>
        )}
      </SettingsGroup>
    </div>
  );
}

function StatusText({ status }: { status: ComputerUseStatus | null }) {
  const { t } = useTranslation();
  const value = status?.status ?? "unknown";
  const ok = value === "ready" || value === "found";
  const warn = value === "permission_missing" || value === "doctor_failed";
  return (
    <span
      className={cn(
        "text-[12px]",
        ok ? "text-success" : warn ? "text-waiting" : "text-danger",
      )}
    >
      {t(`settings.computerUse_${value}`)}
    </span>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      <div
        className={cn(
          "flex flex-col rounded-[var(--radius-lg)] border border-border bg-surface",
          "[&>div+div]:border-t [&>div+div]:border-border",
        )}
      >
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[72px] items-center gap-4 px-3 py-3">
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-ink">{label}</div>
        {hint && <p className="mt-1 max-w-[58ch] text-[12px] leading-relaxed text-ink-faint">{hint}</p>}
      </div>
      <span className="min-w-4 flex-1" />
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Add the Settings navigation entry**

Modify `src/nav/SettingsDialog.tsx`.

Update imports:

```tsx
  MousePointer2,
```

Add:

```tsx
import { ComputerUseSettings } from "../settings/ComputerUse";
```

Extend the page union:

```tsx
type SettingsPage = "general" | "appearance" | "automation" | "skills" | "im" | "backup" | "computerUse";
```

Add a nav item under `settings.groupIntegrations`:

```tsx
{ id: "computerUse", icon: MousePointer2, labelKey: "settings.computerUse", implemented: true },
```

Update the render branch:

```tsx
            ) : active === "computerUse" ? (
              <ComputerUseSettings />
```

Place that branch before the final `SkillsSettings` fallback.

- [ ] **Step 3: Add English i18n keys**

Modify `src/i18n/en.ts` inside `settings`:

```ts
computerUse: "Computer Use",
computerUseGroup: "Computer Use",
computerUseEnable: "Enable for new sessions",
computerUseEnableHint: "New agent sessions can control local macOS apps through the bundled helper.",
computerUseTrustHint: "When enabled, Atlas does not ask before each app or action. Agents can operate visible GUI apps through macOS permissions and the helper's own limits.",
computerUseDiagnostics: "Diagnostics",
computerUseStatus: "Status",
computerUseHelperPath: "Helper",
computerUseVersion: "Version",
computerUseNoHelper: "No helper found",
computerUseUnknown: "Unknown",
computerUseChecking: "Checking...",
computerUseRecheck: "Recheck",
computerUseRunDoctor: "Run doctor",
computerUse_disabled: "Disabled",
computerUse_unsupported_platform: "macOS only",
computerUse_missing: "Missing",
computerUse_not_executable: "Not executable",
computerUse_found: "Found",
computerUse_doctor_failed: "Doctor failed",
computerUse_permission_missing: "Permission missing",
computerUse_ready: "Ready",
computerUse_unknown: "Unknown",
```

- [ ] **Step 4: Add Chinese i18n keys**

Modify `src/i18n/zh.ts` inside `settings`:

```ts
computerUse: "Computer Use",
computerUseGroup: "Computer Use",
computerUseEnable: "为新会话启用",
computerUseEnableHint: "新的 agent 会话可以通过内置 helper 操作本机 macOS 应用。",
computerUseTrustHint: "开启后，Atlas 不会在每个应用或每次操作前确认。Agent 可以在 macOS 权限和 helper 能力边界内直接操作可见 GUI。",
computerUseDiagnostics: "诊断",
computerUseStatus: "状态",
computerUseHelperPath: "Helper",
computerUseVersion: "版本",
computerUseNoHelper: "未找到 helper",
computerUseUnknown: "未知",
computerUseChecking: "检查中...",
computerUseRecheck: "重新检查",
computerUseRunDoctor: "运行 doctor",
computerUse_disabled: "已关闭",
computerUse_unsupported_platform: "仅支持 macOS",
computerUse_missing: "缺失",
computerUse_not_executable: "不可执行",
computerUse_found: "已找到",
computerUse_doctor_failed: "doctor 失败",
computerUse_permission_missing: "权限缺失",
computerUse_ready: "可用",
computerUse_unknown: "未知",
```

- [ ] **Step 5: Run TypeScript build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/settings/ComputerUse.tsx src/nav/SettingsDialog.tsx src/i18n/en.ts src/i18n/zh.ts src/lib/api.ts src/lib/types.ts
git commit -m "feat(settings): add computer use panel"
```

---

### Task 6: Bundle Metadata and Tauri Resource Wiring

**Files:**
- Create: `src-tauri/sidecars/README.md`
- Create: `src-tauri/sidecars/open-computer-use.version.json`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Create sidecar directory docs**

Create `src-tauri/sidecars/README.md`:

```markdown
# Computer Use Sidecar

Atlas bundles a pinned `open-computer-use` helper for macOS Computer Use.

Expected development path:

```text
src-tauri/sidecars/open-computer-use
```

The binary is not fetched at runtime and Atlas must not call upstream installer commands that write user-global agent config.

To update the helper:

1. Pick a release or commit from `https://github.com/iFurySt/open-codex-computer-use`.
2. Build or download the macOS `open-computer-use` binary.
3. Put it at `src-tauri/sidecars/open-computer-use`.
4. Ensure it is executable: `chmod 755 src-tauri/sidecars/open-computer-use`.
5. Update `open-computer-use.version.json`.
6. Run Settings diagnostics and the TextEdit manual smoke test.
```

- [ ] **Step 2: Create version metadata**

Create `src-tauri/sidecars/open-computer-use.version.json`:

```json
{
  "name": "open-computer-use",
  "upstream": "https://github.com/iFurySt/open-codex-computer-use",
  "license": "MIT",
  "pinnedRef": "b753b790cace188152ffb755cd13b2ac9ff6ebf7",
  "binary": "open-computer-use",
  "notes": "Pinned to upstream main commit b753b790cace188152ffb755cd13b2ac9ff6ebf7, resolved on 2026-06-16 for the first Atlas integration plan."
}
```

Before release, verify that the bundled helper binary was built from commit `b753b790cace188152ffb755cd13b2ac9ff6ebf7` or update this metadata and the implementation notes in the same commit that changes the helper.

- [ ] **Step 3: Wire sidecar resource into Tauri config**

Modify `src-tauri/tauri.conf.json` under `"bundle"`:

```json
"resources": [
  "sidecars/open-computer-use",
  "sidecars/open-computer-use.version.json"
]
```

If the local implementation cannot commit the actual binary, keep the resource entry only after confirming Tauri tolerates a missing resource in dev. If Tauri requires the resource to exist, add the metadata file now and add the binary in the release-prep task before enabling the resource entry.

- [ ] **Step 4: Run config validation through build**

Run:

```bash
pnpm build
```

Expected: PASS for frontend. If Tauri config validation occurs and fails because the binary is intentionally absent, remove the binary resource entry and keep only the metadata resource until the binary is added.

- [ ] **Step 5: Commit Task 6**

```bash
git add src-tauri/sidecars/README.md src-tauri/sidecars/open-computer-use.version.json src-tauri/tauri.conf.json
git commit -m "chore(computer-use): add sidecar bundle metadata"
```

---

### Task 7: Final Verification

**Files:**
- No planned source changes unless verification reveals a defect.

- [ ] **Step 1: Run frontend build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 2: Run Rust tests if available**

Run:

```bash
cd src-tauri && cargo test computer_use
```

Expected: PASS. If `cargo` is not installed in this environment, record the exact error and state that Rust tests were not run.

- [ ] **Step 3: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 4: Manual macOS smoke test**

Run the app:

```bash
pnpm tauri dev
```

In the app:

1. Open Settings.
2. Open Computer Use.
3. Enable Computer Use for new sessions.
4. Run Recheck.
5. Run doctor.
6. Start a new agent session.
7. Ask the agent to call `list_apps` or `get_app_state`.
8. Open TextEdit.
9. Ask the agent to type `Atlas Computer Use smoke test`.
10. Disable Computer Use.
11. Start another new session.
12. Confirm the new session does not receive the `open_computer_use` MCP config.

Expected: the enabled session can use the helper once macOS permissions are granted; the disabled new session does not inject Computer Use.

- [ ] **Step 5: Inspect for unintended global config writes**

Run:

```bash
git status --short
```

Then manually inspect user-global config timestamps only if needed:

```bash
ls -l ~/.codex/config.toml ~/.claude.json ~/.config/opencode/opencode.json 2>/dev/null
```

Expected: implementation never modifies those files. If timestamps changed, identify the command that changed them before proceeding.

- [ ] **Step 6: Commit verification fixes if any**

If verification required fixes:

```bash
git add <fixed-files>
git commit -m "fix(computer-use): address verification findings"
```

If no fixes were needed, do not create an empty commit.

---

## Implementation Notes

- Keep all Computer Use assumptions inside `src-tauri/src/computer_use/`.
- The first version is a full-trust direct-MCP integration. Do not add app allowlists, high-risk action gates, or an Atlas proxy.
- Do not hot-inject into already-running sessions.
- Missing helper and missing macOS permissions are diagnostics, not fatal app startup errors.
- Production Rust paths must not use `unwrap`, `expect`, or `panic`.
- Test modules may use `unwrap` and `expect`.
- If the chosen Codex stdio MCP `-c` syntax fails during manual verification, update only `computer_use::inject::inject_codex` and its tests.

## Required Final Report

When implementation finishes, report:

- Commits created.
- Whether `pnpm build` passed.
- Whether `cargo test computer_use` passed or why it was not run.
- Whether `git diff --check` passed.
- macOS manual smoke result, including whether Accessibility and Screen Recording were granted.
- Any remaining risk around bundled helper version, code signing, or Tauri resource packaging.
