use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::image::Image as TauriImage;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Emitter;
use tauri::Manager;

pub fn build_system_tray(app: &tauri::AppHandle) -> tauri::Result<tauri::tray::TrayIcon> {
    let toggle = CheckMenuItemBuilder::with_id("toggle-autostart", "Toggle Autostart")
        .checked(false)
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let reset_overlay =
        MenuItemBuilder::with_id("reset-overlay", "Reset Overlay Position").build(app)?;

    let show_hide = MenuItemBuilder::with_id("toggle-window", "Show").build(app)?;

    if let Some(window) = app.get_webview_window("main") {
        if let Ok(visible) = window.is_visible() {
            let _ = show_hide.set_text(if visible { "Hide" } else { "Show" });
        }
    }

    let menu = MenuBuilder::new(app)
        .items(&[&toggle, &show_hide, &reset_overlay, &quit])
        .build()?;

    if let Ok(enabled) = crate::autostart::is_enabled(app) {
        let _ = toggle.set_checked(enabled);
        let _ = app.emit("autostart-changed", enabled);
    }

    let icon_path = PathBuf::from("icons/icon.ico");
    let maybe_icon = if icon_path.exists() {
        TauriImage::from_path(icon_path.clone()).ok()
    } else {
        TauriImage::from_path(PathBuf::from("icons/icon.png")).ok()
    };

    let last_click = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(1)));
    let debounce_ms = Duration::from_millis(200);

    let tray = if let Some(icon) = maybe_icon {
        TrayIconBuilder::with_id("main")
            .icon(icon)
            .show_menu_on_left_click(false)
            .menu(&menu)
            .on_tray_icon_event({
                let show_hide = show_hide.clone();
                let last_click = last_click.clone();
                move |tray, event| match event {
                    TrayIconEvent::Click {
                        rect,
                        position,
                        button,
                        button_state,
                        ..
                    } => {
                        let app = tray.app_handle();
                        let _ = app.emit_to(
                            "overlay",
                            "tray-rect",
                            serde_json::json!({
                                "position": position,
                                "rect": rect,
                            }),
                        );

                        if let Some(overlay) = app.get_webview_window("overlay") {
                            if let Some(cfg) = crate::overlay_state::get_overlay() {
                                if cfg.manual {
                                    return;
                                }
                            }
                            let tray_pos_x = position.x as i64;
                            let tray_pos_y = position.y as i64;

                            const OVERLAY_TOTAL_WIDTH: i64 = 350; // Increased width
                            const OVERLAY_MARGIN: i64 = 8;

                            let monitor_opt =
                                overlay.current_monitor().ok().flatten().or_else(|| {
                                    app.available_monitors()
                                        .ok()
                                        .and_then(|v| v.into_iter().next())
                                });

                            if let Some(monitor) = monitor_opt {
                                let mpos = *monitor.position();
                                let msize = *monitor.size();
                                let wa = *monitor.work_area();

                                let width_diff = (msize.width as i64) - (wa.size.width as i64);
                                let height_diff = (msize.height as i64) - (wa.size.height as i64);

                                let mut _t_left = mpos.x as i64;
                                let mut _t_top = (mpos.y as i64
                                    + (msize.height as i64 - wa.size.height as i64))
                                    as i64;
                                let mut t_width = msize.width as i64;
                                let mut t_height =
                                    (msize.height as i64 - wa.size.height as i64) as i64;

                                if width_diff > 0 && width_diff >= height_diff {
                                    if wa.position.x > mpos.x {
                                        _t_left = mpos.x as i64;
                                        _t_top = mpos.y as i64;
                                        t_width = (wa.position.x as i64 - mpos.x as i64) as i64;
                                        t_height = msize.height as i64;
                                    } else {
                                        _t_left = (mpos.x as i64 + wa.size.width as i64) as i64;
                                        _t_top = mpos.y as i64;
                                        t_width =
                                            (msize.width as i64 - wa.size.width as i64) as i64;
                                        t_height = msize.height as i64;
                                    }
                                } else if height_diff > 0 {
                                    if wa.position.y > mpos.y {
                                        _t_left = mpos.x as i64;
                                        _t_top = mpos.y as i64;
                                        t_width = msize.width as i64;
                                        t_height = (wa.position.y as i64 - mpos.y as i64) as i64;
                                    } else {
                                        _t_left = mpos.x as i64;
                                        _t_top = (mpos.y as i64 + wa.size.height as i64) as i64;
                                        t_width = msize.width as i64;
                                        t_height =
                                            (msize.height as i64 - wa.size.height as i64) as i64;
                                    }
                                }

                                let is_horizontal = t_width >= t_height;

                                if is_horizontal {
                                    let overlay_w = OVERLAY_TOTAL_WIDTH.min(msize.width as i64);
                                    let overlay_h = t_height.max(24);
                                    let mut left = tray_pos_x - overlay_w - OVERLAY_MARGIN;
                                    if left < mpos.x as i64 {
                                        left = mpos.x as i64 + OVERLAY_MARGIN;
                                    }
                                    let top = if wa.position.y > mpos.y {
                                        tray_pos_y + t_height + OVERLAY_MARGIN
                                    } else {
                                        tray_pos_y - overlay_h - OVERLAY_MARGIN
                                    };

                                    let _ = overlay.set_size(tauri::PhysicalSize::new(
                                        overlay_w as u32,
                                        overlay_h as u32,
                                    ));
                                    let _ = overlay.set_position(tauri::PhysicalPosition::new(
                                        left as i32,
                                        top as i32,
                                    ));

                                    if let Ok(hwnd) = overlay.hwnd() {
                                        let raw = hwnd.0 as isize;
                                        unsafe {
                                            use windows_sys::Win32::UI::WindowsAndMessaging::{
                                                SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE,
                                                SWP_NOMOVE, SWP_NOSIZE,
                                            };
                                            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
                                            let _ = SetWindowPos(
                                                raw as _,
                                                HWND_TOPMOST as _,
                                                0,
                                                0,
                                                0,
                                                0,
                                                flags,
                                            );
                                        }
                                    }
                                } else {
                                    let overlay_w = t_width.max(80);
                                    let overlay_h = OVERLAY_TOTAL_WIDTH.min(msize.height as i64);
                                    let left = tray_pos_x;
                                    let mut top = tray_pos_y - overlay_h - OVERLAY_MARGIN;
                                    if top < mpos.y as i64 {
                                        top = mpos.y as i64 + OVERLAY_MARGIN;
                                    }
                                    let _ = overlay.set_size(tauri::PhysicalSize::new(
                                        overlay_w as u32,
                                        overlay_h as u32,
                                    ));
                                    let _ = overlay.set_position(tauri::PhysicalPosition::new(
                                        left as i32,
                                        top as i32,
                                    ));
                                    if let Ok(hwnd) = overlay.hwnd() {
                                        let raw = hwnd.0 as isize;
                                        unsafe {
                                            use windows_sys::Win32::UI::WindowsAndMessaging::{
                                                SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE,
                                                SWP_NOMOVE, SWP_NOSIZE,
                                            };
                                            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
                                            let _ = SetWindowPos(
                                                raw as _,
                                                HWND_TOPMOST as _,
                                                0,
                                                0,
                                                0,
                                                0,
                                                flags,
                                            );
                                        }
                                    }
                                }
                            }
                        }

                        if button_state != MouseButtonState::Up {
                            return;
                        }

                        {
                            let mut last = last_click.lock().unwrap();
                            if last.elapsed() < debounce_ms {
                                return;
                            }
                            *last = Instant::now();
                        }

                        if button == MouseButton::Left {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if let Ok(visible) = window.is_visible() {
                                    if visible {
                                        let _ = window.hide();
                                        let _ = show_hide.set_text("Show");
                                        let _ =
                                            tray.set_tooltip(Some(String::from("peek — hidden")));
                                    } else {
                                        let _ = window.show();
                                        let _ = window.unminimize();
                                        let _ = window.set_focus();
                                        let _ = show_hide.set_text("Hide");
                                        let _ =
                                            tray.set_tooltip(Some(String::from("peek — visible")));
                                    }
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                    let _ = show_hide.set_text("Hide");
                                    let _ = tray.set_tooltip(Some(String::from("peek — visible")));
                                }
                            }
                        }
                    }
                    _ => {}
                }
            })
            .on_menu_event({
                let toggle = toggle.clone();
                let show_hide = show_hide.clone();
                move |app, event| match event.id().as_ref() {
                    "toggle-autostart" => {
                        let app_handle = app.clone();
                        let toggle_clone = toggle.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Ok(enabled) = crate::autostart::is_enabled(&app_handle) {
                                let _ = crate::autostart::set_enabled(&app_handle, !enabled);
                                let _ = toggle_clone.set_checked(!enabled);
                                let _ = app_handle.emit("autostart-changed", !enabled);
                            }
                        });
                    }
                    "toggle-window" => {
                        let app_handle = app.clone();
                        let show_hide_clone = show_hide.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                if let Ok(visible) = window.is_visible() {
                                    if visible {
                                        let _ = window.minimize();
                                        let _ = show_hide_clone.set_text("Show");
                                    } else {
                                        let _ = window.unminimize();
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                        let _ = show_hide_clone.set_text("Hide");
                                    }
                                }
                            }
                        });
                    }
                    "reset-overlay" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = app_handle.emit_to("overlay", "overlay-reset", ());
                            let _ = crate::clear_overlay_state();
                            #[cfg(target_os = "windows")]
                            {
                                crate::overlay::reposition_overlay(&app_handle);
                            }
                        });
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                }
            })
            .build(app)?
    } else {
        TrayIconBuilder::with_id("main")
            .show_menu_on_left_click(false)
            .menu(&menu)
            .on_tray_icon_event({
                let show_hide = show_hide.clone();
                let last_click = last_click.clone();
                move |tray, event| match event {
                    TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } => {
                        if button_state != MouseButtonState::Up {
                            return;
                        }
                        {
                            let mut last = last_click.lock().unwrap();
                            if last.elapsed() < debounce_ms {
                                return;
                            }
                            *last = Instant::now();
                        }
                        if button == MouseButton::Left {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if let Ok(visible) = window.is_visible() {
                                    if visible {
                                        let _ = window.hide();
                                        let _ = show_hide.set_text("Show");
                                        let _ =
                                            tray.set_tooltip(Some(String::from("peek — hidden")));
                                    } else {
                                        let _ = window.show();
                                        let _ = window.unminimize();
                                        let _ = window.set_focus();
                                        let _ = show_hide.set_text("Hide");
                                        let _ =
                                            tray.set_tooltip(Some(String::from("peek — visible")));
                                    }
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                    let _ = show_hide.set_text("Hide");
                                    let _ = tray.set_tooltip(Some(String::from("peek — visible")));
                                }
                            }
                        }
                    }
                    _ => {}
                }
            })
            .on_menu_event({
                let toggle = toggle.clone();
                let show_hide = show_hide.clone();
                move |app, event| match event.id().as_ref() {
                    "toggle-autostart" => {
                        let app_handle = app.clone();
                        let toggle_clone = toggle.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Ok(enabled) = crate::autostart::is_enabled(&app_handle) {
                                let _ = crate::autostart::set_enabled(&app_handle, !enabled);
                                let _ = toggle_clone.set_checked(!enabled);
                                let _ = app_handle.emit("autostart-changed", !enabled);
                            }
                        });
                    }
                    "toggle-window" => {
                        let app_handle = app.clone();
                        let show_hide_clone = show_hide.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                if let Ok(visible) = window.is_visible() {
                                    if visible {
                                        let _ = window.minimize();
                                        let _ = show_hide_clone.set_text("Show");
                                    } else {
                                        let _ = window.unminimize();
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                        let _ = show_hide_clone.set_text("Hide");
                                    }
                                }
                            }
                        });
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    "reset-overlay" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = app_handle.emit_to("overlay", "overlay-reset", ());
                            let _ = crate::clear_overlay_state();
                            #[cfg(target_os = "windows")]
                            {
                                crate::overlay::reposition_overlay(&app_handle);
                            }
                        });
                    }
                    _ => {}
                }
            })
            .build(app)?
    };

    if let Some(window) = app.get_webview_window("main") {
        if let Ok(visible) = window.is_visible() {
            let _ = tray.set_tooltip::<String>(Some(String::from(if visible {
                "peek — visible"
            } else {
                "peek — hidden"
            })));
        } else {
            let _ = tray.set_tooltip::<String>(Some(String::from("peek")));
        }
    } else {
        let _ = tray.set_tooltip::<String>(Some(String::from("peek")));
    }

    Ok(tray)
}
