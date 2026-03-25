import { create } from "zustand";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { fetchMentions } from "../lib/nostr";

const NOTIF_READ_KEY = "wrystr_notif_read_ids";
const DM_SEEN_KEY = "wrystr_dm_last_seen";
const MAX_NOTIFICATIONS = 15;

interface NotificationsState {
  notifications: NDKEvent[];
  unreadCount: number;
  readIds: Set<string>;
  loading: boolean;
  currentPubkey: string | null;
  dmLastSeen: Record<string, number>;
  dmUnreadCount: number;
  newFollowersCount: number;

  fetchNotifications: (pubkey: string) => Promise<void>;
  markRead: (eventId: string) => void;
  markAllRead: () => void;
  isRead: (eventId: string) => boolean;
  markDMRead: (partnerPubkey: string) => void;
  computeDMUnread: (conversations: Array<{ partnerPubkey: string; lastAt: number }>) => void;
  incrementNewFollowers: () => void;
  clearNewFollowers: () => void;
}

function loadReadIds(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(NOTIF_READ_KEY) ?? "[]");
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  // Only keep the most recent entries to avoid unbounded growth
  const arr = Array.from(ids).slice(-200);
  localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(arr));
}

function loadDMLastSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(DM_SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  readIds: loadReadIds(),
  loading: false,
  currentPubkey: null,
  dmLastSeen: loadDMLastSeen(),
  dmUnreadCount: 0,
  newFollowersCount: 0,

  fetchNotifications: async (pubkey: string) => {
    const state = get();
    const isNewAccount = pubkey !== state.currentPubkey;
    if (isNewAccount) {
      set({ notifications: [], currentPubkey: pubkey });
    }
    set({ loading: true });
    try {
      // Always fetch recent notifications (last 7 days), keep up to MAX_NOTIFICATIONS
      const since = Math.floor(Date.now() / 1000) - 7 * 86400;
      // Fetch more than we need since we filter out own events
      const events = await fetchMentions(pubkey, since, MAX_NOTIFICATIONS * 3);
      // Filter out own events — your replies shouldn't be notifications
      const others = events.filter((e) => e.pubkey !== pubkey);
      const sorted = others.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)).slice(0, MAX_NOTIFICATIONS);
      const { readIds } = get();
      const unreadCount = sorted.filter((e) => !readIds.has(e.id!)).length;
      set({ notifications: sorted, unreadCount });
    } catch {
      // Non-critical
    } finally {
      set({ loading: false });
    }
  },

  markRead: (eventId: string) => {
    const { readIds, notifications } = get();
    if (readIds.has(eventId)) return;
    const updated = new Set(readIds);
    updated.add(eventId);
    saveReadIds(updated);
    const unreadCount = notifications.filter((e) => !updated.has(e.id!)).length;
    set({ readIds: updated, unreadCount });
  },

  markAllRead: () => {
    const { notifications, readIds } = get();
    const updated = new Set(readIds);
    for (const e of notifications) {
      if (e.id) updated.add(e.id);
    }
    saveReadIds(updated);
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
    // dmUnreadCount will be recomputed by computeDMUnread on next DM view render
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
