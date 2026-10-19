import { create } from "zustand";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { fetchMentions, fetchZapsReceived, fetchNewFollowers } from "../lib/nostr";
import { dbSaveNotifications, dbLoadNotifications, dbMarkNotificationRead, dbNewestNotificationTs } from "../lib/db";
import { debug } from "../lib/debug";
import { fetchMark, wentUnanswered, type LoadOutcome } from "../lib/listLoad";

const DM_SEEN_KEY = "wrystr_dm_last_seen";
const LEGACY_READ_KEY = "wrystr_notif_read_ids";
const MAX_NOTIFICATIONS = 200;
/** How far back the open looks for people whose contact list names you. */
const FOLLOWERS_WINDOW_S = 30 * 86400;

/** Which tab a notification belongs to. Zap receipts are kind 9735, followers are kind 3 contact lists that name you, the rest are mentions and replies. */
export type NotificationKind = "mention" | "zap" | "follower";
export function notificationKind(e: Pick<NDKEvent, "kind">): NotificationKind {
  return e.kind === 3 ? "follower" : e.kind === 9735 ? "zap" : "mention";
}

interface NotificationsState {
  notifications: NDKEvent[];
  unreadCount: number;
  readIds: Set<string>;
  loading: boolean;
  /**
   * How the last fetch ended. "unreachable" means nothing came back and no
   * relay answered, so an empty list is not known to be empty.
   */
  fetchOutcome: LoadOutcome;
  currentPubkey: string | null;
  dmLastSeen: Record<string, number>;
  dmUnreadCount: number;
  newFollowersCount: number;
  newFollowerPubkeys: Set<string>;

  loadFromDb: (pubkey: string) => Promise<void>;
  fetchNotifications: (pubkey: string) => Promise<void>;
  markRead: (eventId: string) => void;
  /** The ids that were looked at, as one change. */
  markReadMany: (eventIds: string[]) => void;
  markAllRead: () => void;
  /** Rows found outside the open's sweep (the poller), merged the same way: by id, followers by person, newest first, capped. */
  addNotifications: (events: NDKEvent[], pubkey: string) => void;
  isRead: (eventId: string) => boolean;
  markDMRead: (partnerPubkey: string) => void;
  computeDMUnread: (conversations: Array<{ partnerPubkey: string; lastAt: number }>) => void;
  addNewFollower: (pubkey: string) => void;
  /** Without an argument, everyone; with one, only those people. */
  clearNewFollowers: (pubkeys?: string[]) => void;
}

/** Newest first, followers once per person, capped. */
function settle(events: NDKEvent[]): NDKEvent[] {
  return dedupFollowers(events)
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, MAX_NOTIFICATIONS);
}

function countUnread(events: NDKEvent[], readIds: Set<string>): number {
  return events.filter((e) => e.kind !== 3 && !readIds.has(e.id!)).length;
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

/** Dedup kind 3 (follower) events — keep only the newest per pubkey. */
function dedupFollowers(events: NDKEvent[]): NDKEvent[] {
  const seenFollowers = new Map<string, NDKEvent>();
  const result: NDKEvent[] = [];
  for (const e of events) {
    if (e.kind === 3) {
      const existing = seenFollowers.get(e.pubkey);
      if (!existing || (e.created_at ?? 0) > (existing.created_at ?? 0)) {
        seenFollowers.set(e.pubkey, e);
      }
    } else {
      result.push(e);
    }
  }
  result.push(...seenFollowers.values());
  return result;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  readIds: migrateLegacyReadIds(),
  loading: false,
  fetchOutcome: "pending",
  currentPubkey: null,
  dmLastSeen: loadDMLastSeen(),
  dmUnreadCount: 0,
  newFollowersCount: 0,
  newFollowerPubkeys: new Set<string>(),

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

    // Dedup kind 3 (follower) events by pubkey — keep only newest per person
    const dedupedEvents = dedupFollowers(events);

    const unreadCount = dedupedEvents.filter((e) => e.kind !== 3 && !readIds.has(e.id!)).length;
    debug.log("notif:db loaded", dedupedEvents.length, "notifications,", unreadCount, "unread");
    set({ notifications: dedupedEvents, readIds, unreadCount, loading: false });

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
    const mark = fetchMark();
    try {
      const now = Math.floor(Date.now() / 1000);
      const since = now - 7 * 86400;
      // Where the newest follower this device knows of stands, read before anything is saved: a
      // contact list newer than that, from someone not yet among the followers held, is a new
      // follower, whichever path finds it. With nothing known yet (a first run), nobody is "new".
      const heldFollowers = get().notifications.filter((e) => e.kind === 3);
      const followerMark = heldFollowers.length > 0
        ? Math.max(...heldFollowers.map((e) => e.created_at ?? 0))
        : await dbNewestNotificationTs(pubkey, "follower");
      // Mentions, zaps received and the contact lists that name you, together. Before the tabs only
      // mentions were asked for on open; zaps and followers arrived through the poller alone. Zaps
      // take the same window as mentions: without one, fifty receipts of any age came back unread.
      const notMine = (list: NDKEvent[]) => list.filter((e) => e.pubkey !== pubkey);
      const got = (r: PromiseSettledResult<NDKEvent[]>) => (r.status === "fulfilled" ? notMine(r.value) : []);
      const [m, z, f] = await Promise.allSettled([
        fetchMentions(pubkey, since, MAX_NOTIFICATIONS),
        fetchZapsReceived(pubkey, 50, since),
        fetchNewFollowers(pubkey, now - FOLLOWERS_WINDOW_S, 50),
      ]);
      let mentions = got(m);
      // Relays may need more time for #p tag queries: mentions that came back empty are asked for
      // once more, on their own. Gated on the whole sweep, the retry never ran for anyone with a zap.
      if (mentions.length === 0) {
        await new Promise((r) => setTimeout(r, 3000));
        if (get().currentPubkey !== pubkey) return;
        mentions = got((await Promise.allSettled([fetchMentions(pubkey, since, MAX_NOTIFICATIONS)]))[0]);
        debug.log("notif:fetch mentions retry →", mentions.length);
      }
      // The sweep belongs to the account it was started for.
      if (get().currentPubkey !== pubkey) return;
      const others = [...mentions, ...got(z), ...got(f)];
      // A fetch that threw is a failed load when nothing else came back; with rows from the others it is shown as those rows.
      const failed = [m, z, f].find((r) => r.status === "rejected");
      if (failed && others.length === 0) throw failed.reason;
      debug.log("notif:fetch", others.length, "others");

      // Don't overwrite existing notifications with empty results (relay timeout/disconnect)
      const { readIds, notifications: existing } = get();
      set({ fetchOutcome: others.length === 0 && wentUnanswered(mark) ? "unreachable" : "answered" });
      if (others.length === 0 && existing.length > 0) {
        debug.warn("notif:fetch empty result, keeping", existing.length, "existing");
        return;
      }

      // Merge with existing: by id, and a follower once per person. A contact list is replaced on
      // every edit, so a follower already held must not be saved again under a new id: those rows
      // crowded mentions and zaps out of the DB's newest-500 and the startup load.
      const existingIds = new Set(existing.map((e) => e.id!));
      const existingFollowers = new Set(existing.filter((e) => e.kind === 3).map((e) => e.pubkey));
      const newEvents = dedupFollowers(others.filter((e) => !existingIds.has(e.id!)))
        .filter((e) => e.kind !== 3 || !existingFollowers.has(e.pubkey));

      // Save new events to DB, each under its type (the poller reads the newest per type)
      for (const kind of ["mention", "zap", "follower"] as const) {
        const ofKind = newEvents.filter((e) => notificationKind(e) === kind);
        if (ofKind.length > 0) {
          dbSaveNotifications(ofKind.map((e) => JSON.stringify(e.rawEvent())), pubkey, kind);
          debug.log("notif:db saved", ofKind.length, "new", kind);
        }
      }
      for (const e of newEvents) {
        if (e.kind === 3 && followerMark !== null && (e.created_at ?? 0) > followerMark) get().addNewFollower(e.pubkey);
      }

      const merged = settle([...existing, ...newEvents]);
      const unreadCount = countUnread(merged, readIds);
      debug.log("notif:set", merged.length, "notifications,", unreadCount, "unread");
      set({ notifications: merged, unreadCount });
    } catch {
      // Keep what is already on screen. With nothing on screen, the view says the load failed.
      set({ fetchOutcome: "error" });
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
    const unreadCount = notifications.filter((e) => e.kind !== 3 && !updated.has(e.id!)).length;
    set({ readIds: updated, unreadCount });
  },

  markReadMany: (eventIds: string[]) => {
    const { readIds, notifications } = get();
    const fresh = eventIds.filter((id) => !readIds.has(id));
    if (fresh.length === 0) return;
    const updated = new Set(readIds);
    for (const id of fresh) updated.add(id);
    dbMarkNotificationRead(fresh);
    set({ readIds: updated, unreadCount: countUnread(notifications, updated) });
  },

  addNotifications: (events, pubkey) => {
    const { currentPubkey, notifications, readIds } = get();
    if (currentPubkey !== pubkey) return;
    const held = new Set(notifications.map((e) => e.id!));
    const fresh = events.filter((e) => { if (!e.id || held.has(e.id)) return false; held.add(e.id); return true; });
    if (fresh.length === 0) return;
    const merged = settle([...notifications, ...fresh]);
    set({ notifications: merged, unreadCount: countUnread(merged, readIds) });
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

  addNewFollower: (pubkey: string) => set((s) => ({
    newFollowersCount: s.newFollowersCount + 1,
    newFollowerPubkeys: new Set([...s.newFollowerPubkeys, pubkey]),
  })),
  clearNewFollowers: (pubkeys) => set((s) => {
    if (!pubkeys) return { newFollowersCount: 0, newFollowerPubkeys: new Set<string>() };
    const left = new Set(s.newFollowerPubkeys);
    for (const pk of pubkeys) left.delete(pk);
    return { newFollowersCount: left.size, newFollowerPubkeys: left };
  }),
}));
