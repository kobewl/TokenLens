mod db;
mod mcp;
mod memory;
mod model;
mod stats;
pub use mcp::run_mcp;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use model::{Overview, SourceReport};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

struct AppState {
    db_path: PathBuf,
    refreshing: Arc<AtomicBool>,
}

struct Reset(Arc<AtomicBool>);
impl Drop for Reset {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
async fn clear_usage(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let path = state.db_path.clone();
    let refreshing = state.refreshing.clone();
    if refreshing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("同步正在进行中，请完成后再清空".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _reset = Reset(refreshing);
        db::clear_usage(&db::open(&path)?)
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
// Commands must yield before doing filesystem or SQLite work: synchronous
// Tauri commands execute on the window thread.
#[tauri::command]
async fn refresh(state: tauri::State<'_, AppState>) -> Result<Vec<SourceReport>, String> {
    let path = state.db_path.clone();
    let refreshing = state.refreshing.clone();
    if refreshing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("同步正在进行中".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _reset = Reset(refreshing);
        let conn = db::open(&path)?;
        stats::refresh(&conn)
    })
    .await
    .map_err(|err| err.to_string())?
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
    tauri::Builder::default()
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
                refreshing: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            refresh,
            overview,
            export_usage,
            clear_usage,
            list_projects,
            add_project,
            forget_project,
            project_memory,
            write_handoff,
            write_decision,
            rebuild_memory,
            memory_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
