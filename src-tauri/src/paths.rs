//! Canonical weft home + derived paths. Everything persistent lives under
//! ~/.weft so worktree cwds stay stable across restarts (resume depends on it).

use std::path::PathBuf;

/// ~/.weft, created if missing.
pub fn weft_home() -> std::io::Result<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no home dir"))?;
    let dir = home.join(".weft");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// ~/.weft/weft.db
pub fn db_path() -> std::io::Result<PathBuf> {
    Ok(weft_home()?.join("weft.db"))
}

/// ~/.weft/worktrees
pub fn worktree_home() -> std::io::Result<PathBuf> {
    let dir = weft_home()?.join("worktrees");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_under_weft_home() {
        let home = weft_home().unwrap();
        assert!(home.ends_with(".weft"));
        assert!(db_path().unwrap().ends_with("weft.db"));
        assert!(worktree_home().unwrap().ends_with("worktrees"));
    }
}
