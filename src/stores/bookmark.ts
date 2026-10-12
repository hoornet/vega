import { create } from "zustand";
import { fetchBookmarkList, fetchBookmarkListFull, publishBookmarkListFull } from "../lib/nostr";
import { fetchMark, wentUnanswered, type LoadOutcome } from "../lib/listLoad";

// Debounce bookmark publishing to avoid race conditions with replaceable events
let publishTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedPublish(get: () => BookmarkState) {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    const { bookmarkedIds, bookmarkedArticleAddrs } = get();
    publishBookmarkListFull(bookmarkedIds, bookmarkedArticleAddrs).catch(() => {});
  }, 1000);
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
    debouncedPublish(get);
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
    debouncedPublish(get);
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
