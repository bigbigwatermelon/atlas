//! Detect which coding-agent CLIs are installed locally, so Settings can offer a
//! sensible default tool and flag missing ones. Resolution mirrors how sessions
//! spawn (the app's PATH), so "installed" means "weft can actually run it".

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct ToolStatus {
    pub tool: String,
    pub installed: bool,
    pub version: Option<String>,
}

const TOOLS: [&str; 3] = ["claude", "codex", "opencode"];

fn probe(tool: &str) -> ToolStatus {
    match std::process::Command::new(tool).arg("--version").output() {
        Ok(o) if o.status.success() => {
            let raw = String::from_utf8_lossy(&o.stdout);
            let version = raw.trim().lines().next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            ToolStatus { tool: tool.to_string(), installed: true, version }
        }
        _ => ToolStatus { tool: tool.to_string(), installed: false, version: None },
    }
}

/// Probe each known CLI's `--version`. Best-effort; a missing binary just reports
/// installed=false. Runs off the async runtime since it shells out.
#[tauri::command]
pub async fn detect_tools() -> Result<Vec<ToolStatus>, String> {
    tokio::task::spawn_blocking(|| TOOLS.iter().map(|t| probe(t)).collect::<Vec<_>>())
        .await
        .map_err(|e| e.to_string())
}
