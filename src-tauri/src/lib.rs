pub mod paths;
pub mod slug;
pub mod store;
pub mod git;
pub mod materialize;
mod batch;
pub mod bus;
mod claude;
mod drivers;
mod pty;
mod commands;

/// The bus server's base URL, e.g. "http://127.0.0.1:54321".
pub struct BusBase(pub String);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Open the DB synchronously before building the app.
    let db = tauri::async_runtime::block_on(async {
        store::Db::open_default().await.expect("open weft.db")
    });

    // Start the thread-bus HTTP MCP server on an ephemeral port.
    let bus = bus::BusRegistry::new();
    let bus_base: String = {
        let bus = bus.clone();
        tauri::async_runtime::block_on(async move {
            let (base, _handle) = bus::server::serve(bus).await.expect("start bus server");
            // leak the JoinHandle: the server lives for the app's lifetime
            base
        })
    };
    eprintln!("[weft] thread bus on {bus_base}");

    let mut builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .manage(db)
        .manage(pty::PtyState::default())
        .manage(bus)
        .manage(BusBase(bus_base))
        .invoke_handler(tauri::generate_handler![
            commands::create_workspace,
            commands::list_workspaces,
            commands::add_repo_ref,
            commands::create_thread,
            commands::list_threads,
            commands::list_repos,
            commands::list_directions,
            commands::list_direction_repos,
            commands::create_direction,
            commands::list_worktrees,
            commands::repo_diff,
            commands::delete_thread,
            pty::open_session,
            pty::resume_session,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
