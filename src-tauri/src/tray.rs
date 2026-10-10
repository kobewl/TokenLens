//! Menu-bar (system tray) glance: today's tokens, always one click away.
//!
//! Java analogy: this is a read-only "view" over the same service that backs the
//! dashboard. It calls `stats::overview("today")`, the exact aggregation the
//! UI uses, so the menu-bar number can never disagree with the Usage page.

use std::path::Path;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager, Wry};

use crate::{db, stats};

const ICON: &[u8] = include_bytes!("../icons/tray.png");

pub struct Tray {
    icon: TrayIcon<Wry>,
    summary: MenuItem<Wry>,
    detail: MenuItem<Wry>,
}

/// 1.2345亿 / 12.3万 / 9,876: same unit convention as the web UI.
pub fn compact(n: i64) -> String {
    let value = n as f64;
    if n >= 100_000_000 {
        format!("{:.2}亿", value / 1e8)
    } else if n >= 10_000 {
        format!("{:.1}万", value / 1e4)
    } else {
        n.to_string()
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let summary = MenuItem::with_id(app, "summary", "今日 — Tokens", false, None::<&str>)?;
    let detail = MenuItem::with_id(app, "detail", "等待首次同步", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "打开 TokenLens", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "立即同步", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &summary,
            &detail,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &sync,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("退出 TokenLens"))?,
        ],
    )?;
    let icon = TrayIconBuilder::with_id("tokenlens")
        .icon(Image::from_bytes(ICON)?)
        .icon_as_template(true)
        .tooltip("TokenLens")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "sync" => {
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = crate::run_refresh(&app);
                });
            }
            _ => {}
        })
        .build(app)?;
    app.manage(Tray {
        icon,
        summary,
        detail,
    });
    Ok(())
}

/// Refresh the menu text and optional title from the current database.
pub fn update(app: &AppHandle, db_path: &Path, show_title: bool) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    let Ok(conn) = db::open_reader(db_path) else {
        return;
    };
    let Ok(today) = stats::overview(&conn, "today", "", "", "") else {
        return;
    };
    let summary = format!(
        "今日 {} Tokens · {} 次请求",
        compact(today.total_tokens),
        today.event_count
    );
    let detail = match today.by_app.first() {
        Some(top) if today.total_tokens > 0 => format!(
            "最常用：{}（{:.0}%）",
            top.name,
            top.total_tokens as f64 * 100.0 / today.total_tokens as f64
        ),
        _ => "今天还没有用量记录".to_string(),
    };
    let _ = tray.summary.set_text(&summary);
    let _ = tray.detail.set_text(&detail);
    let _ = tray.icon.set_tooltip(Some(&summary));
    let title = show_title.then(|| compact(today.total_tokens));
    let _ = tray.icon.set_title(title.as_deref());
}
