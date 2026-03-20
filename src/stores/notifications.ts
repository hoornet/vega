import { create } from "zustand";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { fetchMentions } from "../lib/nostr";

const NOTIF_SEEN_KEY = "wrystr_notif_last_seen";
const DM_SEEN_KEY = "wrystr_dm_last_seen";

interface NotificationsState {
  notifications: NDKEvent[];
  unreadCount: number;
  lastSeenAt: number;
  loading: boolean;
  currentPubkey: string | null;
  dmLastSeen: Record<string, number>;
  dmUnreadCount: number;

  fetchNotifications: (pubkey: string) => Promise<void>;
  markAllRead: () => void;
  markDMRead: (partnerPubkey: string) => void;
  computeDMUnread: (conversations: Array<{ partnerPubkey: string; lastAt: number }>) => void;
}

function loadLastSeen(): number {
  const stored = parseInt(localStorage.getItem(NOTIF_SEEN_KEY) ?? "0");
  return stored || Math.floor(Date.now() / 1000) - 86400;
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
  lastSeenAt: loadLastSeen(),
  loading: false,
  currentPubkey: null,
  dmLastSeen: loadDMLastSeen(),
  dmUnreadCount: 0,

  fetchNotifications: async (pubkey: string) => {
    const state = get();
    const isNewAccount = pubkey !== state.currentPubkey;
    if (isNewAccount) {
      set({ notifications: [], currentPubkey: pubkey });
    }
    set({ loading: true });
    try {
      const lastSeenAt = isNewAccount ? loadLastSeen() : get().lastSeenAt;
      const events = await fetchMentions(pubkey, lastSeenAt);
      const newEvents = events.filter((e) => (e.created_at ?? 0) > lastSeenAt);
      const unreadCount = newEvents.length;
      set({ notifications: events, unreadCount, lastSeenAt });
    } catch {
      // Non-critical
    } finally {
      set({ loading: false });
    }
  },

  markAllRead: () => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem(NOTIF_SEEN_KEY, String(now));
    set({ lastSeenAt: now, unreadCount: 0 });
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
}));
