import { invoke } from "@tauri-apps/api/core";

/** Upsert a batch of raw Nostr event JSON strings into the SQLite note cache. */
export function dbSaveNotes(notes: string[]): void {
  if (notes.length === 0) return;
  invoke("db_save_notes", { notes }).catch(() => {});
}

/** Load up to `limit` recent kind-1 note JSONs from cache (newest first). */
export async function dbLoadFeed(limit = 200): Promise<string[]> {
  return invoke<string[]>("db_load_feed", { limit }).catch(() => []);
}

/** Cache a profile object (NDKUserProfile) for `pubkey`. Fire-and-forget. */
export function dbSaveProfile(pubkey: string, content: string): void {
  invoke("db_save_profile", { pubkey, content }).catch(() => {});
}

/** Load a cached profile JSON for `pubkey`. Returns null if not cached. */
export async function dbLoadProfile(pubkey: string): Promise<string | null> {
  return invoke<string | null>("db_load_profile", { pubkey }).catch(() => null);
}

// ── Notification cache ──────────────────────────────────────────────────────

/** Save notification events to SQLite. Fire-and-forget. */
export function dbSaveNotifications(raws: string[], ownerPubkey: string, notifType: string): void {
  if (raws.length === 0) return;
  invoke("db_save_notifications", { notifications: raws, ownerPubkey, notifType }).catch(() => {});
}

/** Load cached notifications with read state. Newest first. */
export async function dbLoadNotifications(ownerPubkey: string, limit = 200): Promise<{ raw: string; read: boolean }[]> {
  return invoke<string[]>("db_load_notifications", { ownerPubkey, limit })
    .then((rows) => rows.map((r) => {
      const o = JSON.parse(r);
      return { raw: typeof o.raw === "string" ? o.raw : JSON.stringify(o.raw), read: !!o.read };
    }))
    .catch(() => []);
}

/** Mark notification IDs as read in SQLite. Fire-and-forget. */
export function dbMarkNotificationRead(ids: string[]): void {
  if (ids.length === 0) return;
  invoke("db_mark_notification_read", { ids }).catch(() => {});
}

/** Get the newest created_at timestamp for a notification type. */
export async function dbNewestNotificationTs(ownerPubkey: string, notifType: string): Promise<number | null> {
  return invoke<number | null>("db_newest_notification_ts", { ownerPubkey, notifType }).catch(() => null);
}
