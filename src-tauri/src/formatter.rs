use crate::monitor::Stats;

pub fn fmt_bytes(bytes: u64) -> String {
    match bytes {
        0..=999 => format!("{} B/s", bytes),
        1_000..=999_999 => format!("{:.1} KB/s", bytes as f64 / 1_000.0),
        _ => format!("{:.1} MB/s", bytes as f64 / 1_000_000.0),
    }
}

pub fn fmt_ram_percent(used: u64, total: u64) -> String {
    if total == 0 {
        return "0%".into();
    }
    let pct = (used as f64 / total as f64) * 100.0;
    format!("{:.0}%", pct)
}

pub fn build_tray_label(stats: &Stats) -> String {
    format!(
        "↑{} ↓{} | CPU {:.0}% | GPU {:.0}% | RAM {}",
        fmt_bytes(stats.net_tx),
        fmt_bytes(stats.net_rx),
        stats.cpu,
        stats.gpu,
        fmt_ram_percent(stats.ram_used, stats.ram_total),
    )
}
