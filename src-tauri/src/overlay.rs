#[cfg(target_os = "windows")]
mod overlay {
    use std::sync::Once;
    use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    static INIT: Once = Once::new();

    pub fn init_overlay(app: &AppHandle) {
        let app = app.clone();
        INIT.call_once(move || {
            if let Some(window) = app.get_webview_window("overlay") {
                let _ = window.set_always_on_top(true);
                let _ = window.show();

                let mut saved = crate::overlay_state::get_overlay();
                if saved.is_none() {
                    if let Some(cfg) = crate::config::OverlayConfig::load() {
                        saved = Some(cfg);
                    }
                }

                let monitor_opt = window.current_monitor().ok().flatten().or_else(|| {
                    app.available_monitors()
                        .ok()
                        .and_then(|v| v.into_iter().next())
                });

                if let Some(monitor) = monitor_opt {
                    if let Some(cfg) = saved {
                        if cfg.manual {
                            let _ = window.set_position(PhysicalPosition::new(cfg.x, cfg.y));
                            let _ = window.set_size(PhysicalSize::new(cfg.width, cfg.height));

                            if let Ok(hwnd) = window.hwnd() {
                                let raw = hwnd.0 as isize;
                                unsafe {
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

                                let window_clone = window.clone();
                                std::thread::spawn(move || loop {
                                    std::thread::sleep(std::time::Duration::from_millis(500));
                                    let _ = window_clone.set_always_on_top(true);
                                    if let Ok(h) = window_clone.hwnd() {
                                        unsafe {
                                            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
                                            let _ = SetWindowPos(
                                                h.0 as _,
                                                HWND_TOPMOST as _,
                                                0,
                                                0,
                                                0,
                                                0,
                                                flags,
                                            );
                                        }
                                    }
                                });
                            }
                            return;
                        }
                    }

                    let mpos = *monitor.position();
                    let msize = *monitor.size();
                    let wa = *monitor.work_area();

                    let width_diff = (msize.width as i64) - (wa.size.width as i64);
                    let height_diff = (msize.height as i64) - (wa.size.height as i64);

                    let mut rect_left = mpos.x as i64;
                    let mut rect_top =
                        (mpos.y as i64 + (msize.height as i64 - wa.size.height as i64)) as i64;
                    let mut rect_width = msize.width as i64;
                    let mut rect_height = (msize.height as i64 - wa.size.height as i64) as i64;

                    if width_diff > 0 && width_diff >= height_diff {
                        if wa.position.x > mpos.x {
                            rect_left = mpos.x as i64;
                            rect_top = mpos.y as i64;
                            rect_width = (wa.position.x as i64 - mpos.x as i64) as i64;
                            rect_height = msize.height as i64;
                        } else {
                            rect_left = (mpos.x as i64 + wa.size.width as i64) as i64;
                            rect_top = mpos.y as i64;
                            rect_width = (msize.width as i64 - wa.size.width as i64) as i64;
                            rect_height = msize.height as i64;
                        }
                    } else if height_diff > 0 {
                        if wa.position.y > mpos.y {
                            rect_left = mpos.x as i64;
                            rect_top = mpos.y as i64;
                            rect_width = msize.width as i64;
                            rect_height = (wa.position.y as i64 - mpos.y as i64) as i64;
                        } else {
                            rect_left = mpos.x as i64;
                            rect_top = (mpos.y as i64 + wa.size.height as i64) as i64;
                            rect_width = msize.width as i64;
                            rect_height = (msize.height as i64 - wa.size.height as i64) as i64;
                        }
                    }

                    if rect_width <= 0 {
                        rect_width = msize.width as i64;
                    }
                    if rect_height <= 0 {
                        rect_height = 24;
                    }

                    const OVERLAY_TOTAL_WIDTH: i64 = 350; // Increased width
                    const OVERLAY_MARGIN: i64 = 8;

                    let (overlay_left, overlay_top, overlay_w, overlay_h) =
                        if rect_width >= rect_height {
                            let overlay_w = OVERLAY_TOTAL_WIDTH.min(rect_width);
                            let overlay_h = rect_height;
                            let mut left = rect_left + rect_width - overlay_w - OVERLAY_MARGIN;
                            if left < rect_left {
                                left = rect_left;
                            }
                            (left, rect_top, overlay_w, overlay_h)
                        } else {
                            let overlay_w = rect_width;
                            let overlay_h = OVERLAY_TOTAL_WIDTH.min(rect_height);
                            let mut top = rect_top + rect_height - overlay_h - OVERLAY_MARGIN;
                            if top < rect_top {
                                top = rect_top;
                            }
                            (rect_left, top, overlay_w, overlay_h)
                        };

                    let _ = window.set_position(PhysicalPosition::new(
                        overlay_left as i32,
                        overlay_top as i32,
                    ));
                    let _ = window.set_size(PhysicalSize::new(overlay_w as u32, overlay_h as u32));

                    if let Ok(hwnd) = window.hwnd() {
                        let raw = hwnd.0 as isize;
                        unsafe {
                            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
                            let _ = SetWindowPos(raw as _, HWND_TOPMOST as _, 0, 0, 0, 0, flags);
                        }

                        // Aggressive Topmost thread
                        let window_clone = window.clone();
                        std::thread::spawn(move || loop {
                            std::thread::sleep(std::time::Duration::from_millis(500));
                            let _ = window_clone.set_always_on_top(true);
                            if let Ok(h) = window_clone.hwnd() {
                                unsafe {
                                    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
                                    let _ = SetWindowPos(
                                        h.0 as _,
                                        HWND_TOPMOST as _,
                                        0,
                                        0,
                                        0,
                                        0,
                                        flags,
                                    );
                                }
                            }
                        });
                    }
                }
            }
        });
    }
}

#[cfg(target_os = "windows")]
pub use overlay::init_overlay;

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
};

#[cfg(target_os = "windows")]
pub fn reposition_overlay(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("overlay") {
        let monitor_opt = window.current_monitor().ok().flatten().or_else(|| {
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

            let mut rect_left = mpos.x as i64;
            let mut rect_top =
                (mpos.y as i64 + (msize.height as i64 - wa.size.height as i64)) as i64;
            let mut rect_width = msize.width as i64;
            let mut rect_height = (msize.height as i64 - wa.size.height as i64) as i64;

            if width_diff > 0 && width_diff >= height_diff {
                if wa.position.x > mpos.x {
                    rect_left = mpos.x as i64;
                    rect_top = mpos.y as i64;
                    rect_width = (wa.position.x as i64 - mpos.x as i64) as i64;
                    rect_height = msize.height as i64;
                } else {
                    rect_left = (mpos.x as i64 + wa.size.width as i64) as i64;
                    rect_top = mpos.y as i64;
                    rect_width = (msize.width as i64 - wa.size.width as i64) as i64;
                    rect_height = msize.height as i64;
                }
            } else if height_diff > 0 {
                if wa.position.y > mpos.y {
                    rect_left = mpos.x as i64;
                    rect_top = mpos.y as i64;
                    rect_width = msize.width as i64;
                    rect_height = (wa.position.y as i64 - mpos.y as i64) as i64;
                } else {
                    rect_left = mpos.x as i64;
                    rect_top = (mpos.y as i64 + wa.size.height as i64) as i64;
                    rect_width = msize.width as i64;
                    rect_height = (msize.height as i64 - wa.size.height as i64) as i64;
                }
            }

            if rect_width <= 0 {
                rect_width = msize.width as i64;
            }
            if rect_height <= 0 {
                rect_height = 24;
            }

            const OVERLAY_TOTAL_WIDTH: i64 = 350; // Increased width
            const OVERLAY_MARGIN: i64 = 8;

            let (overlay_left, overlay_top, overlay_w, overlay_h) = if rect_width >= rect_height {
                let overlay_w = OVERLAY_TOTAL_WIDTH.min(rect_width);
                let overlay_h = rect_height;
                let mut left = rect_left + rect_width - overlay_w - OVERLAY_MARGIN;
                if left < rect_left {
                    left = rect_left;
                }
                (left, rect_top, overlay_w, overlay_h)
            } else {
                let overlay_w = rect_width;
                let overlay_h = OVERLAY_TOTAL_WIDTH.min(rect_height);
                let mut top = rect_top + rect_height - overlay_h - OVERLAY_MARGIN;
                if top < rect_top {
                    top = rect_top;
                }
                (rect_left, top, overlay_w, overlay_h)
            };

            let _ = window.set_position(tauri::PhysicalPosition::new(
                overlay_left as i32,
                overlay_top as i32,
            ));
            let _ = window.set_size(tauri::PhysicalSize::new(overlay_w as u32, overlay_h as u32));

            if let Ok(hwnd) = window.hwnd() {
                let raw = hwnd.0 as isize;
                unsafe {
                    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
                    let _ = SetWindowPos(raw as _, HWND_TOPMOST as _, 0, 0, 0, 0, flags);
                }
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn init_overlay(_app: &tauri::AppHandle) {}
