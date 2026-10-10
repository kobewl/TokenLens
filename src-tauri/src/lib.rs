mod db;
mod editor_memory;
mod mcp;
mod memory;
mod model;
mod stats;
mod tray;
pub use mcp::run_mcp;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use model::{DayTotal, Overview, SourceReport};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    db_path: PathBuf,
    editor_memories: Arc<Mutex<editor_memory::Index>>,
    refreshing: Arc<AtomicBool>,
    /// Show today's token count next to the menu-bar icon.
    tray_title: Arc<AtomicBool>,
    /// Closing the window hides it instead of quitting; sync continues in the background.
    close_to_tray: Arc<AtomicBool>,
}

struct Reset(Arc<AtomicBool>);
impl Drop for Reset {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
async fn clear_usage(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let path = state.db_path.clone();
    let refreshing = state.refreshing.clone();
    let tray_title = state.tray_title.clone();
    if refreshing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("同步正在进行中，请完成后再清空".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _reset = Reset(refreshing);
        db::clear_usage(&db::open(&path)?)?;
        tray::update(&app, &path, tray_title.load(Ordering::Relaxed));
        Ok(())
    })
    .await
    .map_err(|_| "清空任务失败".to_string())?
}

#[tauri::command]
async fn export_usage(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    range: String,
    app: Option<String>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<Option<String>, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open_reader(&path)?;
        let metadata = stats::export_metadata(
            &conn,
            &range,
            app.as_deref().unwrap_or(""),
            provider.as_deref().unwrap_or(""),
            model.as_deref().unwrap_or(""),
        )?;
        let Some(file) = app_handle
            .dialog()
            .file()
            .add_filter("用量元数据 JSON", &["json"])
            .set_file_name("tokenlens-usage.json")
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let file = file.into_path().map_err(|_| "保存路径无效".to_string())?;
        std::fs::write(&file, metadata).map_err(|_| "无法保存导出文件".to_string())?;
        Ok(Some(file.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "导出任务失败".to_string())?
}

#[tauri::command]
async fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<memory::Project>, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || memory::projects(&db::open_reader(&path)?))
        .await
        .map_err(|_| "项目查询失败".to_string())?
}
#[tauri::command]
async fn add_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<memory::Project>, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title("选择项目目录")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let folder = folder.into_path().map_err(|_| "目录无效".to_string())?;
        Ok(Some(memory::register(&db::open(&path)?, &folder)?))
    })
    .await
    .map_err(|_| "添加项目失败".to_string())?
}
#[tauri::command]
async fn forget_project(state: tauri::State<'_, AppState>, root: String) -> Result<(), String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || memory::forget(&db::open(&path)?, &root))
        .await
        .map_err(|_| "移除项目失败".to_string())?
}
#[tauri::command]
async fn project_memory(
    state: tauri::State<'_, AppState>,
    root: String,
    query: String,
) -> Result<memory::Snapshot, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project = memory::registered(&db::open_reader(&path)?, &root)?;
        memory::snapshot(std::path::Path::new(&project.root), &query)
    })
    .await
    .map_err(|_| "读取记忆失败".to_string())?
}
#[tauri::command]
async fn write_handoff(
    state: tauri::State<'_, AppState>,
    root: String,
    input: memory::HandoffInput,
) -> Result<memory::WriteResult, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project = memory::registered(&db::open_reader(&path)?, &root)?;
        memory::handoff(std::path::Path::new(&root), input, project.guidance)
    })
    .await
    .map_err(|_| "交接写入失败".to_string())?
}
#[tauri::command]
async fn write_decision(
    state: tauri::State<'_, AppState>,
    root: String,
    input: memory::DecisionInput,
) -> Result<memory::WriteResult, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project = memory::registered(&db::open_reader(&path)?, &root)?;
        memory::add_decision(std::path::Path::new(&root), input, project.guidance)
    })
    .await
    .map_err(|_| "决策写入失败".to_string())?
}
#[tauri::command]
async fn rebuild_memory(
    state: tauri::State<'_, AppState>,
    root: String,
    enable_guidance: bool,
) -> Result<(), String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open(&path)?;
        let project = memory::registered(&conn, &root)?;
        memory::rebuild(
            std::path::Path::new(&root),
            project.guidance || enable_guidance,
        )?;
        if enable_guidance {
            conn.execute(
                "UPDATE managed_projects SET guidance=1 WHERE root=?1",
                [&root],
            )
            .map_err(|_| "无法保存接入设置".to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|_| "重建记忆失败".to_string())?
}
#[tauri::command]
async fn memory_config(
    state: tauri::State<'_, AppState>,
    root: String,
    tool: String,
) -> Result<String, String> {
    if tool.trim().is_empty() || tool.chars().count() > 80 {
        return Err("工具名无效".into());
    }
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project = memory::registered(&db::open_reader(&path)?, &root)?;
        let executable =
            std::env::current_exe().map_err(|_| "无法定位 TokenLens 可执行文件".to_string())?;
        memory::mcp_config(&executable, &project.root, &tool, project.guidance)
    })
    .await
    .map_err(|_| "配置生成失败".to_string())?
}
#[tauri::command]
async fn scan_editor_memories(
    state: tauri::State<'_, AppState>,
) -> Result<editor_memory::Catalog, String> {
    let path = state.db_path.clone();
    let index = state.editor_memories.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or("无法定位用户目录")?
            .canonicalize()
            .map_err(|_| "用户目录不可访问")?;
        let roots = memory::projects(&db::open_reader(&path)?)?
            .into_iter()
            .map(|p| p.root)
            .collect::<Vec<_>>();
        Ok(index.lock().map_err(|_| "记忆索引忙")?.scan(&home, &roots))
    })
    .await
    .map_err(|_| "扫描任务失败".to_string())?
}
#[tauri::command]
async fn read_editor_memory(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<editor_memory::Document, String> {
    let index = state.editor_memories.clone();
    tauri::async_runtime::spawn_blocking(move || index.lock().map_err(|_| "记忆索引忙")?.read(&id))
        .await
        .map_err(|_| "读取任务失败".to_string())?
}
#[tauri::command]
async fn aggregate_editor_memories(
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
) -> Result<editor_memory::Aggregation, String> {
    let index = state.editor_memories.clone();
    tauri::async_runtime::spawn_blocking(move || {
        index.lock().map_err(|_| "记忆索引忙")?.aggregate(&ids)
    })
    .await
    .map_err(|_| "汇总任务失败".to_string())?
}
#[tauri::command]
async fn preview_editor_sync(
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
    root: String,
    tool: String,
    content: String,
    allow_agents: bool,
    fingerprints: std::collections::BTreeMap<String, String>,
) -> Result<editor_memory::Preview, String> {
    let index = state.editor_memories.clone();
    tauri::async_runtime::spawn_blocking(move || {
        index.lock().map_err(|_| "记忆索引忙")?.preview(
            &ids,
            &root,
            &tool,
            &content,
            allow_agents,
            &fingerprints,
        )
    })
    .await
    .map_err(|_| "预览任务失败".to_string())?
}
#[tauri::command]
async fn apply_editor_sync(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<editor_memory::SyncResult, String> {
    let index = state.editor_memories.clone();
    let data_dir = app.path().app_data_dir().map_err(|_| "无法定位备份目录")?;
    tauri::async_runtime::spawn_blocking(move || {
        index
            .lock()
            .map_err(|_| "记忆索引忙")?
            .apply(&id, &data_dir)
    })
    .await
    .map_err(|_| "同步任务失败".to_string())?
}
#[tauri::command]
async fn undo_editor_sync(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let index = state.editor_memories.clone();
    tauri::async_runtime::spawn_blocking(move || index.lock().map_err(|_| "记忆索引忙")?.undo(&id))
        .await
        .map_err(|_| "恢复任务失败".to_string())?
}
/// One synchronization pass shared by the window, the menu bar and the
/// background loop. A single `refreshing` flag serializes all of them.
pub(crate) fn run_refresh(app: &tauri::AppHandle) -> Result<Vec<SourceReport>, String> {
    let state = app.state::<AppState>();
    if state
        .refreshing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("同步正在进行中".to_string());
    }
    let _reset = Reset(state.refreshing.clone());
    let reports = stats::refresh(&db::open(&state.db_path)?)?;
    tray::update(app, &state.db_path, state.tray_title.load(Ordering::Relaxed));
    let _ = app.emit("usage-refreshed", ());
    Ok(reports)
}

// Commands must yield before doing filesystem or SQLite work: synchronous
// Tauri commands execute on the window thread.
#[tauri::command]
async fn refresh(app: tauri::AppHandle) -> Result<Vec<SourceReport>, String> {
    tauri::async_runtime::spawn_blocking(move || run_refresh(&app))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn daily_totals(
    state: tauri::State<'_, AppState>,
    days: i64,
    app: Option<String>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<Vec<DayTotal>, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open_reader(&path)?;
        stats::daily_totals(
            &conn,
            days,
            app.as_deref().unwrap_or(""),
            provider.as_deref().unwrap_or(""),
            model.as_deref().unwrap_or(""),
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Menu-bar and window behavior chosen in Settings. The frontend owns the
/// stored preference and pushes it here at startup and on every change.
#[tauri::command]
fn set_tray_prefs(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    show_title: bool,
    close_to_tray: bool,
) {
    state.tray_title.store(show_title, Ordering::Relaxed);
    state.close_to_tray.store(close_to_tray, Ordering::Relaxed);
    tray::update(&app, &state.db_path, show_title);
}

#[tauri::command]
async fn overview(
    state: tauri::State<'_, AppState>,
    range: String,
    app: Option<String>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<Overview, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open_reader(&path)?;
        stats::overview(
            &conn,
            &range,
            app.as_deref().unwrap_or(""),
            provider.as_deref().unwrap_or(""),
            model.as_deref().unwrap_or(""),
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
            }
            db::open(&dir.join("tokenlens.sqlite"))?;
            app.manage(AppState {
                db_path: dir.join("tokenlens.sqlite"),
                editor_memories: Arc::new(Mutex::new(editor_memory::Index::default())),
                refreshing: Arc::new(AtomicBool::new(false)),
                tray_title: Arc::new(AtomicBool::new(true)),
                close_to_tray: Arc::new(AtomicBool::new(false)),
            });
            tray::setup(app.handle())?;
            let state = app.state::<AppState>();
            tray::update(app.handle(), &state.db_path, true);
            // While the window is hidden in the menu bar the webview is not
            // driving auto-refresh, so keep usage fresh from here.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(60));
                let state = handle.state::<AppState>();
                let hidden = handle
                    .get_webview_window("main")
                    .and_then(|window| window.is_visible().ok())
                    .is_some_and(|visible| !visible);
                if hidden && state.close_to_tray.load(Ordering::Relaxed) {
                    let _ = run_refresh(&handle);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if window.label() == "main" && state.close_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            refresh,
            overview,
            daily_totals,
            set_tray_prefs,
            export_usage,
            clear_usage,
            list_projects,
            add_project,
            forget_project,
            project_memory,
            write_handoff,
            write_decision,
            rebuild_memory,
            memory_config,
            scan_editor_memories,
            read_editor_memory,
            aggregate_editor_memories,
            preview_editor_sync,
            apply_editor_sync,
            undo_editor_sync
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app, event| {
        // Clicking the Dock icon should bring a window hidden in the menu bar back.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } = event
        {
            tray::show_main_window(app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
