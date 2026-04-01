use crate::relay::event::Event;
use crate::relay::filter::Filter;
use rusqlite::{params, Connection};
use std::path::Path;

pub fn open_relay_db(data_dir: &Path) -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(data_dir).ok();
    let path = data_dir.join("relay.db");
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;

         CREATE TABLE IF NOT EXISTS events (
             id         TEXT PRIMARY KEY,
             pubkey     TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             kind       INTEGER NOT NULL,
             content    TEXT NOT NULL,
             sig        TEXT NOT NULL,
             raw        TEXT NOT NULL
         );

         CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey);
         CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
         CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

         CREATE TABLE IF NOT EXISTS event_tags (
             event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
             tag_name   TEXT NOT NULL,
             tag_value  TEXT NOT NULL
         );

         CREATE INDEX IF NOT EXISTS idx_tags_name_value ON event_tags(tag_name, tag_value);
         CREATE INDEX IF NOT EXISTS idx_tags_event ON event_tags(event_id);",
    )?;
    Ok(conn)
}

/// Store an event. Returns true if the event was newly inserted, false if it already existed.
/// Handles replaceable (kind 0/3/10000-19999) and parameterized replaceable (30000-39999) events.
pub fn store_event(conn: &Connection, event: &Event, raw: &str) -> rusqlite::Result<bool> {
    // Check if already exists (idempotent)
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE id = ?1)",
        [&event.id],
        |row| row.get(0),
    )?;
    if exists {
        return Ok(false);
    }

    // Handle replaceable events: delete older event with same pubkey+kind
    if event.is_replaceable() {
        conn.execute(
            "DELETE FROM events WHERE pubkey = ?1 AND kind = ?2 AND created_at < ?3",
            params![event.pubkey, event.kind as i64, event.created_at as i64],
        )?;
        // If a newer one already exists, reject this one
        let newer_exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE pubkey = ?1 AND kind = ?2)",
            params![event.pubkey, event.kind as i64],
            |row| row.get(0),
        )?;
        if newer_exists {
            return Ok(false);
        }
    }

    // Handle parameterized replaceable events: same pubkey+kind+d-tag
    if event.is_parameterized_replaceable() {
        let d_tag = event.d_tag().unwrap_or("");
        conn.execute(
            "DELETE FROM events WHERE pubkey = ?1 AND kind = ?2 AND id IN \
             (SELECT e.id FROM events e \
              JOIN event_tags t ON t.event_id = e.id \
              WHERE e.pubkey = ?1 AND e.kind = ?2 AND t.tag_name = 'd' AND t.tag_value = ?3 \
              AND e.created_at < ?4)",
            params![event.pubkey, event.kind as i64, d_tag, event.created_at as i64],
        )?;
        // Check if newer already exists
        let newer_exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM events e \
             JOIN event_tags t ON t.event_id = e.id \
             WHERE e.pubkey = ?1 AND e.kind = ?2 AND t.tag_name = 'd' AND t.tag_value = ?3)",
            params![event.pubkey, event.kind as i64, d_tag],
            |row| row.get(0),
        )?;
        if newer_exists {
            return Ok(false);
        }
    }

    // Insert the event
    conn.execute(
        "INSERT INTO events (id, pubkey, created_at, kind, content, sig, raw) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            event.id,
            event.pubkey,
            event.created_at as i64,
            event.kind as i64,
            event.content,
            event.sig,
            raw,
        ],
    )?;

    // Index single-letter tags
    for tag in &event.tags {
        if let (Some(name), Some(value)) = (tag.first(), tag.get(1)) {
            if name.len() == 1 && name.chars().next().map_or(false, |c| c.is_ascii_alphabetic()) {
                conn.execute(
                    "INSERT INTO event_tags (event_id, tag_name, tag_value) VALUES (?1, ?2, ?3)",
                    params![event.id, name, value],
                )?;
            }
        }
    }

    Ok(true)
}

/// Query events matching any of the given filters. Returns raw JSON strings.
pub fn query_events(conn: &Connection, filters: &[Filter]) -> rusqlite::Result<Vec<String>> {
    let mut all_results: Vec<String> = Vec::new();

    for filter in filters {
        let (where_clause, params, limit) = filter.to_sql();
        let limit_val = limit.unwrap_or(500).min(5000);
        let sql = format!(
            "SELECT e.raw FROM events e WHERE {} ORDER BY e.created_at DESC LIMIT {}",
            where_clause, limit_val
        );

        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|v| v as &dyn rusqlite::types::ToSql).collect();
        let rows = stmt.query_map(param_refs.as_slice(), |row| row.get::<_, String>(0))?;

        for row in rows {
            all_results.push(row?);
        }
    }

    all_results.dedup();
    Ok(all_results)
}

/// Delete an event by ID.
pub fn delete_event(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM events WHERE id = ?1", [id])?;
    Ok(())
}
