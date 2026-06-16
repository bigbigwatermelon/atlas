//! Tauri command surface for the task/run model. Thin wrappers; persistence
//! still lives in the historical store module.

use crate::store::{entities, repo, Db};
use tauri::State;

type R<T> = Result<T, String>;
fn e<E: ToString>(x: E) -> String {
    x.to_string()
}

#[tauri::command]
pub async fn list_workspaces(db: State<'_, Db>) -> R<Vec<entities::workspace::Model>> {
    repo::list_workspaces(&db).await.map_err(e)
}

/// Return the id of the most-recently created task list, creating a "Default"
/// list first if the DB has none. Kept as a free function so integration tests
/// can drive it without a Tauri runtime.
pub async fn ensure_default_workspace_inner(db: &Db) -> R<i32> {
    if let Some(w) = repo::latest_workspace(db).await.map_err(e)? {
        return Ok(w.id);
    }
    let created = repo::create_workspace(db, "Default").await.map_err(e)?;
    Ok(created.id)
}

#[tauri::command]
pub async fn ensure_default_workspace(db: State<'_, Db>) -> R<i32> {
    ensure_default_workspace_inner(&db).await
}

#[tauri::command]
pub async fn create_thread(
    db: State<'_, Db>,
    workspace_id: i32,
    title: String,
    kind: String,
) -> R<entities::thread::Model> {
    let tool = crate::tools::default_tool(&db).await;
    repo::create_thread(&db, workspace_id, &title, &kind, &tool)
        .await
        .map_err(e)
}

#[tauri::command]
pub async fn rename_thread(
    db: State<'_, Db>,
    thread_id: i32,
    title: String,
) -> R<entities::thread::Model> {
    repo::rename_thread(&db, thread_id, &title).await.map_err(e)
}

#[tauri::command]
pub async fn list_threads(db: State<'_, Db>, workspace_id: i32) -> R<Vec<entities::thread::Model>> {
    repo::list_threads(&db, workspace_id).await.map_err(e)
}

/// A thread's roll-up for the workspace board (cards = threads). Live state
/// (sessions / needs / asks) is overlaid client-side; this is the structure.
#[derive(serde::Serialize)]
pub struct ThreadOverview {
    pub thread_id: i32,
    pub title: String,
    pub kind: String,
    pub direction_ids: Vec<i32>,
    /// Stored lifecycle status of each direction (same order as direction_ids),
    /// so the workspace board derives the thread's phase deterministically.
    pub statuses: Vec<String>,
}

/// Portfolio view of the default task list: every thread with its runs.
#[tauri::command]
pub async fn workspace_overview(db: State<'_, Db>, workspace_id: i32) -> R<Vec<ThreadOverview>> {
    let threads = repo::list_threads(&db, workspace_id).await.map_err(e)?;
    let mut out = Vec::new();
    for t in threads {
        let dirs = repo::list_directions(&db, t.id).await.map_err(e)?;
        out.push(ThreadOverview {
            thread_id: t.id,
            title: t.title,
            kind: t.kind,
            direction_ids: dirs.iter().map(|d| d.id).collect(),
            statuses: dirs.iter().map(|d| d.status.clone()).collect(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn list_directions(
    db: State<'_, Db>,
    thread_id: i32,
) -> R<Vec<entities::direction::Model>> {
    repo::list_directions(&db, thread_id).await.map_err(e)
}

#[tauri::command]
pub async fn create_run(
    db: State<'_, Db>,
    thread_id: i32,
    name: String,
    tool: String,
) -> R<entities::direction::Model> {
    repo::create_direction(&db, thread_id, &name, &tool, "plan+impl")
        .await
        .map_err(e)
}

/// Set a run's lifecycle status (human override; the agent does this via the
/// bus tool). queued | planning | working | done — freely reversible.
#[tauri::command]
pub async fn set_task_status(db: State<'_, Db>, direction_id: i32, status: String) -> R<()> {
    if !["queued", "planning", "working", "done"].contains(&status.as_str()) {
        return Err(format!(
            "invalid status '{status}'; use one of: queued, planning, working, done"
        ));
    }
    repo::set_direction_status(&db, direction_id, &status)
        .await
        .map_err(e)
}

#[tauri::command]
pub async fn rename_direction(
    db: State<'_, Db>,
    direction_id: i32,
    name: String,
) -> R<entities::direction::Model> {
    repo::rename_direction(&db, direction_id, &name)
        .await
        .map_err(e)
}

/// Observe-mode (§4.4): the agent's own transcript, normalized to app-native
/// events so the chat view never depends on rendering the live TUI.
#[tauri::command]
pub async fn read_transcript(cwd: String, tool: String) -> R<Vec<crate::sidecar::NormEvent>> {
    Ok(crate::sidecar::read_transcript(std::path::Path::new(&cwd), &tool).await)
}

#[tauri::command]
pub async fn delete_thread(db: State<'_, Db>, thread_id: i32) -> R<()> {
    repo::delete_thread_cascade(&db, thread_id).await.map_err(e)
}

#[tauri::command]
pub fn thread_messages(
    bus: tauri::State<'_, crate::bus::BusRegistry>,
    thread_id: i32,
) -> R<Vec<crate::bus::Msg>> {
    Ok(bus.log(thread_id))
}

/// One thing waiting on the human, with enough context to act on it cold.
#[derive(serde::Serialize)]
pub struct NeedItem {
    pub ask_id: u64,
    pub thread_id: i32,
    pub thread_title: String,
    pub direction_id: i32,
    pub direction_name: String,
    pub text: String,
    pub ts: u64,
}

/// Aggregate every open agent→human question across the workspace's threads.
/// This is the data behind the "Needs-you" surface — a pure bus + structure
/// projection, no TUI parsing.
#[tauri::command]
pub async fn needs_you(
    db: State<'_, Db>,
    bus: tauri::State<'_, crate::bus::BusRegistry>,
    workspace_id: i32,
) -> R<Vec<NeedItem>> {
    let threads = repo::list_threads(&db, workspace_id).await.map_err(e)?;
    let mut items: Vec<NeedItem> = Vec::new();
    for t in threads {
        let asks = bus.open_asks(t.id);
        if asks.is_empty() {
            continue;
        }
        let dirs = repo::list_directions(&db, t.id).await.map_err(e)?;
        for a in asks {
            let dir_id = a.from.parse::<i32>().unwrap_or(-1);
            let dir_name = dirs
                .iter()
                .find(|d| d.id == dir_id)
                .map(|d| d.name.clone())
                .unwrap_or_else(|| a.from.clone());
            items.push(NeedItem {
                ask_id: a.id,
                thread_id: t.id,
                thread_title: t.title.clone(),
                direction_id: dir_id,
                direction_name: dir_name,
                text: a.text,
                ts: a.ts,
            });
        }
    }
    items.sort_by_key(|i| i.ts);
    Ok(items)
}

/// The resolved default coding tool plus the user's explicit choice (if any).
/// `tool` is what new threads/directions get; `configured != tool` means the
/// configured CLI is missing and we fell back.
#[derive(serde::Serialize)]
pub struct DefaultTool {
    pub tool: String,
    pub configured: Option<String>,
}

#[tauri::command]
pub async fn get_default_tool(db: State<'_, Db>) -> R<DefaultTool> {
    let configured = repo::get_setting(&db, "default_tool").await.map_err(e)?;
    let tool = crate::detect::resolve_default_tool(configured.as_deref());
    Ok(DefaultTool { tool, configured })
}

#[tauri::command]
pub async fn set_default_tool(db: State<'_, Db>, tool: String) -> R<()> {
    if !crate::detect::TOOL_PRIORITY.contains(&tool.as_str()) {
        return Err(format!(
            "unknown tool {tool:?}; expected one of {:?}",
            crate::detect::TOOL_PRIORITY
        ));
    }
    repo::set_setting(&db, "default_tool", &tool)
        .await
        .map_err(e)
}

/// Answer an open ask; the reply lands in the asking direction's bus inbox.
#[tauri::command]
pub fn answer_ask(
    bus: tauri::State<'_, crate::bus::BusRegistry>,
    thread_id: i32,
    ask_id: u64,
    text: String,
) -> R<()> {
    if bus.answer_ask(thread_id, ask_id, &text) {
        Ok(())
    } else {
        Err("that question was already answered or no longer exists".into())
    }
}

/// All pending permission Asks across the workspace (the Ask Bridge → Needs-you),
/// enriched with the owning thread's title and the asking task's name so the card
/// says which thread / which task is asking.
#[tauri::command]
pub async fn pending_asks(
    db: State<'_, Db>,
    asks: tauri::State<'_, crate::ask::AskRegistry>,
) -> R<Vec<crate::ask::Ask>> {
    let mut open = asks.open();
    for a in &mut open {
        if let Ok(Some(t)) = repo::get_thread(&db, a.thread).await {
            a.thread_title = t.title;
        }
        if let Ok(id) = a.dir.parse::<i32>() {
            if let Ok(Some(d)) = repo::get_direction(&db, id).await {
                a.dir_name = d.name;
            }
        }
    }
    Ok(open)
}

/// Dangerous mode (global): every agent's tool asks auto-allow, no prompts.
#[tauri::command]
pub fn set_dangerous_mode(asks: tauri::State<'_, crate::ask::AskRegistry>, on: bool) -> R<()> {
    asks.set_dangerous(on);
    Ok(())
}

/// Keep-awake (global): hold a "prevent idle sleep" OS assertion while any
/// session is busy (display may still sleep). Re-pushed from the frontend on
/// every launch — the backend state is in-memory, default ON.
#[tauri::command]
pub fn set_keep_awake(power: tauri::State<'_, crate::power::PowerGuard>, on: bool) -> R<()> {
    power.set_enabled(on);
    Ok(())
}

/// Runaway-guardrail caps (§7 跑飞护栏), enforced per busy turn by the chat
/// engine's watchdog (lead_chat::engine::spawn_watchdog). Configurable at
/// runtime from Settings; seeded from the ATLAS_* env defaults so an env
/// override still sets the initial value. 0 on either disables that cap.
pub struct GuardrailState {
    inner: std::sync::Mutex<(u64, u64)>, // (idle_secs, wall_secs)
}

impl Default for GuardrailState {
    fn default() -> Self {
        Self {
            inner: std::sync::Mutex::new((
                env_secs("ATLAS_IDLE_WATCHDOG_SECS", 1800), // 30 min
                env_secs("ATLAS_WALL_CAP_SECS", 7200),      // 2 h
            )),
        }
    }
}

impl GuardrailState {
    pub fn set(&self, idle_secs: u64, wall_secs: u64) {
        *self.inner.lock().unwrap_or_else(|e| e.into_inner()) = (idle_secs, wall_secs);
    }
    /// (idle_cap_secs, wall_cap_secs)
    pub fn get(&self) -> (u64, u64) {
        *self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn env_secs(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

/// Runaway guardrails (§7): idle + wall-clock caps in seconds; 0 disables that
/// cap. See the GuardrailState note on enforcement.
#[tauri::command]
pub fn set_guardrails(
    guard: tauri::State<'_, GuardrailState>,
    idle_secs: u64,
    wall_secs: u64,
) -> R<()> {
    guard.set(idle_secs, wall_secs);
    Ok(())
}

/// Read-only snapshot backing the observe surface: the run directory plus the
/// latest session's identity/status if any.
#[derive(serde::Serialize, Clone)]
pub struct ObserveRef {
    pub run_dir: String,
    pub tool: String,
    pub session_id: Option<i32>,
    pub native_id: Option<String>,
    pub status: Option<String>,
}

#[tauri::command]
pub async fn session_for(
    db: State<'_, Db>,
    direction_id: i32,
) -> R<Option<ObserveRef>> {
    session_for_inner(&db, direction_id).await
}

async fn session_for_inner(db: &Db, direction_id: i32) -> R<Option<ObserveRef>> {
    let dir = match repo::get_direction(db, direction_id).await.map_err(e)? {
        Some(d) => d,
        None => return Ok(None),
    };

    use sea_orm::EntityTrait;
    let thread = repo::get_thread(db, dir.thread_id)
        .await
        .map_err(e)?
        .ok_or_else(|| "thread not found".to_string())?;
    let workspace = entities::workspace::Entity::find_by_id(thread.workspace_id)
        .one(&db.0)
        .await
        .map_err(e)?
        .ok_or_else(|| "workspace not found".to_string())?;
    let cwd = crate::paths::run_home(&workspace.slug, &thread.slug, &dir.slug).map_err(e)?;
    let latest = repo::latest_session_for(db, direction_id).await.map_err(e)?;
    Ok(Some(ObserveRef {
        run_dir: cwd.to_string_lossy().to_string(),
        tool: dir.tool,
        session_id: latest.as_ref().map(|s| s.id),
        native_id: latest.as_ref().and_then(|s| s.native_session_id.clone()),
        status: latest.as_ref().map(|s| s.status.clone()),
    }))
}

// --- Skills (git-hosted skill sources): source CRUD, sync, parse preview, enable ---

#[tauri::command]
pub async fn list_skill_sources(db: State<'_, Db>) -> R<Vec<entities::skill_source::Model>> {
    repo::list_skill_sources(&db).await.map_err(e)
}

#[tauri::command]
pub async fn add_skill_source(
    db: State<'_, Db>,
    git_url: String,
    git_ref: Option<String>,
) -> R<entities::skill_source::Model> {
    let src = repo::add_skill_source(&db, &git_url, git_ref.as_deref())
        .await
        .map_err(e)?;
    let _ = crate::skills::sync_source(&db, src.id).await;
    repo::get_skill_source(&db, src.id)
        .await
        .map_err(e)?
        .ok_or_else(|| "source vanished".to_string())
}

#[tauri::command]
pub async fn remove_skill_source(db: State<'_, Db>, id: i32) -> R<()> {
    // best-effort cache removal, then DB
    if let Ok(home) = crate::paths::skills_home() {
        let _ = std::fs::remove_dir_all(home.join(id.to_string()));
    }
    repo::remove_skill_source(&db, id).await.map_err(e)
}

#[tauri::command]
pub async fn sync_skill_source(db: State<'_, Db>, id: i32) -> R<entities::skill_source::Model> {
    crate::skills::sync_source(&db, id).await.map_err(e)?;
    repo::get_skill_source(&db, id)
        .await
        .map_err(e)?
        .ok_or_else(|| "source not found".to_string())
}

#[tauri::command]
pub async fn sync_all_skill_sources(db: State<'_, Db>) -> R<Vec<entities::skill_source::Model>> {
    for s in repo::list_skill_sources(&db).await.map_err(e)? {
        let _ = crate::skills::sync_source(&db, s.id).await;
    }
    repo::list_skill_sources(&db).await.map_err(e)
}

#[tauri::command]
pub async fn list_parsed_skills(id: i32) -> R<Vec<crate::skills::parse::ParsedSkill>> {
    let home = crate::paths::skills_home().map_err(e)?;
    Ok(crate::skills::parse::parse_source(
        &home.join(id.to_string()),
    ))
}

#[tauri::command]
pub async fn set_skill_enabled(
    db: State<'_, Db>,
    source_id: i32,
    name: String,
    scope: String,
    on: bool,
) -> R<()> {
    repo::set_skill_enable(&db, source_id, &name, &scope, on)
        .await
        .map_err(e)
}

#[tauri::command]
pub async fn workspace_skills(
    db: State<'_, Db>,
    ws_id: i32,
) -> R<Vec<crate::skills::EnabledSkill>> {
    crate::skills::enabled_for_workspace(&db, ws_id)
        .await
        .map_err(e)
}

/// Answer a pending permission Ask. `answer` is allow | deny | always | full —
/// always remembers this action for the task, full grants it full access.
#[tauri::command]
pub fn answer_permission(
    asks: tauri::State<'_, crate::ask::AskRegistry>,
    ask_id: u64,
    answer: String,
) -> R<()> {
    let a = crate::ask::Answer::parse(&answer).ok_or("unknown answer")?;
    if asks.answer(ask_id, a) {
        Ok(())
    } else {
        Err("that request was already answered or has expired".into())
    }
}

#[tauri::command]
pub fn bus_post_human(
    bus: tauri::State<'_, crate::bus::BusRegistry>,
    thread_id: i32,
    to: Option<String>,
    text: String,
) -> R<()> {
    match to {
        Some(target) if !target.is_empty() && target != "*" => {
            bus.post(thread_id, "you", &target, &text, "message");
        }
        _ => {
            bus.broadcast(thread_id, "you", &text, "message");
        }
    }
    Ok(())
}

// ───────────────────────── IM · 飞书设置（Task 10）─────────────────────────

/// IM 设置视图：secret 只回是否已设置，不回明文（与 ImSettings::Debug 同纪律）。
#[derive(serde::Serialize)]
pub struct ImSettingsView {
    pub app_id: String,
    pub has_secret: bool,
    pub bound: bool,
    pub enabled: bool,
}

#[tauri::command]
pub async fn im_get_settings(db: State<'_, Db>) -> R<ImSettingsView> {
    let s = crate::im::ImSettings::load(&db).await.map_err(e)?;
    Ok(ImSettingsView {
        app_id: s.app_id,
        has_secret: !s.app_secret.is_empty(),
        bound: !s.allow_open_ids.is_empty(),
        enabled: s.enabled,
    })
}

/// 保存凭证并重启桥。secret 传空字符串 = 保持原值（不覆盖已存的密钥）。
/// 是否真正连接由 `im.feishu.enabled` 和双凭证共同决定。
#[tauri::command]
pub async fn im_set_settings(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    app_id: String,
    app_secret: String,
) -> R<()> {
    repo::set_setting(&db, crate::im::K_APP_ID, app_id.trim())
        .await
        .map_err(e)?;
    if !app_secret.is_empty() {
        repo::set_setting(&db, crate::im::K_APP_SECRET, app_secret.trim())
            .await
            .map_err(e)?;
    }
    crate::im::spawn(app);
    Ok(())
}

/// 开关桥：写 enabled 标志并重启。off = 断开但保留凭证；on = 凭证齐全则连接
/// （缺凭证时置 disabled，等用户在已展开的表单里补齐再保存）。
#[tauri::command]
pub async fn im_set_enabled(app: tauri::AppHandle, db: State<'_, Db>, enabled: bool) -> R<()> {
    repo::set_setting(&db, crate::im::K_ENABLED, if enabled { "1" } else { "0" })
        .await
        .map_err(e)?;
    crate::im::spawn(app);
    Ok(())
}

#[tauri::command]
pub fn im_status(bridge: State<'_, crate::im::ImBridge>) -> R<String> {
    Ok(bridge.status())
}

// ───────────────────────── IM · 话题绑定（M2-5）─────────────────────────
//
// 把 issue（lead 的 thread_id）绑到一个飞书话题：之后该话题里的群消息会被
// 路由进 lead engine，lead 的回流文本也会反向贴回这条话题（M2-4）。绑定关系
// 是 1:1（同一 thread 重 bind 覆盖旧目标，同一目标只能映射一个 thread——表上
// 双唯一约束保证）。前端用 chat_id + 话题根 message_id 当 im_thread_ref 调本组。

#[derive(serde::Serialize)]
pub struct ImRouteView {
    pub thread_id: i32,
    pub channel: String,
    pub chat_id: String,
    pub im_thread_ref: String,
    pub created_at: String,
}

fn route_view(m: entities::im_route::Model) -> ImRouteView {
    ImRouteView {
        thread_id: m.thread_id,
        channel: m.channel,
        chat_id: m.chat_id,
        im_thread_ref: m.im_thread_ref,
        created_at: m.created_at,
    }
}

#[tauri::command]
pub async fn im_bind_thread(
    db: State<'_, Db>,
    thread_id: i32,
    channel: String,
    chat_id: String,
    im_thread_ref: String,
) -> R<ImRouteView> {
    let ch = channel.trim();
    let chat = chat_id.trim();
    let r = im_thread_ref.trim();
    if ch.is_empty() || chat.is_empty() || r.is_empty() {
        return Err("channel/chat_id/im_thread_ref must be non-empty".into());
    }
    let m = repo::bind_im_route(&db, thread_id, ch, chat, r)
        .await
        .map_err(e)?;
    Ok(route_view(m))
}

#[tauri::command]
pub async fn im_unbind_thread(db: State<'_, Db>, thread_id: i32) -> R<()> {
    repo::unbind_im_route(&db, thread_id).await.map_err(e)
}

#[tauri::command]
pub async fn im_route_for_thread(db: State<'_, Db>, thread_id: i32) -> R<Option<ImRouteView>> {
    let m = repo::im_route_of_thread(&db, thread_id).await.map_err(e)?;
    Ok(m.map(route_view))
}

#[tauri::command]
pub async fn im_list_routes(db: State<'_, Db>) -> R<Vec<ImRouteView>> {
    let rows = repo::list_im_routes(&db).await.map_err(e)?;
    Ok(rows.into_iter().map(route_view).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Db;
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};

    struct AtlasHomeGuard {
        old: Option<OsString>,
        tmp: PathBuf,
    }

    impl AtlasHomeGuard {
        fn new(name: &str) -> Self {
            let old = std::env::var_os("ATLAS_HOME");
            let tmp = std::env::temp_dir().join(format!(
                "atlas-commands-{name}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::env::set_var("ATLAS_HOME", &tmp);
            Self { old, tmp }
        }

        fn path(&self) -> &Path {
            &self.tmp
        }
    }

    impl Drop for AtlasHomeGuard {
        fn drop(&mut self) {
            if let Some(old) = self.old.take() {
                std::env::set_var("ATLAS_HOME", old);
            } else {
                std::env::remove_var("ATLAS_HOME");
            }
            let _ = std::fs::remove_dir_all(&self.tmp);
        }
    }

    #[tokio::test]
    async fn session_for_direction_returns_run_home_without_session() {
        let _lock = crate::paths::ENV_LOCK.lock().unwrap();
        let home = AtlasHomeGuard::new("run-session-for");
        let db = Db::connect("sqlite::memory:").await.unwrap();
        let ws = repo::create_workspace(&db, "People Ops").await.unwrap();
        let thread = repo::create_thread(&db, ws.id, "Draft Offer", "task", "codex")
            .await
            .unwrap();
        let dir = repo::create_direction(&db, thread.id, "Main Run", "codex", "plan+impl")
            .await
            .unwrap();

        let got = session_for_inner(&db, dir.id).await.unwrap().unwrap();

        let expected = home
            .path()
            .join("workspaces")
            .join("people-ops")
            .join("tasks")
            .join("draft-offer")
            .join("runs")
            .join("main-run");
        assert_eq!(got.run_dir, expected.to_string_lossy().to_string());
        assert_eq!(got.tool, "codex");
        assert_eq!(got.session_id, None);
        assert_eq!(got.native_id, None);
        assert_eq!(got.status, None);
    }
}
