import { create } from "zustand";
import { fetchBookmarkList, publishBookmarkList } from "../lib/nostr";

const STORAGE_KEY = "wrystr_bookmarks";

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

interface BookmarkState {
  bookmarkedIds: string[];
  fetchBookmarks: (pubkey: string) => Promise<void>;
  addBookmark: (eventId: string) => Promise<void>;
  removeBookmark: (eventId: string) => Promise<void>;
  isBookmarked: (eventId: string) => boolean;
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookmarkedIds: loadLocal(),

  fetchBookmarks: async (pubkey: string) => {
    try {
      const ids = await fetchBookmarkList(pubkey);
      if (ids.length === 0) return;
      const local = get().bookmarkedIds;
      const merged = Array.from(new Set([...ids, ...local]));
      set({ bookmarkedIds: merged });
      saveLocal(merged);
    } catch {
      // Non-critical — local bookmarks still work
    }
  },

  addBookmark: async (eventId: string) => {
    const { bookmarkedIds } = get();
    if (bookmarkedIds.includes(eventId)) return;
    const updated = [...bookmarkedIds, eventId];
    set({ bookmarkedIds: updated });
    saveLocal(updated);
    publishBookmarkList(updated).catch(() => {});
  },

  removeBookmark: async (eventId: string) => {
    const updated = get().bookmarkedIds.filter((id) => id !== eventId);
    set({ bookmarkedIds: updated });
    saveLocal(updated);
    publishBookmarkList(updated).catch(() => {});
  },

  isBookmarked: (eventId: string) => {
    return get().bookmarkedIds.includes(eventId);
  },
}));
