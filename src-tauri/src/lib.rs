mod db;
mod model;
mod stats;

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
            clear_usage
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
