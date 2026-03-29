import { create } from "zustand";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { fetchMentions } from "../lib/nostr";
import { dbSaveNotifications, dbLoadNotifications, dbMarkNotificationRead } from "../lib/db";
import { debug } from "../lib/debug";

const DM_SEEN_KEY = "wrystr_dm_last_seen";
const LEGACY_READ_KEY = "wrystr_notif_read_ids";
const MAX_NOTIFICATIONS = 200;

interface NotificationsState {
  notifications: NDKEvent[];
  unreadCount: number;
  readIds: Set<string>;
  loading: boolean;
  currentPubkey: string | null;
  dmLastSeen: Record<string, number>;
  dmUnreadCount: number;
  newFollowersCount: number;

  loadFromDb: (pubkey: string) => Promise<void>;
  fetchNotifications: (pubkey: string) => Promise<void>;
  markRead: (eventId: string) => void;
  markAllRead: () => void;
  isRead: (eventId: string) => boolean;
  markDMRead: (partnerPubkey: string) => void;
  computeDMUnread: (conversations: Array<{ partnerPubkey: string; lastAt: number }>) => void;
  incrementNewFollowers: () => void;
  clearNewFollowers: () => void;
}

function loadDMLastSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(DM_SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Migrate read IDs from localStorage (one-time, first run after upgrade). */
function migrateLegacyReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LEGACY_READ_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      return new Set(arr);
    }
  } catch { /* ignore */ }
  return new Set();
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  readIds: migrateLegacyReadIds(),
  loading: false,
  currentPubkey: null,
  dmLastSeen: loadDMLastSeen(),
  dmUnreadCount: 0,
  newFollowersCount: 0,

  loadFromDb: async (pubkey: string) => {
    const isNewAccount = pubkey !== get().currentPubkey;
    if (isNewAccount) {
      set({ notifications: [], currentPubkey: pubkey });
    }

    const rows = await dbLoadNotifications(pubkey, MAX_NOTIFICATIONS);
    if (rows.length === 0) {
      debug.log("notif:db empty for", pubkey.slice(0, 8));
      return;
    }

    const readIds = new Set(get().readIds);
    const events: NDKEvent[] = [];

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.raw);
        const event = new NDKEvent(undefined, parsed);
        events.push(event);
        if (row.read) readIds.add(event.id!);
      } catch { /* skip malformed */ }
    }

    const unreadCount = events.filter((e) => !readIds.has(e.id!)).length;
    debug.log("notif:db loaded", events.length, "notifications,", unreadCount, "unread");
    set({ notifications: events, readIds, unreadCount, loading: false });

    // Clear legacy localStorage read IDs now that DB is the source of truth
    localStorage.removeItem(LEGACY_READ_KEY);
  },

  fetchNotifications: async (pubkey: string) => {
    const state = get();
    const isNewAccount = pubkey !== state.currentPubkey;
    if (isNewAccount) {
      set({ notifications: [], currentPubkey: pubkey });
    }
    set({ loading: true });
    try {
      const since = Math.floor(Date.now() / 1000) - 7 * 86400;
      const events = await fetchMentions(pubkey, since, MAX_NOTIFICATIONS);
      const others = events.filter((e) => e.pubkey !== pubkey);
      debug.log("notif:fetch", events.length, "raw →", others.length, "others");

      // Don't overwrite existing notifications with empty results (relay timeout/disconnect)
      const { readIds, notifications: existing } = get();
      if (others.length === 0 && existing.length > 0) {
        debug.warn("notif:fetch empty result, keeping", existing.length, "existing");
        return;
      }

      // Merge with existing (dedup by id)
      const existingIds = new Set(existing.map((e) => e.id!));
      const newEvents = others.filter((e) => !existingIds.has(e.id!));

      // Save new events to DB
      if (newEvents.length > 0) {
        const raws = newEvents.map((e) => JSON.stringify(e.rawEvent()));
        dbSaveNotifications(raws, pubkey, "mention");
        debug.log("notif:db saved", newEvents.length, "new mentions");
      }

      // Combine, sort, cap
      const merged = [...existing, ...newEvents]
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
        .slice(0, MAX_NOTIFICATIONS);

      const unreadCount = merged.filter((e) => !readIds.has(e.id!)).length;
      debug.log("notif:set", merged.length, "notifications,", unreadCount, "unread");
      set({ notifications: merged, unreadCount });
    } catch {
      // Non-critical — keep existing notifications on error
    } finally {
      set({ loading: false });
    }
  },

  markRead: (eventId: string) => {
    const { readIds, notifications } = get();
    if (readIds.has(eventId)) return;
    const updated = new Set(readIds);
    updated.add(eventId);
    dbMarkNotificationRead([eventId]);
    const unreadCount = notifications.filter((e) => !updated.has(e.id!)).length;
    set({ readIds: updated, unreadCount });
  },

  markAllRead: () => {
    const { notifications, readIds } = get();
    const updated = new Set(readIds);
    const newIds: string[] = [];
    for (const e of notifications) {
      if (e.id && !readIds.has(e.id)) {
        updated.add(e.id);
        newIds.push(e.id);
      }
    }
    dbMarkNotificationRead(newIds);
    set({ readIds: updated, unreadCount: 0 });
  },

  isRead: (eventId: string) => {
    return get().readIds.has(eventId);
  },

  markDMRead: (partnerPubkey: string) => {
    const now = Math.floor(Date.now() / 1000);
    const dmLastSeen = { ...get().dmLastSeen, [partnerPubkey]: now };
    localStorage.setItem(DM_SEEN_KEY, JSON.stringify(dmLastSeen));
    set({ dmLastSeen });
  },

  computeDMUnread: (conversations: Array<{ partnerPubkey: string; lastAt: number }>) => {
    const { dmLastSeen } = get();
    const unreadConvos = conversations.filter(
      (c) => c.lastAt > (dmLastSeen[c.partnerPubkey] ?? 0)
    );
    const dmUnreadCount = unreadConvos.length;
    set({ dmUnreadCount });
  },

  incrementNewFollowers: () => set((s) => ({ newFollowersCount: s.newFollowersCount + 1 })),
  clearNewFollowers: () => set({ newFollowersCount: 0 }),
}));
