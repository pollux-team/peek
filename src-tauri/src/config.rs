use dirs::config_dir;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct OverlayConfig {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub manual: bool,
}

impl OverlayConfig {
    fn path() -> Option<PathBuf> {
        config_dir().map(|p| p.join("peek").join("overlay.json"))
    }

    pub fn load() -> Option<Self> {
        let p = Self::path()?;
        if !p.exists() {
            return None;
        }
        let mut f = File::open(&p).ok()?;
        let mut s = String::new();
        f.read_to_string(&mut s).ok()?;
        serde_json::from_str(&s).ok()
    }

    pub fn save(&self) -> Result<(), String> {
        let p = Self::path().ok_or_else(|| "could not determine config path".to_string())?;
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {}", e))?;
        }
        let s = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let mut f = File::create(&p).map_err(|e| e.to_string())?;
        f.write_all(s.as_bytes()).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear() -> Result<(), String> {
        if let Some(p) = Self::path() {
            if p.exists() {
                std::fs::remove_file(&p).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}
