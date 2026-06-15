use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

pub const ENV_HELPER: &str = "ATLAS_COMPUTER_USE_HELPER";
pub const HELPER_NAME: &str = "open-computer-use";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HelperState {
    Missing,
    NotExecutable,
    Found,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HelperInfo {
    pub state: HelperState,
    pub path: Option<String>,
    pub error: Option<String>,
}

pub fn resolve_helper_path(app: Option<&AppHandle>) -> HelperInfo {
    if let Ok(path) = std::env::var(ENV_HELPER) {
        if !path.trim().is_empty() {
            return validate_helper_path(PathBuf::from(path));
        }
    }

    if let Some(app) = app {
        return match app.path().resource_dir() {
            Ok(dir) => validate_helper_path(dir.join("sidecars").join(HELPER_NAME)),
            Err(err) => HelperInfo {
                state: HelperState::Missing,
                path: None,
                error: Some(format!("could not resolve resource directory: {err}")),
            },
        };
    }

    validate_helper_path(dev_helper_path())
}

pub fn validate_helper_path(path: impl AsRef<Path>) -> HelperInfo {
    let path = path.as_ref();
    let path_text = path.to_string_lossy().into_owned();

    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == ErrorKind::NotFound => {
            return HelperInfo {
                state: HelperState::Missing,
                path: Some(path_text),
                error: Some(format!("helper not found: {}", path.display())),
            };
        }
        Err(err) => {
            return HelperInfo {
                state: HelperState::NotExecutable,
                path: Some(path_text),
                error: Some(format!(
                    "could not inspect helper {}: {err}",
                    path.display()
                )),
            };
        }
    };

    if !metadata.is_file() {
        return HelperInfo {
            state: HelperState::NotExecutable,
            path: Some(path_text),
            error: Some(format!("helper is not a file: {}", path.display())),
        };
    }

    if !is_executable(&metadata) {
        return HelperInfo {
            state: HelperState::NotExecutable,
            path: Some(path_text),
            error: Some(format!("helper is not executable: {}", path.display())),
        };
    }

    HelperInfo {
        state: HelperState::Found,
        path: Some(path_text),
        error: None,
    }
}

fn dev_helper_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("sidecars")
        .join(HELPER_NAME)
}

#[cfg(unix)]
fn is_executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &std::fs::Metadata) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_helper_is_reported() {
        let tmp = tempfile::tempdir().unwrap();
        let helper = tmp.path().join("missing-helper");

        let info = validate_helper_path(&helper);

        assert_eq!(info.state, HelperState::Missing);
        assert_eq!(
            info.path.as_deref(),
            Some(helper.to_string_lossy().as_ref())
        );
        assert!(info.error.unwrap().contains("helper not found"));
    }

    #[cfg(unix)]
    #[test]
    fn non_executable_helper_is_reported() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let helper = tmp.path().join("open-computer-use");
        std::fs::write(&helper, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o600)).unwrap();

        let info = validate_helper_path(&helper);

        assert_eq!(info.state, HelperState::NotExecutable);
        assert_eq!(
            info.path.as_deref(),
            Some(helper.to_string_lossy().as_ref())
        );
        assert!(info.error.unwrap().contains("not executable"));
    }

    #[cfg(unix)]
    #[test]
    fn executable_helper_is_found() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let helper = tmp.path().join("open-computer-use");
        std::fs::write(&helper, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o700)).unwrap();

        let info = validate_helper_path(&helper);

        assert_eq!(info.state, HelperState::Found);
        assert_eq!(
            info.path.as_deref(),
            Some(helper.to_string_lossy().as_ref())
        );
        assert_eq!(info.error, None);
    }
}
