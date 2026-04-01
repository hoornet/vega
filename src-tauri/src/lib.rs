use keyring::Entry;
use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

mod relay;

// ── OS keychain ─────────────────────────────────────────────────────────────

// Keep legacy keyring service name so existing users don't lose their keys
const KEYRING_SERVICE: &str = "wrystr";

#[tauri::command]
fn store_nsec(pubkey: String, nsec: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, &pubkey).map_err(|e| e.to_string())?;
    entry.set_password(&nsec).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_nsec(pubkey: String) -> Result<Option<String>, String> {
    let entry = Entry::new(KEYRING_SERVICE, &pubkey).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(nsec) => Ok(Some(nsec)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_nsec(pubkey: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, &pubkey).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── SQLite note/profile cache ────────────────────────────────────────────────

struct DbState(Mutex<Connection>);

fn open_db(data_dir: std::path::PathBuf) -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(&data_dir).ok();
    // Try new name first, fall back to legacy name for migration
    let new_path = data_dir.join("vega.db");
    let legacy_path = data_dir.join("wrystr.db");
    if !new_path.exists() && legacy_path.exists() {
        std::fs::rename(&legacy_path, &new_path).ok();
    }
    let path = new_path;
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS notes (
             id         TEXT PRIMARY KEY,
             pubkey     TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             kind       INTEGER NOT NULL,
             raw        TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);
         CREATE TABLE IF NOT EXISTS profiles (
             pubkey    TEXT PRIMARY KEY,
             content   TEXT NOT NULL,
             cached_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS notifications (
             id          TEXT PRIMARY KEY,
             owner_pubkey TEXT NOT NULL,
             pubkey      TEXT NOT NULL,
             created_at  INTEGER NOT NULL,
             kind        INTEGER NOT NULL,
             notif_type  TEXT NOT NULL,
             read        INTEGER NOT NULL DEFAULT 0,
             raw         TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_notif_owner ON notifications(owner_pubkey, created_at DESC);
         CREATE TABLE IF NOT EXISTS followers (
             pubkey       TEXT NOT NULL,
             owner_pubkey TEXT NOT NULL,
             cached_at    INTEGER NOT NULL,
             PRIMARY KEY (pubkey, owner_pubkey)
         );
         CREATE INDEX IF NOT EXISTS idx_followers_owner ON followers(owner_pubkey);
         CREATE TABLE IF NOT EXISTS bookmarked_notes (
             id           TEXT PRIMARY KEY,
             owner_pubkey TEXT NOT NULL,
             raw          TEXT NOT NULL,
             cached_at    INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_bookmarks_owner ON bookmarked_notes(owner_pubkey);",
    )?;
    Ok(conn)
}

#[tauri::command]
fn db_save_notes(state: tauri::State<DbState>, notes: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    for raw in &notes {
        let v: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
        let id = v["id"].as_str().unwrap_or_default();
        let pubkey = v["pubkey"].as_str().unwrap_or_default();
        let created_at = v["created_at"].as_i64().unwrap_or(0);
        let kind = v["kind"].as_i64().unwrap_or(0);
        conn.execute(
            "INSERT OR REPLACE INTO notes (id, pubkey, created_at, kind, raw) VALUES (?1,?2,?3,?4,?5)",
            params![id, pubkey, created_at, kind, raw],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "DELETE FROM notes WHERE kind=1 AND id NOT IN \
         (SELECT id FROM notes WHERE kind=1 ORDER BY created_at DESC LIMIT 500)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_load_feed(state: tauri::State<DbState>, limit: u32) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT raw FROM notes WHERE kind=1 ORDER BY created_at DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
fn db_save_profile(state: tauri::State<DbState>, pubkey: String, content: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT OR REPLACE INTO profiles (pubkey, content, cached_at) VALUES (?1,?2,?3)",
        params![pubkey, content, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_load_profile(state: tauri::State<DbState>, pubkey: String) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT content FROM profiles WHERE pubkey=?1",
        [&pubkey],
        |row| row.get::<_, String>(0),
    ) {
        Ok(content) => Ok(Some(content)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// ── Notification cache ───────────────────────────────────────────────────────

#[tauri::command]
fn db_save_notifications(
    state: tauri::State<DbState>,
    notifications: Vec<String>,
    owner_pubkey: String,
    notif_type: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    for raw in &notifications {
        let v: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
        let id = v["id"].as_str().unwrap_or_default();
        let pubkey = v["pubkey"].as_str().unwrap_or_default();
        let created_at = v["created_at"].as_i64().unwrap_or(0);
        let kind = v["kind"].as_i64().unwrap_or(0);
        conn.execute(
            "INSERT OR IGNORE INTO notifications (id, owner_pubkey, pubkey, created_at, kind, notif_type, raw) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![id, owner_pubkey, pubkey, created_at, kind, notif_type, raw],
        )
        .map_err(|e| e.to_string())?;
    }
    // Prune to newest 500 per owner
    conn.execute(
        "DELETE FROM notifications WHERE owner_pubkey=?1 AND id NOT IN \
         (SELECT id FROM notifications WHERE owner_pubkey=?1 ORDER BY created_at DESC LIMIT 500)",
        params![owner_pubkey],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_load_notifications(
    state: tauri::State<DbState>,
    owner_pubkey: String,
    limit: u32,
) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT raw, read FROM notifications WHERE owner_pubkey=?1 ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![owner_pubkey, limit], |row| {
            let raw: String = row.get(0)?;
            let read: i32 = row.get(1)?;
            Ok(format!("{{\"raw\":{},\"read\":{}}}", raw, read))
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
fn db_mark_notification_read(
    state: tauri::State<DbState>,
    ids: Vec<String>,
) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
    let sql = format!(
        "UPDATE notifications SET read=1 WHERE id IN ({})",
        placeholders.join(",")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
    conn.execute(&sql, params.as_slice()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_newest_notification_ts(
    state: tauri::State<DbState>,
    owner_pubkey: String,
    notif_type: String,
) -> Result<Option<i64>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT MAX(created_at) FROM notifications WHERE owner_pubkey=?1 AND notif_type=?2",
        params![owner_pubkey, notif_type],
        |row| row.get::<_, Option<i64>>(0),
    ) {
        Ok(ts) => Ok(ts),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// ── Followers cache ─────────────────────────────────────────────────────────

#[tauri::command]
fn db_save_followers(
    state: tauri::State<DbState>,
    followers: Vec<String>,
    owner_pubkey: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    for pk in &followers {
        conn.execute(
            "INSERT OR REPLACE INTO followers (pubkey, owner_pubkey, cached_at) VALUES (?1,?2,?3)",
            params![pk, owner_pubkey, now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn db_load_followers(
    state: tauri::State<DbState>,
    owner_pubkey: String,
) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT pubkey FROM followers WHERE owner_pubkey=?1 ORDER BY cached_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&owner_pubkey], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

// ── Bookmarks cache ─────────────────────────────────────────────────────────

#[tauri::command]
fn db_save_bookmarked_notes(
    state: tauri::State<DbState>,
    notes: Vec<String>,
    owner_pubkey: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    for raw in &notes {
        let v: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
        let id = v["id"].as_str().unwrap_or_default();
        conn.execute(
            "INSERT OR REPLACE INTO bookmarked_notes (id, owner_pubkey, raw, cached_at) VALUES (?1,?2,?3,?4)",
            params![id, owner_pubkey, raw, now],
        )
        .map_err(|e| e.to_string())?;
    }
    // Prune to 500 per owner
    conn.execute(
        "DELETE FROM bookmarked_notes WHERE owner_pubkey=?1 AND id NOT IN \
         (SELECT id FROM bookmarked_notes WHERE owner_pubkey=?1 ORDER BY cached_at DESC LIMIT 500)",
        params![owner_pubkey],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_load_bookmarked_notes(
    state: tauri::State<DbState>,
    owner_pubkey: String,
) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT raw FROM bookmarked_notes WHERE owner_pubkey=?1 ORDER BY cached_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&owner_pubkey], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

// ── Articles cache ──────────────────────────────────────────────────────────

#[tauri::command]
fn db_load_articles(state: tauri::State<DbState>, limit: u32) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT raw FROM notes WHERE kind=30023 ORDER BY created_at DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

// ── Embedded relay commands ─────────────────────────────────────────────────

#[tauri::command]
fn relay_get_port(state: tauri::State<relay::RelayHandle>) -> Option<u16> {
    state.port()
}

#[tauri::command]
fn relay_get_stats(state: tauri::State<relay::RelayHandle>) -> Result<serde_json::Value, String> {
    let db_path = state.data_dir().join("relay.db");

    // Get file size
    let db_size_bytes = std::fs::metadata(&db_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Open read-only connection for count query
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;

    let event_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "event_count": event_count,
        "db_size_bytes": db_size_bytes
    }))
}

// ── App entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // ── SQLite ───────────────────────────────────────────────────────
            let data_dir = app.path().app_data_dir()?;
            let conn = open_db(data_dir.clone())
                .unwrap_or_else(|_| Connection::open_in_memory().expect("in-memory SQLite"));
            app.manage(DbState(Mutex::new(conn)));

            // ── Embedded relay ──────────────────────────────────────────────
            match relay::start_relay(data_dir, 4869) {
                Ok(handle) => {
                    app.manage(handle);
                }
                Err(e) => {
                    eprintln!("[relay] Failed to start embedded relay: {}", e);
                }
            }

            // ── WebKit GPU workaround for Linux (webkit2gtk 2.50+ black screen) ──
            #[cfg(target_os = "linux")]
            {
                let main_window = app.get_webview_window("main").unwrap();
                main_window.with_webview(|webview| {
                    use webkit2gtk::{SettingsExt, WebViewExt};
                    let wv = webview.inner();
                    if let Some(settings) = wv.settings() {
                        settings.set_hardware_acceleration_policy(
                            webkit2gtk::HardwareAccelerationPolicy::Never,
                        );
                    }
                }).ok();
            }

            // ── System tray ──────────────────────────────────────────────────
            let show_item = MenuItem::with_id(app, "show", "Open Vega", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let icon = app.default_window_icon().unwrap().clone();
            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false) // left click → show window, right click → menu
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── Close → hide to tray ─────────────────────────────────────────
            // Closing the window hides it instead of exiting. Use "Quit" in the
            // tray menu (or ⌘Q / Alt-F4) to fully exit.
            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store_nsec,
            load_nsec,
            delete_nsec,
            db_save_notes,
            db_load_feed,
            db_save_profile,
            db_load_profile,
            db_save_notifications,
            db_load_notifications,
            db_mark_notification_read,
            db_newest_notification_ts,
            db_save_followers,
            db_load_followers,
            db_save_bookmarked_notes,
            db_load_bookmarked_notes,
            db_load_articles,
            relay_get_port,
            relay_get_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
