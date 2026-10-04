mod db;
mod model;
mod stats;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use model::{Overview, SourceReport};
use tauri::Manager;

struct AppState {
    db_path: PathBuf,
    refreshing: Arc<AtomicBool>,
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
        struct Reset(Arc<AtomicBool>);
        impl Drop for Reset {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
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
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            db::open(&dir.join("tokenlens.sqlite"))?;
            app.manage(AppState {
                db_path: dir.join("tokenlens.sqlite"),
                refreshing: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![refresh, overview])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
