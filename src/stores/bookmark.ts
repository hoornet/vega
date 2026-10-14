import { create } from "zustand";
import { fetchReplaceableList, publishReplaceableList, type ListResult } from "../lib/nostr";
import { type LoadOutcome } from "../lib/listLoad";
import { useToastStore } from "./toast";
import { forThisAccount } from "../lib/toastActions";
import { currentAccount, stillAccount } from "../lib/currentAccount";
import { tagValues, withListChanges, recordChange, hasChanges, noChanges, parseStoredChanges, type ListChanges, type ListSnapshot } from "../lib/lists";
import { parseStoredContactList } from "../lib/contacts";
import { debug } from "../lib/debug";

// The bookmark list (kind 10003) is a replaceable event, like the contact
// list, and was open to the same accident: the list as this device held it
// was published whole, over a longer one on the relays when the relays had
// not been read, with `content` (where other clients keep private bookmarks)
// and every tag but `e` and `a` written away each time. Now, per account,
// this device keeps the relays' list as last read (the base) and a record of
// what it bookmarked or removed since (the changes). What is shown is the
// base with the changes applied; what is published is the same, built from
// the newest list the relays hold at that moment, and only once the relays
// have been read. See `lib/lists.ts` and the contact list section of CLAUDE.md.

const BOOKMARK_KIND = 10003;
/** The lists older builds kept for the whole computer; their entries become this account's changes, once. */
const LEGACY_IDS_KEY = "wrystr_bookmarks";
const LEGACY_ADDRS_KEY = "wrystr_bookmarks_articles";
const baseKey = (pubkey: string) => `wrystr_bookmark_list_${pubkey}`;
const changesKey = (pubkey: string) => `wrystr_bookmark_changes_${pubkey}`;

function loadBase(pubkey: string): ListSnapshot | null {
  try { return parseStoredContactList(localStorage.getItem(baseKey(pubkey))); } catch { return null; }
}
function saveBase(pubkey: string, base: ListSnapshot): void {
  try { localStorage.setItem(baseKey(pubkey), JSON.stringify(base)); } catch { /* storage full: read again next time */ }
}
function loadChanges(pubkey: string): ListChanges {
  try { return parseStoredChanges(localStorage.getItem(changesKey(pubkey))); } catch { return {}; }
}
function saveChanges(pubkey: string, changes: ListChanges): void {
  try { localStorage.setItem(changesKey(pubkey), JSON.stringify(changes)); } catch { /* storage full: the change is shown, and lost at restart */ }
}

function legacyList(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** The bookmarks an older build kept, taken as this account's changes the first time it is seen here. */
function adoptLegacyBookmarks(pubkey: string): void {
  if (loadBase(pubkey) || hasChanges(loadChanges(pubkey))) return;
  let changes = noChanges();
  for (const id of legacyList(LEGACY_IDS_KEY)) changes = recordChange(changes, "e", { add: id });
  for (const addr of legacyList(LEGACY_ADDRS_KEY)) changes = recordChange(changes, "a", { add: addr });
  if (hasChanges(changes)) saveChanges(pubkey, changes);
}

/** This account's bookmarks as this device knows them: the relays' list with this device's changes. */
function shown(pubkey: string): { bookmarkedIds: string[]; bookmarkedArticleAddrs: string[] } {
  const tags = withListChanges(loadBase(pubkey)?.tags ?? [], loadChanges(pubkey));
  return { bookmarkedIds: tagValues(tags, "e"), bookmarkedArticleAddrs: tagValues(tags, "a") };
}

const READ_STORAGE_KEY = "wrystr_articles_read";

function loadReadAddrs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(READ_STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveReadAddrs(addrs: string[]) {
  localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(addrs));
}

interface BookmarkState {
  /** What the current account bookmarked, as shown: the relays' list with this device's changes. */
  bookmarkedIds: string[];
  bookmarkedArticleAddrs: string[]; // "30023:<pubkey>:<d-tag>" format
  readArticleAddrs: string[];
  fetchBookmarks: (pubkey: string) => Promise<void>;
  /**
   * How the last read of the bookmark list ended. "unreachable" means no
   * relay answered and nothing was read before, so "nothing saved" is not known.
   */
  listOutcome: LoadOutcome;
  /** The account `listOutcome` and the lists are about. */
  listFor: string | null;
  addBookmark: (eventId: string) => Promise<void>;
  removeBookmark: (eventId: string) => Promise<void>;
  isBookmarked: (eventId: string) => boolean;
  addArticleBookmark: (addr: string) => Promise<void>;
  removeArticleBookmark: (addr: string) => Promise<void>;
  isArticleBookmarked: (addr: string) => boolean;
  markArticleRead: (addr: string) => void;
  markArticleUnread: (addr: string) => void;
  isArticleRead: (addr: string) => boolean;
  unreadArticleCount: () => number;
}

const FAILED = "publish:bookmarks";
const NO_KEY = "Couldn't publish your bookmarks: you are not signed in with a key that can sign.";

// How many changes each account has made in this session. A publish clears
// the record only if none was made while it was on its way.
const revisions = new Map<string, number>();

let setState: (patch: Partial<BookmarkState>) => void = () => {};

function show(pubkey: string): void {
  setState({ ...shown(pubkey), listFor: pubkey });
}

function sayNotPublished(pubkey: string, message: string): void {
  useToastStore.getState().addToast(message, "error", {
    key: FAILED,
    action: forThisAccount("Try again", () => void inTurn(() => reconcile(pubkey, "retry")), pubkey),
  });
}

// One round at a time, as for the podcast list.
let turns: Promise<void> = Promise.resolve();
function inTurn(round: () => Promise<void>): Promise<void> {
  const quietly = () => round().catch((err) => { debug.warn("[Vega] Bookmarks could not be brought in line:", err); });
  turns = turns.then(quietly, quietly);
  return turns;
}

/** The base after a read; see the mute store's `settleBase`. */
function settleBase(pubkey: string, read: ListResult): ListSnapshot | null {
  const base = loadBase(pubkey);
  if (read.status === "found" && (!base || read.list.createdAt >= base.createdAt)) { saveBase(pubkey, read.list); return read.list; }
  if (read.status === "none" && !base) { const first = { tags: [], content: "", createdAt: 0 }; saveBase(pubkey, first); return first; }
  return base;
}

/**
 * Bring this account's bookmarks and the relays' together: the one way the
 * list is read, and the one way a change made here goes out. At the start,
 * a moment after a change, and from "Try again".
 */
async function reconcile(pubkey: string, why: "start" | "change" | "retry"): Promise<void> {
  if (!stillAccount(pubkey)) return;
  if (why !== "start" && !hasChanges(loadChanges(pubkey))) return;

  let read: ListResult;
  try {
    read = await fetchReplaceableList(BOOKMARK_KIND, pubkey);
  } catch (err) {
    debug.warn("[Vega] Failed to read the bookmark list:", err);
    if (!stillAccount(pubkey)) return;
    // The read itself failed: what this device knows stays on screen, and a
    // change made here stays on record for the next start.
    show(pubkey);
    setState({ listOutcome: "error" });
    if (why !== "start") sayNotPublished(pubkey, "Couldn't publish your bookmarks: the list on your relays could not be read. The change is kept on this device, and Vega will try again when it next starts.");
    return;
  }
  if (!stillAccount(pubkey)) return;

  const known = settleBase(pubkey, read);
  show(pubkey);
  if (!known) {
    // Could not tell what the relays hold, and nothing was read before.
    if (read.status === "unknown") setState({ listOutcome: "unreachable" });
    if (why !== "start") sayNotPublished(pubkey, "Couldn't publish your bookmarks: the list on your relays could not be read. The change is kept on this device, and Vega will try again when it next starts.");
    return;
  }
  setState({ listOutcome: "answered" });
  const base = known;

  const changes = loadChanges(pubkey);
  if (!hasChanges(changes)) return;
  const removes = Object.values(changes).some((c) => c.remove.length > 0);
  const revision = revisions.get(pubkey) ?? 0;
  const tags = withListChanges(base.tags, changes);
  try {
    const published = await publishReplaceableList(BOOKMARK_KIND, tags, base.content);
    if (!stillAccount(pubkey)) return;
    const toasts = useToastStore.getState();
    if (!published) {
      if (why === "retry") toasts.addToast(NO_KEY, "error", { key: FAILED });
      return;
    }
    if ((revisions.get(pubkey) ?? 0) === revision) saveChanges(pubkey, noChanges());
    saveBase(pubkey, { tags, content: base.content, createdAt: Math.floor(Date.now() / 1000) });
    show(pubkey);
    toasts.removeByKey(FAILED);
    if (why === "retry") toasts.addToast("Bookmarks published.", "success");
  } catch {
    if (!stillAccount(pubkey)) return;
    sayNotPublished(pubkey, removes
      ? "Couldn't publish your bookmarks. The removal is on this device only until it goes out; Vega will try again when it next starts."
      : "Couldn't publish your bookmarks. The new one is saved on this device only until it goes out; Vega will try again when it next starts.");
  }
}

// One publish for changes made in quick succession.
let publishTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePublish(pubkey: string): void {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void inTurn(() => reconcile(pubkey, "change"));
  }, 1000);
}

function change(tag: "e" | "a", c: { add: string } | { remove: string }): void {
  const pubkey = currentAccount() ?? "";
  saveChanges(pubkey, recordChange(loadChanges(pubkey), tag, c));
  revisions.set(pubkey, (revisions.get(pubkey) ?? 0) + 1);
  show(pubkey);
  // Nobody signed in: kept here, and nothing to publish it with.
  if (pubkey) schedulePublish(pubkey);
}

export const useBookmarkStore = create<BookmarkState>((set, get) => {
  setState = set;
  return {
    ...shown(currentAccount() ?? ""),
    readArticleAddrs: loadReadAddrs(),
    listOutcome: "pending",
    listFor: null,

    fetchBookmarks: async (pubkey: string) => {
      adoptLegacyBookmarks(pubkey);
      // Not known until asked: for another account, or again after a load that
      // got no answer. An answer already given for this account stands while
      // the list is asked for again, so reopening Bookmarks does not flash a
      // skeleton where "nothing saved" was already known.
      if (get().listFor !== pubkey || get().listOutcome !== "answered") set({ listOutcome: loadBase(pubkey) ? "answered" : "pending" });
      show(pubkey);
      await inTurn(() => reconcile(pubkey, "start"));
    },

    addBookmark: async (eventId: string) => {
      if (get().bookmarkedIds.includes(eventId)) return;
      change("e", { add: eventId });
    },

    removeBookmark: async (eventId: string) => {
      if (!get().bookmarkedIds.includes(eventId)) return;
      change("e", { remove: eventId });
    },

    isBookmarked: (eventId: string) => {
      return get().bookmarkedIds.includes(eventId);
    },

    addArticleBookmark: async (addr: string) => {
      if (get().bookmarkedArticleAddrs.includes(addr)) return;
      change("a", { add: addr });
    },

    removeArticleBookmark: async (addr: string) => {
      if (!get().bookmarkedArticleAddrs.includes(addr)) return;
      change("a", { remove: addr });
    },

    isArticleBookmarked: (addr: string) => {
      return get().bookmarkedArticleAddrs.includes(addr);
    },

    markArticleRead: (addr: string) => {
      const { readArticleAddrs } = get();
      if (readArticleAddrs.includes(addr)) return;
      const updated = [...readArticleAddrs, addr];
      set({ readArticleAddrs: updated });
      saveReadAddrs(updated);
    },

    markArticleUnread: (addr: string) => {
      const updated = get().readArticleAddrs.filter((a) => a !== addr);
      set({ readArticleAddrs: updated });
      saveReadAddrs(updated);
    },

    isArticleRead: (addr: string) => {
      return get().readArticleAddrs.includes(addr);
    },

    unreadArticleCount: () => {
      const { bookmarkedArticleAddrs, readArticleAddrs } = get();
      return bookmarkedArticleAddrs.filter((a) => !readArticleAddrs.includes(a)).length;
    },
  };
});
