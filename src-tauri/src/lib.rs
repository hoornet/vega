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

/// SQLite keeps one database in up to four files: the database itself and, beside it,
/// `-wal` and `-shm` (WAL mode) or `-journal` (rollback mode). They are one unit. A WAL
/// holds committed pages the database file does not have yet, and SQLite applies the WAL
/// it finds beside a database without checking that it belongs to that database.
/// Separated from its WAL, a database loses its newest transactions. Paired with another
/// database's WAL, it reads as the other database's newest pages laid over its own: its
/// tables can vanish without a single error, or its trees point at pages it does not
/// have. In November 2026 a development machine's `vega.db` had tree pages pointing far
/// past the end of the file, after years of renames that moved databases one file at a
/// time.
const SQLITE_COMPANIONS: [&str; 3] = ["-wal", "-shm", "-journal"];

/// The database a file belongs to: `vega.db-wal` belongs to `vega.db`; anything else to
/// itself.
fn sqlite_base(name: &str) -> &str {
    SQLITE_COMPANIONS
        .iter()
        .find_map(|suffix| name.strip_suffix(suffix).filter(|base| !base.is_empty()))
        .unwrap_or(name)
}

/// A database's own path followed by its companions' paths.
fn sqlite_family(db: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut family = vec![db.to_path_buf()];
    for suffix in SQLITE_COMPANIONS {
        let mut name = db.as_os_str().to_owned();
        name.push(suffix);
        family.push(name.into());
    }
    family
}

/// Renames one file or directory: `std::fs::rename`, except in tests that make a
/// rename fail on purpose.
type Rename<'a> = dyn FnMut(&std::path::Path, &std::path::Path) -> std::io::Result<()> + 'a;

fn rename_file(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::rename(from, to)
}

/// Rename a database together with its companions, or not at all. Nothing moves if any
/// name in `to`'s family is taken: a database beside another database's WAL is exactly
/// the damage this prevents; `Ok(false)` says so. If a rename fails, the files already
/// moved are moved back, so the set ends up whole under one name or the other. Only a
/// failure to move one back leaves it split, and the error then says so. A crash between
/// two renames splits it too: renames are not a transaction (see `open_db`).
fn rename_sqlite(
    from: &std::path::Path,
    to: &std::path::Path,
    rename: &mut Rename<'_>,
) -> std::io::Result<bool> {
    if sqlite_family(to).iter().any(|p| p.exists()) {
        return Ok(false);
    }
    let mut moved: Vec<(std::path::PathBuf, std::path::PathBuf)> = Vec::new();
    for (src, dest) in sqlite_family(from).into_iter().zip(sqlite_family(to)) {
        if !src.exists() {
            continue;
        }
        if let Err(e) = rename(&src, &dest) {
            for (home, now_at) in moved.iter().rev() {
                if let Err(back) = rename(now_at, home) {
                    return Err(std::io::Error::new(
                        e.kind(),
                        format!(
                            "could not move {} ({e}), nor move {} back ({back}): the set is split",
                            src.display(),
                            now_at.display()
                        ),
                    ));
                }
            }
            return Err(e);
        }
        moved.push((src, dest));
    }
    Ok(true)
}

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
///
/// A database moves with its `-wal`, `-shm` and `-journal` or stays with them (see
/// `SQLITE_COMPANIONS`). If any of those names is taken at the destination, the whole
/// set stays behind, and so does a set one of whose files cannot be moved (the next
/// launch tries again). Moving one file at a time used to pair a legacy WAL with the
/// destination's own database.
fn migrate_dir(new_dir: &std::path::Path) {
    migrate_dir_with(new_dir, &mut rename_file)
}

fn migrate_dir_with(new_dir: &std::path::Path, rename: &mut Rename<'_>) {
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

    // Group the entries by the database they belong to; anything that is not a database
    // is a group of one.
    let mut groups: std::collections::BTreeMap<std::ffi::OsString, Vec<std::ffi::OsString>> =
        std::collections::BTreeMap::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let base = name
            .to_str()
            .map(|n| std::ffi::OsString::from(sqlite_base(n)))
            .unwrap_or_else(|| name.clone());
        groups.entry(base).or_default().push(name);
    }

    let (mut moved, mut left) = (0usize, 0usize);
    for (base, names) in groups {
        // Never clobber: whatever is already there is the live copy. Nor move a legacy
        // file next to it, where SQLite would take it for that database's:
        // `rename_sqlite` moves nothing when any name of the set is taken.
        match rename_sqlite(&legacy_dir.join(&base), &new_dir.join(&base), rename) {
            Ok(true) => moved += names.len(),
            Ok(false) => left += names.len(),
            Err(e) => {
                left += names.len();
                eprintln!(
                    "[migrate] could not move {}: {e}",
                    legacy_dir.join(&base).display()
                );
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

/// The tables of the cache, `vega.db`. Neither database has ever dropped a table, and
/// the two share no name: see `holds_foreign_tables`.
const CACHE_TABLES: &[&str] = &["bookmarked_notes", "followers", "notes", "notifications", "profiles"];

/// Open a database and read every page of it once. `quick_check` finds what a query
/// would trip over later: tree pages that point past the end of the file, pages used
/// twice, a header that is not SQLite's. It reads the whole file (milliseconds for a
/// cache of a few MB) but does not compare indexes with their tables, which is what
/// makes `integrity_check` slow. Then the database must not hold any of `foreign`, the
/// other database's tables. Either failure comes back as SQLITE_CORRUPT, with what was
/// found as the message.
fn open_checked(path: &std::path::Path, foreign: &[&str]) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    if let Err(e) = check_db(&conn, foreign) {
        // The last connection to close checkpoints the WAL into the database and deletes
        // it. A damaged database is kept for a look, so it must stay exactly as found.
        conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true)
            .ok();
        return Err(e);
    }
    Ok(conn)
}

fn check_db(conn: &Connection, foreign: &[&str]) -> rusqlite::Result<()> {
    let corrupt = |why: String| {
        rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT), Some(why))
    };
    let verdict: String = conn.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
    if verdict != "ok" {
        return Err(corrupt(verdict.replace('\n', "; ")));
    }
    let found = holds_foreign_tables(conn, foreign)?;
    if !found.is_empty() {
        return Err(corrupt(format!("it holds {}, another database's tables", found.join(", "))));
    }
    Ok(())
}

/// Which of `foreign` the database holds. A WAL that reached another database (the
/// renames before November 2026 could move one without its database) is applied with no
/// error, and when it rewrites every page the result is the other database, whole:
/// `quick_check` says ok, this database's tables are gone, and Vega used to create them
/// again beside the other one's. The other database's tables are what is left to see.
fn holds_foreign_tables(conn: &Connection, foreign: &[&str]) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")?;
    let names = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut found = Vec::new();
    for name in names {
        let name = name?;
        if foreign.contains(&name.as_str()) {
            found.push(name);
        }
    }
    Ok(found)
}

/// Whether an error means the file itself is damaged, not that it is busy, locked or
/// unreadable for a reason that will pass. Only damage may move a database aside: a
/// second Vega holding the file, or a permissions problem, must not cost the cache.
fn is_damage(e: &rusqlite::Error) -> bool {
    matches!(
        e.sqlite_error_code(),
        Some(rusqlite::ffi::ErrorCode::DatabaseCorrupt | rusqlite::ffi::ErrorCode::NotADatabase)
    )
}

/// Move a database and its companions out of the way, to `<name>.<why>-<unix time>` in
/// the same directory. The companions keep their suffixes, so the set still opens as
/// one database if anyone wants to look at what went wrong. Nothing is deleted. An error
/// means the set is still where it was, or split if the error says so.
fn set_aside(db: &std::path::Path, why: &str, rename: &mut Rename<'_>) -> Result<(), String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut aside = db.as_os_str().to_owned();
    aside.push(format!(".{why}-{stamp}"));
    let aside = std::path::PathBuf::from(aside);
    match rename_sqlite(db, &aside, rename) {
        Ok(true) => {
            eprintln!("[db] set {} aside as {}", db.display(), aside.display());
            Ok(())
        }
        Ok(false) => Err(format!("could not set {} aside: {} is taken", db.display(), aside.display())),
        Err(e) => Err(format!("could not set {} aside: {e}", db.display())),
    }
}

/// An error that keeps a database off the disk for this session: `run()` keeps the cache
/// in memory, the built-in relay does not start, and the next start tries again.
fn cache_unavailable(why: String) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
        Some(why),
    )
}

fn open_db(data_dir: std::path::PathBuf) -> rusqlite::Result<Connection> {
    open_db_with(data_dir, &mut rename_file)
}

/// A WAL with no database beside it is what a set-aside cut short leaves (Vega killed
/// between two renames, or a rename back that failed). SQLite deletes such a WAL when it
/// creates the database, so it is set aside first, and kept.
fn set_aside_orphans(path: &std::path::Path, rename: &mut Rename<'_>) -> rusqlite::Result<()> {
    if !path.exists() && sqlite_family(path)[1..].iter().any(|p| p.exists()) {
        set_aside(path, "orphaned", rename).map_err(cache_unavailable)?;
    }
    Ok(())
}

/// Open one of Vega's databases, `vega.db` or `relay.db`. Both hold copies of what the
/// relays have: when one is damaged, or holds the other's tables, it is kept for a look
/// and a fresh one starts. Before this, a damaged table failed every query, the commands
/// turned the failure into a string the frontend ignored, and the cache stayed silently
/// off. A database that is busy, locked or cannot be opened is left alone (`is_damage`).
fn open_or_set_aside(
    path: &std::path::Path,
    foreign: &[&str],
    rename: &mut Rename<'_>,
) -> rusqlite::Result<Connection> {
    match open_checked(path, foreign) {
        Ok(conn) => Ok(conn),
        Err(e) if is_damage(&e) => {
            eprintln!("[db] {} is damaged ({e})", path.display());
            // Only once the whole set has moved: SQLite would delete a WAL left beside
            // the new database.
            set_aside(path, "corrupt", rename).map_err(cache_unavailable)?;
            Connection::open(path)
        }
        Err(e) => Err(e),
    }
}

fn open_db_with(
    data_dir: std::path::PathBuf,
    rename: &mut Rename<'_>,
) -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(&data_dir).ok();
    let path = data_dir.join("vega.db");
    set_aside_orphans(&path, rename)?;

    // The name before v0.10.0. Renamed with its WAL: until November 2026 only the
    // database moved, and whatever was still in its WAL was lost.
    let legacy_path = data_dir.join("wrystr.db");
    if !path.exists() && legacy_path.exists() {
        rename_sqlite(&legacy_path, &path, rename).map_err(|e| {
            cache_unavailable(format!("could not rename {}: {e}", legacy_path.display()))
        })?;
    }

    let conn = open_or_set_aside(&path, relay::db::RELAY_TABLES, rename)?;
    create_cache_tables(&conn)?;
    Ok(conn)
}

/// The cache for a session that could not open the one on disk (a damaged cache that
/// could not be set aside): the same tables, in memory, gone at exit. The next start
/// tries the disk again. An in-memory connection with no tables failed every command,
/// which left the cache off for the session.
fn cache_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    create_cache_tables(&conn)?;
    Ok(conn)
}

/// The cache's tables. A new table goes into `CACHE_TABLES` too.
fn create_cache_tables(conn: &Connection) -> rusqlite::Result<()> {
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
    )
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
///
/// A package recipe says who built the package through `VEGA_PACKAGED_BY` at
/// build time (`omarchy`, `aur`, `aur-git`, `flatpak`), and the banner then
/// names the command that brings that package up to date. The Flatpak needs
/// it too: it runs from a read-only `/app`, which the path test below took
/// for a portable build that can replace itself. Without it, a binary under
/// /usr on a machine with pacman can only be told "your package manager":
/// until October 2026 it was told `yay -S vega-nostr-git`, which for the
/// stable AUR package or the Omarchy repository's package replaces it with
/// the development build.
#[tauri::command]
fn install_info() -> serde_json::Value {
    if let Some(packaged_by) = option_env!("VEGA_PACKAGED_BY").filter(|by| !by.is_empty()) {
        return serde_json::json!({
            "can_self_update": false,
            "kind": "package",
            "packaged_by": packaged_by,
        });
    }
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
                .or_else(|e| {
                    eprintln!("[db] the cache is in memory this session: {e}");
                    cache_in_memory()
                })
                .expect("an in-memory SQLite cache");
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
    use super::{
        cache_in_memory, create_cache_tables, enabled_proxy_url, is_damage, migrate_dir,
        migrate_dir_with, open_db, open_db_with, rename_sqlite, sqlite_base, ProxySettings,
        APP_IDENTIFIER, CACHE_TABLES, LEGACY_IDENTIFIER,
    };
    use crate::relay::db::{create_relay_tables, open_relay_db, RELAY_TABLES};
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

    #[test]
    fn updater_http_client_supports_socks5_proxy_urls() {
        assert!(reqwest::Proxy::all("socks5://127.0.0.1:9050").is_ok());
    }

    // The stored setting stays socks5:// (the webview only documents that scheme),
    // but every request that goes out through reqwest is upgraded to socks5h:// by
    // `remoteDnsProxyUrl` in src/lib/proxy.ts so the proxy resolves DNS. Guard that
    // reqwest keeps accepting the scheme we hand it. See issue #11.
    #[test]
    fn updater_http_client_supports_socks5h_proxy_urls() {
        assert!(reqwest::Proxy::all("socks5h://127.0.0.1:9050").is_ok());
    }

    // ── A database, its WAL, and a damaged cache ────────────────────────────

    /// Put `<dir>/<name>` on disk as a crash leaves it: a WAL-mode database whose table
    /// `table` exists only in the WAL. Without its WAL the table is simply not there.
    fn db_with_table_only_in_its_wal(dir: &Path, name: &str, table: &str) {
        let staging = dir.join(format!("staging-{name}"));
        fs::create_dir_all(&staging).unwrap();
        let conn = rusqlite::Connection::open(staging.join(name)).unwrap();
        conn.execute_batch(&format!(
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
             CREATE TABLE {table} (v TEXT); INSERT INTO {table} VALUES ('{table}');"
        ))
        .unwrap();
        // Copied while the connection is open: closing would checkpoint the WAL into the
        // database and delete it.
        for suffix in ["", "-wal", "-shm"] {
            fs::copy(
                staging.join(format!("{name}{suffix}")),
                dir.join(format!("{name}{suffix}")),
            )
            .unwrap();
        }
        drop(conn);
        fs::remove_dir_all(&staging).ok();
    }

    fn tables(db: &Path) -> Vec<String> {
        table_names(&rusqlite::Connection::open(db).unwrap())
    }

    fn table_names(conn: &rusqlite::Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let names = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap();
        names
    }

    fn set_aside_files(dir: &Path, base: &str, why: &str) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(&format!("{base}.{why}-")))
            .collect();
        names.sort();
        names
    }

    #[test]
    fn companion_files_belong_to_their_database() {
        assert_eq!(sqlite_base("vega.db-wal"), "vega.db");
        assert_eq!(sqlite_base("vega.db-shm"), "vega.db");
        assert_eq!(sqlite_base("relay.db-journal"), "relay.db");
        assert_eq!(sqlite_base("vega.db"), "vega.db");
        assert_eq!(sqlite_base("localstorage"), "localstorage");
        assert_eq!(sqlite_base("-wal"), "-wal");
    }

    /// The pairing that one-file-at-a-time migration made possible: the destination
    /// already holds a `vega.db` (a build with the new identifier ran first), the legacy
    /// directory holds another `vega.db` with its WAL. Moving that WAL alone lays the
    /// legacy database's pages over the live one, and its tables are gone.
    #[test]
    fn a_legacy_wal_is_never_paired_with_the_live_database() {
        let root = scratch_root();
        let legacy = root.join(LEGACY_IDENTIFIER);
        let new = root.join(APP_IDENTIFIER);
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&new).unwrap();
        db_with_table_only_in_its_wal(&legacy, "vega.db", "legacy_notes");
        rusqlite::Connection::open(new.join("vega.db"))
            .unwrap()
            .execute_batch("CREATE TABLE live_notes (v TEXT);")
            .unwrap();

        migrate_dir(&new);

        assert!(!new.join("vega.db-wal").exists(), "the legacy WAL must not move beside the live database");
        assert_eq!(tables(&new.join("vega.db")), ["live_notes"]);
        assert!(legacy.join("vega.db").exists() && legacy.join("vega.db-wal").exists(), "the legacy set stays together");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_legacy_database_moves_with_its_wal() {
        let root = scratch_root();
        let legacy = root.join(LEGACY_IDENTIFIER);
        let new = root.join(APP_IDENTIFIER);
        fs::create_dir_all(&legacy).unwrap();
        write(&new.join("WebKitCache").join("blob"), "webview"); // the destination exists
        db_with_table_only_in_its_wal(&legacy, "relay.db", "events");

        migrate_dir(&new);

        assert_eq!(tables(&new.join("relay.db")), ["events"], "rows that were only in the WAL arrive");
        assert!(!legacy.exists(), "drained legacy dir should be removed");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_pre_v0_10_name_is_renamed_with_its_wal() {
        let dir = scratch_root();
        db_with_table_only_in_its_wal(&dir, "wrystr.db", "kept");

        let conn = open_db(dir.clone()).unwrap();
        let v: String = conn
            .query_row("SELECT v FROM kept", [], |row| row.get(0))
            .expect("the table that was only in wrystr.db's WAL");
        assert_eq!(v, "kept");
        assert!(!dir.join("wrystr.db-wal").exists());
        drop(conn);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_healthy_cache_is_kept() {
        let dir = scratch_root();
        open_db(dir.clone())
            .unwrap()
            .execute("INSERT INTO profiles VALUES ('pk', '{}', 1)", [])
            .unwrap();

        let conn = open_db(dir.clone()).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM profiles", [], |row| row.get(0)).unwrap();
        assert_eq!(n, 1);
        assert!(set_aside_files(&dir, "vega.db", "corrupt").is_empty());
        drop(conn);
        fs::remove_dir_all(&dir).ok();
    }

    /// A cache with 2000 notes, closed (checkpointed, no WAL left). Returns the page
    /// number of the notes table's root, an interior page at that size.
    fn cache_with_notes(dir: &Path) -> u64 {
        let mut conn = open_db(dir.to_path_buf()).unwrap();
        let tx = conn.transaction().unwrap();
        let raw = "x".repeat(400);
        for i in 0..2000 {
            tx.execute(
                "INSERT INTO notes VALUES (?1, 'pk', ?2, 1, ?3)",
                rusqlite::params![format!("id{i}"), i, raw],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        let root: i64 = conn
            .query_row("SELECT rootpage FROM sqlite_master WHERE name='notes'", [], |row| row.get(0))
            .unwrap();
        root as u64
    }

    /// Opens on a fresh cache, with exactly one damaged database kept beside it,
    /// unchanged (any -wal and -shm SQLite made while checking it go along with it).
    fn assert_set_aside_and_replaced(dir: &Path, damaged: &[u8]) {
        let conn = open_db(dir.to_path_buf()).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0)).unwrap();
        assert_eq!(n, 0, "a fresh cache");
        let aside = set_aside_files(dir, "vega.db", "corrupt");
        let databases: Vec<&String> =
            aside.iter().filter(|n| sqlite_base(n) == n.as_str()).collect();
        assert_eq!(databases.len(), 1, "{aside:?}");
        assert!(fs::read(dir.join(databases[0])).unwrap() == damaged, "kept as it was");
    }

    /// The shape found on a development machine: a tree page whose child pointer leads
    /// past the end of the file. quick_check answers this with a verdict ("invalid page
    /// number …"), not an error, and every query on the table failed until then: the
    /// commands turned the failure into a string the frontend ignored.
    #[test]
    fn a_tree_pointing_past_the_end_of_the_file_is_set_aside() {
        let dir = scratch_root();
        let root = cache_with_notes(&dir);
        let bytes = point_past_the_end(&dir.join("vega.db"), root);

        assert_set_aside_and_replaced(&dir, &bytes);
        fs::remove_dir_all(&dir).ok();
    }

    /// Point the right-most child of the notes table's root (offset 8 of an interior
    /// page's header) far past the end of the file. Returns the damaged file's bytes.
    fn point_past_the_end(db: &Path, root: u64) -> Vec<u8> {
        let mut bytes = fs::read(db).unwrap();
        let page = ((root - 1) * 4096) as usize;
        assert_eq!(bytes[page], 0x05, "the notes table's root is an interior table page");
        bytes[page + 8..page + 12].copy_from_slice(&0x00ff_ffffu32.to_be_bytes());
        fs::write(db, &bytes).unwrap();
        bytes
    }

    /// Put a damaged `vega.db` in `dir` whose WAL still holds a write, as a crash leaves
    /// it. Returns the bytes of the database and of its WAL.
    fn damaged_cache_with_wal(dir: &Path) -> (Vec<u8>, Vec<u8>) {
        let work = scratch_root();
        let root = cache_with_notes(&work);
        point_past_the_end(&work.join("vega.db"), root);
        let conn = rusqlite::Connection::open(work.join("vega.db")).unwrap();
        conn.execute_batch(
            "PRAGMA wal_autocheckpoint=0; INSERT INTO profiles VALUES ('pk', '{}', 1);",
        )
        .unwrap(); // the profiles tree is intact
        for suffix in ["", "-wal", "-shm"] {
            fs::copy(work.join(format!("vega.db{suffix}")), dir.join(format!("vega.db{suffix}")))
                .unwrap();
        }
        drop(conn);
        fs::remove_dir_all(&work).ok();
        let main = fs::read(dir.join("vega.db")).unwrap();
        let wal = fs::read(dir.join("vega.db-wal")).unwrap();
        assert!(!wal.is_empty());
        (main, wal)
    }

    /// The damaged set was set aside whole, and as found.
    fn assert_kept_as_found(dir: &Path, base: &str, main: &[u8], wal: &[u8]) {
        let aside = set_aside_files(dir, base, "corrupt"); // sorted: the database, -shm, -wal
        assert_eq!(aside.len(), 3, "{aside:?}");
        assert!(fs::read(dir.join(&aside[0])).unwrap() == main, "the database as found");
        assert!(aside[2].ends_with("-wal"));
        assert!(fs::read(dir.join(&aside[2])).unwrap() == wal, "its WAL as found");
    }

    /// Both are set aside as found: closing the checking connection used to checkpoint
    /// the WAL into the damaged file first, and the WAL was gone.
    #[test]
    fn a_damaged_database_is_kept_with_its_wal_as_found() {
        let dir = scratch_root();
        let (main, wal) = damaged_cache_with_wal(&dir);

        drop(open_db(dir.clone()).unwrap());

        assert_kept_as_found(&dir, "vega.db", &main, &wal);
        fs::remove_dir_all(&dir).ok();
    }

    // ── Renames that fail ───────────────────────────────────────────────────

    /// A rename that fails for a path ending in `suffix` and does every other one.
    fn failing_on(suffix: &'static str) -> impl FnMut(&Path, &Path) -> std::io::Result<()> {
        move |from, to| {
            if from.to_string_lossy().ends_with(suffix) {
                Err(std::io::Error::other("injected failure"))
            } else {
                fs::rename(from, to)
            }
        }
    }

    fn snapshot(dir: &Path, names: &[&str]) -> Vec<Option<Vec<u8>>> {
        names.iter().map(|n| fs::read(dir.join(n)).ok()).collect()
    }

    /// Whichever file fails to move, the set ends up whole where it was: whatever moved
    /// before the failure is moved back.
    #[test]
    fn a_set_that_cannot_move_whole_stays_where_it_was() {
        let set = ["x.db", "x.db-wal", "x.db-shm"];
        for failing in set {
            let dir = scratch_root();
            db_with_table_only_in_its_wal(&dir, "x.db", "t");
            let before = snapshot(&dir, &set);

            let result = rename_sqlite(&dir.join("x.db"), &dir.join("y.db"), &mut failing_on(failing));

            assert!(result.is_err(), "{failing}: the failure is reported");
            assert_eq!(snapshot(&dir, &set), before, "{failing}: the set is where it was");
            assert_eq!(
                snapshot(&dir, &["y.db", "y.db-wal", "y.db-shm"]),
                [None, None, None],
                "{failing}: nothing under the new name"
            );
            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn a_set_split_by_a_failed_move_back_says_so() {
        let dir = scratch_root();
        db_with_table_only_in_its_wal(&dir, "x.db", "t");
        let mut failed = false;
        let mut rename = |from: &Path, to: &Path| {
            if failed || from.to_string_lossy().ends_with("-wal") {
                failed = true;
                return Err(std::io::Error::other("injected failure"));
            }
            fs::rename(from, to)
        };

        let err = rename_sqlite(&dir.join("x.db"), &dir.join("y.db"), &mut rename).unwrap_err();

        assert!(err.to_string().contains("the set is split"), "{err}");
        fs::remove_dir_all(&dir).ok();
    }

    /// A damaged cache whose WAL cannot be set aside with it: no fresh cache is made, since
    /// SQLite would delete the WAL left beside it, and the damaged set waits, untouched,
    /// for the next start.
    #[test]
    fn no_fresh_cache_while_the_damaged_one_cannot_be_set_aside() {
        let dir = scratch_root();
        let (main, wal) = damaged_cache_with_wal(&dir);

        assert!(open_db_with(dir.clone(), &mut failing_on("-wal")).is_err());

        assert!(fs::read(dir.join("vega.db")).unwrap() == main, "the database where it was");
        assert!(fs::read(dir.join("vega.db-wal")).unwrap() == wal, "its WAL where it was");
        assert!(set_aside_files(&dir, "vega.db", "corrupt").is_empty());

        drop(open_db(dir.clone()).unwrap()); // the next start
        assert_kept_as_found(&dir, "vega.db", &main, &wal);
        fs::remove_dir_all(&dir).ok();
    }

    /// What a set-aside cut short leaves: a WAL with no database. It is kept, not deleted
    /// by SQLite as the fresh database is made.
    #[test]
    fn a_wal_with_no_database_is_set_aside() {
        let dir = scratch_root();
        db_with_table_only_in_its_wal(&dir, "vega.db", "t");
        fs::remove_file(dir.join("vega.db")).unwrap();
        let wal = fs::read(dir.join("vega.db-wal")).unwrap();

        let conn = open_db(dir.clone()).unwrap();

        let n: i64 = conn.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0)).unwrap();
        assert_eq!(n, 0, "a fresh cache");
        let aside = set_aside_files(&dir, "vega.db", "orphaned");
        let kept = aside.iter().find(|n| n.ends_with("-wal")).expect("the WAL set aside");
        assert!(fs::read(dir.join(kept)).unwrap() == wal, "{aside:?}");
        drop(conn);
        fs::remove_dir_all(&dir).ok();
    }

    /// A legacy set one of whose files cannot be moved stays whole in the legacy directory
    /// (the WAL used to move on without its database), and moves at the next start.
    #[test]
    fn a_legacy_set_that_cannot_move_whole_waits_for_the_next_start() {
        for failing in ["vega.db", "vega.db-wal"] {
            let root = scratch_root();
            let legacy = root.join(LEGACY_IDENTIFIER);
            let new = root.join(APP_IDENTIFIER);
            fs::create_dir_all(&legacy).unwrap();
            write(&new.join("WebKitCache").join("blob"), "webview");
            db_with_table_only_in_its_wal(&legacy, "vega.db", "legacy_notes");

            migrate_dir_with(&new, &mut failing_on(failing));

            for name in ["vega.db", "vega.db-wal", "vega.db-shm"] {
                assert!(legacy.join(name).exists(), "{failing}: {name} stays in the legacy dir");
                assert!(!new.join(name).exists(), "{failing}: {name} not in the new dir");
            }

            migrate_dir(&new);
            assert_eq!(tables(&new.join("vega.db")), ["legacy_notes"], "{failing}");
            assert!(!legacy.exists(), "{failing}: drained at the next start");
            fs::remove_dir_all(&root).ok();
        }
    }

    /// A file cut short: here SQLite reports the damage as an error, not a verdict.
    #[test]
    fn a_truncated_cache_is_set_aside() {
        let dir = scratch_root();
        cache_with_notes(&dir);
        let db = dir.join("vega.db");
        fs::OpenOptions::new().write(true).open(&db).unwrap().set_len(8 * 4096).unwrap();
        let bytes = fs::read(&db).unwrap();

        assert_set_aside_and_replaced(&dir, &bytes);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_that_is_not_a_database_is_set_aside() {
        let dir = scratch_root();
        fs::write(dir.join("vega.db"), vec![b'x'; 8192]).unwrap();

        assert_set_aside_and_replaced(&dir, &[b'x'; 8192]);
        fs::remove_dir_all(&dir).ok();
    }

    /// A busy or locked database, or one that cannot be opened, is not damaged: a second
    /// Vega holding the file must not cost anyone their cache.
    #[test]
    fn only_damage_counts_as_damage() {
        let err = |code| rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(code), None);
        assert!(is_damage(&err(rusqlite::ffi::SQLITE_CORRUPT)));
        assert!(is_damage(&err(rusqlite::ffi::SQLITE_NOTADB)));
        for code in [
            rusqlite::ffi::SQLITE_BUSY,
            rusqlite::ffi::SQLITE_LOCKED,
            rusqlite::ffi::SQLITE_CANTOPEN,
            rusqlite::ffi::SQLITE_PERM,
            rusqlite::ffi::SQLITE_IOERR,
            rusqlite::ffi::SQLITE_READONLY,
        ] {
            assert!(!is_damage(&err(code)), "code {code}");
        }
    }

    // ── The cache in memory, relay.db, and each database's tables ───────────

    /// A session that cannot open the cache on disk gets the same tables in memory. The
    /// commands failed against the in-memory database `run()` used to fall back to,
    /// which had none.
    #[test]
    fn the_cache_in_memory_has_the_cache_tables() {
        let conn = cache_in_memory().unwrap();
        assert_eq!(table_names(&conn), CACHE_TABLES);
        conn.execute("INSERT INTO notes VALUES ('id', 'pk', 1, 1, '{}')", []).unwrap();
    }

    /// The lists the foreign-table check reads are the tables each schema makes, and no
    /// name is in both: a database holding one of the other's tables is not its own.
    #[test]
    fn each_database_knows_its_own_tables() {
        let dir = scratch_root();
        drop(open_db(dir.clone()).unwrap());
        drop(open_relay_db(&dir).unwrap());
        assert_eq!(tables(&dir.join("vega.db")), CACHE_TABLES);
        assert_eq!(tables(&dir.join("relay.db")), RELAY_TABLES);
        assert!(CACHE_TABLES.iter().all(|t| !RELAY_TABLES.contains(t)));
        fs::remove_dir_all(&dir).ok();
    }

    /// The WAL that `create` leaves in a new database called `name`, before the first
    /// checkpoint: it holds every page of the database.
    fn wal_of(name: &str, create: fn(&rusqlite::Connection) -> rusqlite::Result<()>) -> Vec<u8> {
        let work = scratch_root();
        let conn = rusqlite::Connection::open(work.join(name)).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;").unwrap();
        create(&conn).unwrap();
        let wal = fs::read(work.join(format!("{name}-wal"))).unwrap();
        drop(conn);
        fs::remove_dir_all(&work).ok();
        wal
    }

    /// Put `wal` beside the closed database `<dir>/<base>`, as the renames before November
    /// 2026 could. Returns the database's bytes.
    fn beside_a_foreign_wal(dir: &Path, base: &str, wal: &[u8]) -> Vec<u8> {
        assert!(!dir.join(format!("{base}-wal")).exists(), "the database was closed");
        fs::remove_file(dir.join(format!("{base}-shm"))).ok();
        fs::write(dir.join(format!("{base}-wal")), wal).unwrap();
        fs::read(dir.join(base)).unwrap()
    }

    /// `vega.db` beside `relay.db`'s WAL. SQLite applies it without a word, and since it
    /// rewrites every page, quick_check finds nothing wrong: the file is the relay's
    /// database now. Before this, Vega created the cache's tables again beside the relay's
    /// and went on. Now the set is kept as found and a fresh cache starts.
    #[test]
    fn a_cache_holding_the_relays_tables_is_set_aside() {
        let dir = scratch_root();
        drop(open_db(dir.clone()).unwrap());
        let wal = wal_of("relay.db", create_relay_tables);
        let main = beside_a_foreign_wal(&dir, "vega.db", &wal);
        {
            let conn = rusqlite::Connection::open(dir.join("vega.db")).unwrap();
            let verdict: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0)).unwrap();
            assert_eq!(verdict, "ok", "quick_check alone does not see it");
            assert_eq!(table_names(&conn), RELAY_TABLES, "the cache's tables are gone");
            conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true)
                .unwrap(); // leave the WAL where it is
        }

        let conn = open_db(dir.clone()).unwrap();

        assert_eq!(table_names(&conn), CACHE_TABLES, "a fresh cache, with none of the relay's tables");
        assert_kept_as_found(&dir, "vega.db", &main, &wal);
        drop(conn);
        fs::remove_dir_all(&dir).ok();
    }

    /// And the other way round: `relay.db` beside the cache's WAL.
    #[test]
    fn a_relay_db_holding_the_caches_tables_is_set_aside() {
        let dir = scratch_root();
        drop(open_relay_db(&dir).unwrap());
        let wal = wal_of("vega.db", create_cache_tables);
        let main = beside_a_foreign_wal(&dir, "relay.db", &wal);

        let conn = open_relay_db(&dir).unwrap();

        assert_eq!(table_names(&conn), RELAY_TABLES, "a fresh relay.db, with none of the cache's tables");
        assert_kept_as_found(&dir, "relay.db", &main, &wal);
        drop(conn);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_healthy_relay_db_is_kept() {
        let dir = scratch_root();
        open_relay_db(&dir)
            .unwrap()
            .execute("INSERT INTO events VALUES ('id', 'pk', 1, 0, '', 'sig', '{}')", [])
            .unwrap();

        let conn = open_relay_db(&dir).unwrap();

        let n: i64 = conn.query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0)).unwrap();
        assert_eq!(n, 1);
        assert!(set_aside_files(&dir, "relay.db", "corrupt").is_empty());
        drop(conn);
        fs::remove_dir_all(&dir).ok();
    }

    /// relay.db was opened without a check until November 2026: a damaged one failed the
    /// relay's every query, or kept it from starting at all.
    #[test]
    fn a_damaged_relay_db_is_set_aside() {
        let dir = scratch_root();
        fs::write(dir.join("relay.db"), vec![b'x'; 8192]).unwrap();

        let conn = open_relay_db(&dir).unwrap();

        assert_eq!(table_names(&conn), RELAY_TABLES, "a fresh relay.db");
        let aside = set_aside_files(&dir, "relay.db", "corrupt");
        let databases: Vec<&String> = aside.iter().filter(|n| sqlite_base(n) == n.as_str()).collect();
        assert_eq!(databases.len(), 1, "{aside:?}");
        assert!(fs::read(dir.join(databases[0])).unwrap() == vec![b'x'; 8192], "kept as it was");
        drop(conn);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_relay_wal_with_no_database_is_set_aside() {
        let dir = scratch_root();
        db_with_table_only_in_its_wal(&dir, "relay.db", "t");
        fs::remove_file(dir.join("relay.db")).unwrap();
        let wal = fs::read(dir.join("relay.db-wal")).unwrap();

        let conn = open_relay_db(&dir).unwrap();

        assert_eq!(table_names(&conn), RELAY_TABLES, "a fresh relay.db");
        let aside = set_aside_files(&dir, "relay.db", "orphaned");
        let kept = aside.iter().find(|n| n.ends_with("-wal")).expect("the WAL set aside");
        assert!(fs::read(dir.join(kept)).unwrap() == wal, "{aside:?}");
        drop(conn);
        fs::remove_dir_all(&dir).ok();
    }
}
