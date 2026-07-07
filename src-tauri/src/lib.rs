use keyring::Entry;
use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    WebviewUrl, WebviewWindowBuilder,
    Manager, WindowEvent,
};

mod relay;

// ── Data directory migration ────────────────────────────────────────────────

// The app identifier changed from `com.hoornet.vega` to `com.veganostr.Vega` in
// v0.14.0 so it is anchored to a domain we control (Flathub requires this). The
// identifier keys every per-app directory, so without this the SQLite cache, the
// embedded relay database and the webview's localStorage would all be stranded
// and existing users would open a factory-fresh app.
const LEGACY_IDENTIFIER: &str = "com.hoornet.vega";
const APP_IDENTIFIER: &str = "com.veganostr.Vega";

/// Move the contents of `<parent>/com.hoornet.vega` into `<parent>/com.veganostr.Vega`.
///
/// Entry-by-entry rather than a single directory rename, because the destination is
/// *not* reliably absent: Tauri creates `<LocalData>/<identifier>` while building the
/// window, and the webview populates it. A whole-directory rename would fail against
/// that, and treating "destination is non-empty" as "already migrated" would silently
/// strand the user's data (see `run()`).
///
/// An entry that already exists at the destination is never overwritten — real data
/// always wins over the legacy copy — so this is safe to retry on every launch.
fn migrate_dir(new_dir: &std::path::Path) {
    let Some(parent) = new_dir.parent() else {
        return;
    };
    let legacy_dir = parent.join(LEGACY_IDENTIFIER);
    if legacy_dir == new_dir || !legacy_dir.is_dir() {
        return;
    }

    // Fast path: destination not created yet, so move the whole tree in one atomic
    // rename. Same parent means same filesystem, so this can't hit EXDEV, and the
    // data dir can be hundreds of MB — a deep copy would stall startup.
    if !new_dir.exists() && std::fs::rename(&legacy_dir, new_dir).is_ok() {
        eprintln!(
            "[migrate] moved {} -> {}",
            legacy_dir.display(),
            new_dir.display()
        );
        return;
    }

    std::fs::create_dir_all(new_dir).ok();
    let Ok(entries) = std::fs::read_dir(&legacy_dir) else {
        return;
    };

    let (mut moved, mut left) = (0usize, 0usize);
    for entry in entries.flatten() {
        let dest = new_dir.join(entry.file_name());
        if dest.exists() {
            left += 1; // Never clobber: whatever is already there is the live copy.
            continue;
        }
        match std::fs::rename(entry.path(), &dest) {
            Ok(()) => moved += 1,
            Err(e) => {
                left += 1;
                eprintln!("[migrate] could not move {}: {e}", entry.path().display());
            }
        }
    }

    // Fully drained: drop the empty legacy dir so this stops running. If anything was
    // left behind, keep it — a later launch retries, and nothing is ever lost.
    if left == 0 {
        std::fs::remove_dir(&legacy_dir).ok();
    }
    eprintln!(
        "[migrate] {}: moved {moved} entries, left {left}",
        legacy_dir.display()
    );
}

/// Carry a pre-v0.14.0 install's data across the identifier change.
///
/// Must run before `tauri::Builder` — see the call site in `run()`.
///
/// Covers every root the identifier keys, because localStorage does not live in the
/// same place on each platform:
/// - Linux — WebKitGTK stores it under the data dir alongside SQLite.
/// - Windows — WebView2 keeps `EBWebView/` under the *local* data dir (`%LOCALAPPDATA%`),
///   a different root from `%APPDATA%`; migrating only one of them loses it.
/// - macOS — WKWebView stores website data in `~/Library/WebKit/<bundle-id>`, outside
///   the app data dir entirely.
///
/// These roots coincide on some platforms (on Linux data == local data; on Windows and
/// macOS data == config). The duplicate call is a no-op: the first one drains the legacy
/// directory, the second finds nothing to do.
fn migrate_legacy_data_dirs() {
    // `dirs` is what Tauri's own path resolver uses, so these resolve identically to
    // app_data_dir()/app_local_data_dir()/app_config_dir() — but without needing an App.
    for base in [dirs::data_dir(), dirs::data_local_dir(), dirs::config_dir()]
        .into_iter()
        .flatten()
    {
        migrate_dir(&base.join(APP_IDENTIFIER));
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        migrate_dir(&home.join("Library").join("WebKit").join(APP_IDENTIFIER));
    }
}

// ── Network proxy ───────────────────────────────────────────────────────────

const PROXY_SETTINGS_FILE: &str = "proxy.json";

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxySettings {
    enabled: bool,
    url: String,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            url: String::new(),
        }
    }
}

fn proxy_settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(PROXY_SETTINGS_FILE))
        .map_err(|e| e.to_string())
}

fn load_proxy_settings(path: std::path::PathBuf) -> ProxySettings {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return ProxySettings::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn load_proxy_settings_from_disk(app: &tauri::AppHandle) -> ProxySettings {
    let Ok(path) = proxy_settings_path(app) else {
        return ProxySettings::default();
    };
    load_proxy_settings(path)
}

fn validate_proxy_settings(settings: &ProxySettings) -> Result<(), String> {
    if !settings.enabled {
        return Ok(());
    }

    let url = settings.url.trim();
    if url.is_empty() {
        return Err("Proxy URL is required when proxy is enabled".into());
    }

    let parsed = url
        .parse::<tauri::Url>()
        .map_err(|_| "Proxy URL must be a valid http:// or socks5:// URL".to_string())?;
    match parsed.scheme() {
        "http" | "socks5" => {}
        _ => return Err("Proxy URL must start with http:// or socks5://".into()),
    }
    if parsed.host_str().is_none() {
        return Err("Proxy URL must include a host".into());
    }
    if parsed.port_or_known_default().is_none() {
        return Err("Proxy URL must include a port".into());
    }

    Ok(())
}

fn enabled_proxy_url(settings: &ProxySettings) -> Result<Option<tauri::Url>, String> {
    if !settings.enabled {
        return Ok(None);
    }

    validate_proxy_settings(settings)?;
    settings
        .url
        .trim()
        .parse::<tauri::Url>()
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_proxy_settings(app: tauri::AppHandle) -> Result<ProxySettings, String> {
    Ok(load_proxy_settings_from_disk(&app))
}

#[tauri::command]
fn save_proxy_settings(app: tauri::AppHandle, settings: ProxySettings) -> Result<(), String> {
    validate_proxy_settings(&settings)?;
    let path = proxy_settings_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let normalized = ProxySettings {
        enabled: settings.enabled,
        url: settings.url.trim().to_string(),
    };
    let raw = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

fn create_main_window(app: &tauri::App) -> tauri::Result<tauri::WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Vega")
        .inner_size(1200.0, 800.0)
        .min_inner_size(900.0, 600.0);

    match enabled_proxy_url(&load_proxy_settings_from_disk(app.handle())) {
        Ok(Some(url)) => {
            builder = builder.proxy_url(url);
        }
        Ok(None) => {}
        Err(e) => {
            eprintln!("[proxy] Ignoring invalid saved proxy setting: {}", e);
        }
    }

    builder.build()
}

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

// ── Install kind detection ──────────────────────────────────────────────────

/// Reports whether the in-app updater can actually self-install, plus a hint
/// for the UI about how the user should update otherwise.
///
/// The Tauri updater can only replace a running binary it has write access to.
/// A package-manager install (AUR, deb, rpm) puts Vega under root-owned /usr or
/// /opt — the updater can't touch it, and doing so would desync the package DB.
/// In those cases the banner shows manual update guidance instead of a dead
/// "Update & restart" button.
#[tauri::command]
fn install_info() -> serde_json::Value {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        serde_json::json!({ "can_self_update": true, "kind": "updater" })
    }
    #[cfg(target_os = "linux")]
    {
        // AppImage is self-contained and user-writable — updater works.
        if std::env::var("APPIMAGE").is_ok() {
            return serde_json::json!({ "can_self_update": true, "kind": "appimage" });
        }
        let exe = std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        if exe.starts_with("/usr/") || exe.starts_with("/opt/") {
            // Heuristic: pacman present ⇒ almost certainly the AUR package.
            let is_arch = std::path::Path::new("/usr/bin/pacman").exists();
            return serde_json::json!({
                "can_self_update": false,
                "kind": if is_arch { "pacman" } else { "deb-rpm" }
            });
        }
        // Ran from home dir / extracted tarball — let the updater try.
        serde_json::json!({ "can_self_update": true, "kind": "portable" })
    }
}

// ── App entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before tauri::Builder, not inside .setup(). Tauri builds the config-defined
    // windows *before* invoking the setup hook, and building a webview creates (and
    // populates) <LocalData>/<identifier> — which on Linux is the very directory
    // holding vega.db, relay.db and localStorage. Migrating from inside setup() would
    // therefore always find a non-empty destination and skip, stranding user data.
    migrate_legacy_data_dirs();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let main_window = create_main_window(app)?;

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

            // ── WebKit memory tuning for Linux (webkit2gtk) ──────────────────
            #[cfg(target_os = "linux")]
            {
                main_window.with_webview(|webview| {
                    use webkit2gtk::{CacheModel, SettingsExt, WebContextExt, WebViewExt};
                    let wv = webview.inner();
                    if let Some(settings) = wv.settings() {
                        // OnDemand: use GPU if available, CPU fallback otherwise.
                        // HardwareAccelerationPolicy::Never + WEBKIT_DISABLE_COMPOSITING_MODE=1
                        // both kill the Wayland compositor path → blank window on Hyprland.
                        // WEBKIT_FORCE_SOFTWARE_RENDERING=1 (set in main.rs) forces CPU
                        // rasterization without disrupting the Wayland surface.
                        settings.set_hardware_acceleration_policy(
                            webkit2gtk::HardwareAccelerationPolicy::OnDemand,
                        );
                        // Vega is a SPA — no back/forward navigation, page cache is pure waste.
                        settings.set_enable_page_cache(false);
                    }
                    if let Some(ctx) = wv.context() {
                        // DocumentViewer: smallest in-memory content cache footprint.
                        // No back/forward page cache, only the active document cached.
                        ctx.set_cache_model(CacheModel::DocumentViewer);
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
            let window_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_proxy_settings,
            save_proxy_settings,
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
            install_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{enabled_proxy_url, migrate_dir, ProxySettings, APP_IDENTIFIER, LEGACY_IDENTIFIER};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Isolated stand-in for a per-platform data root (e.g. ~/.local/share).
    fn scratch_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let root =
            std::env::temp_dir().join(format!("vega-migrate-test-{}-{}", std::process::id(), n));
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write(path: &Path, body: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    /// A pre-v0.14.0 install: SQLite cache, embedded relay db, and WebKit localStorage,
    /// laid out the way they actually are on disk (relay.db sits directly in the data dir).
    fn seed_legacy(root: &Path) -> PathBuf {
        let legacy = root.join(LEGACY_IDENTIFIER);
        write(&legacy.join("vega.db"), "cached-notes");
        write(&legacy.join("relay.db"), "relay-events");
        write(&legacy.join("localstorage").join("ls.db"), "themes+drafts");
        legacy
    }

    #[test]
    fn moves_legacy_data_into_a_fresh_install() {
        let root = scratch_root();
        let legacy = seed_legacy(&root);
        let new = root.join(APP_IDENTIFIER);

        migrate_dir(&new);

        assert_eq!(read(&new.join("vega.db")), "cached-notes");
        assert_eq!(read(&new.join("relay.db")), "relay-events");
        assert_eq!(
            read(&new.join("localstorage").join("ls.db")),
            "themes+drafts",
            "localStorage carries themes, drafts and podcast subs — it must survive"
        );
        assert!(!legacy.exists(), "drained legacy dir should be removed");
        fs::remove_dir_all(&root).ok();
    }

    /// The regression that shipped-and-was-caught: Tauri creates and populates
    /// <LocalData>/<identifier> while building the window, so on Linux the destination
    /// already exists — and holds webview files — by the time we look at it. Treating
    /// "non-empty destination" as "already migrated" stranded 100% of user data.
    #[test]
    fn migrates_even_when_the_webview_already_created_the_destination() {
        let root = scratch_root();
        let legacy = seed_legacy(&root);
        let new = root.join(APP_IDENTIFIER);
        // What WebKitGTK leaves behind on a first v0.14.0 launch:
        write(&new.join("hsts-storage.sqlite"), "webview");
        write(&new.join("WebKitCache").join("blob"), "webview");

        migrate_dir(&new);

        assert_eq!(
            read(&new.join("vega.db")),
            "cached-notes",
            "user data must migrate despite the destination being non-empty"
        );
        assert_eq!(read(&new.join("relay.db")), "relay-events");
        assert_eq!(read(&new.join("localstorage").join("ls.db")), "themes+drafts");
        assert_eq!(read(&new.join("hsts-storage.sqlite")), "webview");
        assert!(!legacy.exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn never_overwrites_data_already_at_the_destination() {
        let root = scratch_root();
        let legacy = seed_legacy(&root);
        let new = root.join(APP_IDENTIFIER);
        write(&new.join("vega.db"), "live-data");

        migrate_dir(&new);

        assert_eq!(
            read(&new.join("vega.db")),
            "live-data",
            "the live copy always wins over the legacy one"
        );
        // Non-conflicting entries still come across.
        assert_eq!(read(&new.join("relay.db")), "relay-events");
        assert!(
            legacy.join("vega.db").exists(),
            "the un-moved legacy file is kept, never deleted"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn is_safe_to_run_again_after_a_successful_migration() {
        let root = scratch_root();
        seed_legacy(&root);
        let new = root.join(APP_IDENTIFIER);

        migrate_dir(&new);
        migrate_dir(&new); // second launch

        assert_eq!(read(&new.join("vega.db")), "cached-notes");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn does_nothing_for_a_brand_new_user() {
        let root = scratch_root();
        let new = root.join(APP_IDENTIFIER);

        migrate_dir(&new);

        assert!(!new.exists(), "must not fabricate a data dir for a new user");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn accepts_http_and_socks5_proxy_urls() {
        for url in ["http://127.0.0.1:8118", "socks5://127.0.0.1:9050"] {
            let settings = ProxySettings {
                enabled: true,
                url: url.into(),
            };
            assert!(enabled_proxy_url(&settings).unwrap().is_some(), "{url}");
        }
    }

    #[test]
    fn rejects_socks5h_until_webview_support_is_available() {
        let settings = ProxySettings {
            enabled: true,
            url: "socks5h://127.0.0.1:9050".into(),
        };

        assert!(enabled_proxy_url(&settings).is_err());
    }
}
