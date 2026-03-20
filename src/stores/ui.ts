import { create } from "zustand";

import { NDKEvent } from "@nostr-dev-kit/ndk";

type View = "feed" | "search" | "relays" | "settings" | "profile" | "thread" | "article-editor" | "article" | "articles" | "media" | "about" | "zaps" | "dm" | "notifications" | "bookmarks" | "hashtag";
type FeedTab = "global" | "following" | "trending";

interface UIState {
  currentView: View;
  sidebarCollapsed: boolean;
  selectedPubkey: string | null;
  selectedNote: NDKEvent | null;
  previousView: View;
  feedTab: FeedTab;
  pendingSearch: string | null;
  pendingDMPubkey: string | null;
  pendingArticleNaddr: string | null;
  pendingArticleEvent: NDKEvent | null;
  pendingHashtag: string | null;
  showHelp: boolean;
  feedLanguageFilter: string | null;
  setView: (view: View) => void;
  setFeedTab: (tab: FeedTab) => void;
  openProfile: (pubkey: string) => void;
  openThread: (note: NDKEvent, from: View) => void;
  openSearch: (query: string) => void;
  openHashtag: (tag: string) => void;
  openDM: (pubkey: string) => void;
  openArticle: (naddr: string, event?: NDKEvent) => void;
  goBack: () => void;
  setFeedLanguageFilter: (filter: string | null) => void;
  toggleSidebar: () => void;
  toggleHelp: () => void;
}

const SIDEBAR_KEY = "wrystr_sidebar_collapsed";

export const useUIStore = create<UIState>((set, _get) => ({
  currentView: "feed",
  sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === "true",
  selectedPubkey: null,
  selectedNote: null,
  previousView: "feed",
  feedTab: "global",
  pendingSearch: null,
  pendingDMPubkey: null,
  pendingArticleNaddr: null,
  pendingArticleEvent: null,
  pendingHashtag: null,
  showHelp: false,
  feedLanguageFilter: null,
  setView: (currentView) => set({ currentView }),
  setFeedTab: (feedTab) => set({ feedTab }),
  openProfile: (pubkey) => set((s) => ({ currentView: "profile", selectedPubkey: pubkey, previousView: s.currentView as View })),
  openThread: (note, from) => set({ currentView: "thread", selectedNote: note, previousView: from }),
  openSearch: (query) => set({ currentView: "search", pendingSearch: query }),
  openHashtag: (tag) => set((s) => ({ currentView: "hashtag", pendingHashtag: tag, previousView: s.currentView as View })),
  openDM: (pubkey) => set({ currentView: "dm", pendingDMPubkey: pubkey }),
  openArticle: (naddr, event) => set((s) => ({ currentView: "article", pendingArticleNaddr: naddr, pendingArticleEvent: event ?? null, previousView: s.currentView as View })),
  goBack: () => set((s) => ({
    showHelp: false,
    currentView: s.previousView !== s.currentView ? s.previousView : "feed",
    selectedNote: null,
  })),
  setFeedLanguageFilter: (feedLanguageFilter) => set({ feedLanguageFilter }),
  toggleSidebar: () => set((s) => {
    const next = !s.sidebarCollapsed;
    localStorage.setItem(SIDEBAR_KEY, String(next));
    return { sidebarCollapsed: next };
  }),
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
}));
