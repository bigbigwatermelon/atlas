mod batch;
mod claude;
mod git;
mod pty;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            pty::open_session,
            pty::resume_session,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
