import { create } from "zustand";
import { fetchBookmarkList, fetchBookmarkListFull, publishBookmarkListFull } from "../lib/nostr";
import { fetchMark, wentUnanswered, type LoadOutcome } from "../lib/listLoad";
import { useToastStore } from "./toast";
import { forThisAccount } from "../lib/toastActions";
import { currentAccount, stillAccount } from "../lib/currentAccount";

// Debounce bookmark publishing to avoid race conditions with replaceable events
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let batchRemoves = false;
let batchAccount: string | null = null;
const FAILED = "publish:bookmarks";
function debouncedPublish(get: () => BookmarkState, removed = false) {
  // Whose list this is. Read now: by the time the pause is over the account
  // may have changed, and the list would be signed by whoever is there then.
  const account = currentAccount();
  // A batch belongs to one account. What the one before it did (a removal)
  // must not word the failure of this one's bookmark.
  if (account !== batchAccount) batchRemoves = false;
  batchAccount = account;
  batchRemoves ||= removed;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    const removes = batchRemoves;
    batchRemoves = false;
    publishBookmarks(get, { removes, account });
  }, 1000);
}

/**
 * Publish the bookmark list as it stands now. A bookmark is kept on this
 * device either way, but a failure used to be swallowed: the icon stayed
 * filled for something that had not reached any relay, and nothing said so.
 *
 * What is true of a failed bookmark is not true of a failed removal. The
 * next load merges the relays' list with this device's, so something removed
 * only here comes back. The message says which.
 */
function publishBookmarks(get: () => BookmarkState, { removes, account, retry = false }: { removes: boolean; account: string | null; retry?: boolean }): void {
  // The account changed during the pause: this list is not the new account's
  // to sign, and would replace theirs.
  if (!stillAccount(account)) return;
  const { bookmarkedIds, bookmarkedArticleAddrs } = get();
  publishBookmarkListFull(bookmarkedIds, bookmarkedArticleAddrs).then(
    (published) => {
      if (!stillAccount(account)) return;
      const toasts = useToastStore.getState();
      if (!published) {
        // No key to sign with: nothing went out. A retry that ends like this
        // must not just close its toast and say nothing.
        if (retry) toasts.addToast("Couldn't publish your bookmarks: you are not signed in with a key that can sign.", "error", { key: FAILED });
        return;
      }
      // The list is out, so an earlier "couldn't publish" is no longer true.
      toasts.removeByKey(FAILED);
      // A retry that works must say so: the toast is gone and nothing else on screen changes.
      if (retry) toasts.addToast("Bookmarks published.", "success");
    },
    () => {
      if (!stillAccount(account)) return; // not the new account's failure to hear
      useToastStore.getState().addToast(
        removes
          ? "Couldn't publish your bookmarks. The removal is on this device only, and may be undone the next time your list is loaded."
          : "Couldn't publish your bookmarks. The new one is saved on this device only.",
        "error",
        { key: FAILED, action: forThisAccount("Try again", () => publishBookmarks(get, { removes, account, retry: true }), account) },
      );
    },
  );
}

const STORAGE_KEY = "wrystr_bookmarks";
const ARTICLE_STORAGE_KEY = "wrystr_bookmarks_articles";
const READ_STORAGE_KEY = "wrystr_articles_read";

function loadLocal(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveLocal(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function loadArticleAddrs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ARTICLE_STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveArticleAddrs(addrs: string[]) {
  localStorage.setItem(ARTICLE_STORAGE_KEY, JSON.stringify(addrs));
}

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
  bookmarkedIds: string[];
  bookmarkedArticleAddrs: string[]; // "30023:<pubkey>:<d-tag>" format
  readArticleAddrs: string[];
  fetchBookmarks: (pubkey: string) => Promise<void>;
  /**
   * How the last fetch of the bookmark list ended. "unreachable" means no
   * relay answered, so "nothing saved" is not known.
   */
  listOutcome: LoadOutcome;
  /** The account `listOutcome` is about. */
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

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookmarkedIds: loadLocal(),
  bookmarkedArticleAddrs: loadArticleAddrs(),
  readArticleAddrs: loadReadAddrs(),

  listOutcome: "pending",
  listFor: null,

  fetchBookmarks: async (pubkey: string) => {
    // Not known until asked: for another account, or again after a load that
    // got no answer. An answer already given for this account stands while
    // the list is asked for again, so reopening Bookmarks does not flash a
    // skeleton where "nothing saved" was already known.
    if (get().listFor !== pubkey || get().listOutcome !== "answered") set({ listOutcome: "pending", listFor: pubkey });
    const mark = fetchMark();
    try {
      const { eventIds, articleAddrs } = await fetchBookmarkListFull(pubkey);
      set({ listOutcome: eventIds.length === 0 && articleAddrs.length === 0 && wentUnanswered(mark) ? "unreachable" : "answered" });
      const localIds = get().bookmarkedIds;
      const localAddrs = get().bookmarkedArticleAddrs;
      const mergedIds = Array.from(new Set([...eventIds, ...localIds]));
      const mergedAddrs = Array.from(new Set([...articleAddrs, ...localAddrs]));
      set({ bookmarkedIds: mergedIds, bookmarkedArticleAddrs: mergedAddrs });
      saveLocal(mergedIds);
      saveArticleAddrs(mergedAddrs);
    } catch {
      // Fallback to old format
      try {
        const ids = await fetchBookmarkList(pubkey);
        set({ listOutcome: ids.length === 0 && wentUnanswered(mark) ? "unreachable" : "answered" });
        if (ids.length === 0) return;
        const local = get().bookmarkedIds;
        const merged = Array.from(new Set([...ids, ...local]));
        set({ bookmarkedIds: merged });
        saveLocal(merged);
      } catch {
        set({ listOutcome: "error" });
      }
    }
  },

  addBookmark: async (eventId: string) => {
    const { bookmarkedIds } = get();
    if (bookmarkedIds.includes(eventId)) return;
    const updated = [...bookmarkedIds, eventId];
    set({ bookmarkedIds: updated });
    saveLocal(updated);
    debouncedPublish(get);
  },

  removeBookmark: async (eventId: string) => {
    const updated = get().bookmarkedIds.filter((id) => id !== eventId);
    set({ bookmarkedIds: updated });
    saveLocal(updated);
    debouncedPublish(get, true);
  },

  isBookmarked: (eventId: string) => {
    return get().bookmarkedIds.includes(eventId);
  },

  addArticleBookmark: async (addr: string) => {
    const { bookmarkedArticleAddrs } = get();
    if (bookmarkedArticleAddrs.includes(addr)) return;
    const updated = [...bookmarkedArticleAddrs, addr];
    set({ bookmarkedArticleAddrs: updated });
    saveArticleAddrs(updated);
    debouncedPublish(get);
  },

  removeArticleBookmark: async (addr: string) => {
    const updated = get().bookmarkedArticleAddrs.filter((a) => a !== addr);
    set({ bookmarkedArticleAddrs: updated });
    saveArticleAddrs(updated);
    debouncedPublish(get, true);
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
}));
