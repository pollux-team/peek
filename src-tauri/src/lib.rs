mod autostart;
mod config;
mod db;
mod formatter;
mod monitor;
mod overlay;
mod overlay_state;
mod tray;

use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn save_overlay_position(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    manual: bool,
) -> Result<(), String> {
    crate::config::OverlayConfig {
        x,
        y,
        width,
        height,
        manual,
    }
    .save()
}

#[tauri::command]
fn set_overlay_state(x: i32, y: i32, width: u32, height: u32, manual: bool) {
    crate::overlay_state::set_overlay(crate::config::OverlayConfig {
        x,
        y,
        width,
        height,
        manual,
    });
}

#[tauri::command]
fn clear_overlay_state() {
    crate::overlay_state::set_overlay(crate::config::OverlayConfig::default());
}

#[tauri::command]
fn clear_saved_overlay_position() -> Result<(), String> {
    crate::config::OverlayConfig::clear()
}

#[tauri::command]
fn load_overlay_position() -> Option<crate::config::OverlayConfig> {
    crate::config::OverlayConfig::load()
}

#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> tauri::Result<bool> {
    autostart::is_enabled(&app)
}

#[tauri::command]
fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> tauri::Result<()> {
    autostart::set_enabled(&app, enabled)
}

#[tauri::command]
fn enable_autostart(app: tauri::AppHandle) -> tauri::Result<()> {
    autostart::enable_autostart(&app)
}

#[tauri::command]
fn force_topmost(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("overlay") {
            let _ = window.set_always_on_top(true);
            if let Ok(hwnd) = window.hwnd() {
                let raw = hwnd.0 as isize;
                unsafe {
                    use windows_sys::Win32::UI::WindowsAndMessaging::{
                        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
                    };
                    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
                    let _ = SetWindowPos(raw as _, HWND_TOPMOST as _, 0, 0, 0, 0, flags);
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // FIX: Using the imported `Migration` struct properly
    let migrations = vec![Migration {
        version: 1,
        description: "create_tables",
        sql: "
            CREATE TABLE IF NOT EXISTS overlay (id INTEGER PRIMARY KEY, x INTEGER, y INTEGER, width INTEGER, height INTEGER, manual INTEGER);
            CREATE TABLE IF NOT EXISTS network_usage (date TEXT PRIMARY KEY, rx_bytes INTEGER DEFAULT 0, tx_bytes INTEGER DEFAULT 0);
        ",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:overlay.db", migrations)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle();
            let _tray_icon = tray::build_system_tray(&handle)?;

            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.hide();
            }

            let tray_handle = handle.clone();
            #[cfg(target_os = "windows")]
            {
                crate::overlay::init_overlay(&handle);
            }

            tauri::async_runtime::spawn(async move {
                let db_pool = crate::db::init_db(&tray_handle)
                    .await
                    .expect("Failed to initialize SQLite");

                let mut monitor = crate::monitor::Monitor::new();
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let _ = monitor.poll();

                let mut rx_accum = 0;
                let mut tx_accum = 0;
                let mut ticks = 0;

                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    let stats = monitor.poll();

                    rx_accum += stats.rx_bytes_delta;
                    tx_accum += stats.tx_bytes_delta;
                    ticks += 1;

                    if ticks >= 60 {
                        crate::db::add_usage(&db_pool, rx_accum, tx_accum).await;
                        rx_accum = 0;
                        tx_accum = 0;
                        ticks = 0;
                    }

                    let label = crate::formatter::build_tray_label(&stats);

                    if let Some(tray) = tray_handle.tray_by_id("main") {
                        #[cfg(target_os = "macos")]
                        {
                            let _ = tray.set_title(Some(label.clone()));
                        }
                        #[cfg(not(target_os = "macos"))]
                        {
                            let _ = tray.set_tooltip::<String>(Some(label.clone()));
                        }
                    }

                    let _ = tray_handle.emit_to("overlay", "stats-update", label.clone());
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            save_overlay_position,
            load_overlay_position,
            set_overlay_state,
            clear_overlay_state,
            clear_saved_overlay_position,
            is_autostart_enabled,
            set_autostart_enabled,
            enable_autostart,
            force_topmost
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
