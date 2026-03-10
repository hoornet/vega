use keyring::Entry;
use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

// ── OS keychain ─────────────────────────────────────────────────────────────

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
    let path = data_dir.join("wrystr.db");
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
         );",
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

// ── App entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // ── SQLite ───────────────────────────────────────────────────────
            let data_dir = app.path().app_data_dir()?;
            let conn = open_db(data_dir)
                .unwrap_or_else(|_| Connection::open_in_memory().expect("in-memory SQLite"));
            app.manage(DbState(Mutex::new(conn)));

            // ── System tray ──────────────────────────────────────────────────
            let show_item = MenuItem::with_id(app, "show", "Open Wrystr", true, None::<&str>)?;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
