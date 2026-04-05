use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::path::PathBuf;
use std::str::FromStr;
use tauri::Manager;

// 1. Get exact path for Tauri SQL Plugin
pub fn get_db_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("Failed to get app config dir");
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("overlay.db") // Must match lib.rs setup
}

// 2. Async Initialize the Sqlx Connection Pool
pub async fn init_db(app: &tauri::AppHandle) -> Result<SqlitePool, sqlx::Error> {
    let path = get_db_path(app);
    let db_url = format!("sqlite:{}", path.to_string_lossy());

    // WAL mode allows concurrent reading (React) and writing (Rust)
    let options = SqliteConnectOptions::from_str(&db_url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    let pool = SqlitePool::connect_with(options).await?;
    Ok(pool)
}

// 3. Write data safely in the background
pub async fn add_usage(pool: &SqlitePool, rx: u64, tx: u64) {
    if rx == 0 && tx == 0 {
        return;
    }

    // Cast to i64 because SQLite doesn't natively support unsigned 64-bit ints
    let _ = sqlx::query(
        "INSERT INTO network_usage (date, rx_bytes, tx_bytes)
         VALUES (date('now', 'localtime'), ?1, ?2)
         ON CONFLICT(date) DO UPDATE SET
         rx_bytes = rx_bytes + ?1,
         tx_bytes = tx_bytes + ?2",
    )
    .bind(rx as i64)
    .bind(tx as i64)
    .execute(pool)
    .await;
}
