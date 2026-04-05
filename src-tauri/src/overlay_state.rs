use std::sync::RwLock;

use crate::config::OverlayConfig;

static OVERLAY_STATE: RwLock<Option<OverlayConfig>> = RwLock::new(None);

pub fn set_overlay(cfg: OverlayConfig) {
    if let Ok(mut guard) = OVERLAY_STATE.write() {
        *guard = Some(cfg);
    }
}

pub fn get_overlay() -> Option<OverlayConfig> {
    if let Ok(guard) = OVERLAY_STATE.read() {
        guard.clone()
    } else {
        None
    }
}
