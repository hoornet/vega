import { create } from "zustand";
import { fetchBookmarkList, fetchBookmarkListFull, publishBookmarkListFull } from "../lib/nostr";

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

  fetchBookmarks: async (pubkey: string) => {
    try {
      const { eventIds, articleAddrs } = await fetchBookmarkListFull(pubkey);
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
        if (ids.length === 0) return;
        const local = get().bookmarkedIds;
        const merged = Array.from(new Set([...ids, ...local]));
        set({ bookmarkedIds: merged });
        saveLocal(merged);
      } catch { /* ignore */ }
    }
  },

  addBookmark: async (eventId: string) => {
    const { bookmarkedIds, bookmarkedArticleAddrs } = get();
    if (bookmarkedIds.includes(eventId)) return;
    const updated = [...bookmarkedIds, eventId];
    set({ bookmarkedIds: updated });
    saveLocal(updated);
    publishBookmarkListFull(updated, bookmarkedArticleAddrs).catch(() => {});
  },

  removeBookmark: async (eventId: string) => {
    const { bookmarkedArticleAddrs } = get();
    const updated = get().bookmarkedIds.filter((id) => id !== eventId);
    set({ bookmarkedIds: updated });
    saveLocal(updated);
    publishBookmarkListFull(updated, bookmarkedArticleAddrs).catch(() => {});
  },

  isBookmarked: (eventId: string) => {
    return get().bookmarkedIds.includes(eventId);
  },

  addArticleBookmark: async (addr: string) => {
    const { bookmarkedIds, bookmarkedArticleAddrs } = get();
    if (bookmarkedArticleAddrs.includes(addr)) return;
    const updated = [...bookmarkedArticleAddrs, addr];
    set({ bookmarkedArticleAddrs: updated });
    saveArticleAddrs(updated);
    publishBookmarkListFull(bookmarkedIds, updated).catch(() => {});
  },

  removeArticleBookmark: async (addr: string) => {
    const { bookmarkedIds } = get();
    const updated = get().bookmarkedArticleAddrs.filter((a) => a !== addr);
    set({ bookmarkedArticleAddrs: updated });
    saveArticleAddrs(updated);
    publishBookmarkListFull(bookmarkedIds, updated).catch(() => {});
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
