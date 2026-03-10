import { create } from "zustand";

import { NDKEvent } from "@nostr-dev-kit/ndk";

type View = "feed" | "search" | "relays" | "settings" | "profile" | "thread" | "article-editor" | "about" | "zaps" | "dm";

interface UIState {
  currentView: View;
  sidebarCollapsed: boolean;
  selectedPubkey: string | null;
  selectedNote: NDKEvent | null;
  previousView: View;
  pendingSearch: string | null;
  pendingDMPubkey: string | null;
  setView: (view: View) => void;
  openProfile: (pubkey: string) => void;
  openThread: (note: NDKEvent, from: View) => void;
  openSearch: (query: string) => void;
  openDM: (pubkey: string) => void;
  goBack: () => void;
  toggleSidebar: () => void;
}

const SIDEBAR_KEY = "wrystr_sidebar_collapsed";

export const useUIStore = create<UIState>((set, _get) => ({
  currentView: "feed",
  sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === "true",
  selectedPubkey: null,
  selectedNote: null,
  previousView: "feed",
  pendingSearch: null,
  pendingDMPubkey: null,
  setView: (currentView) => set({ currentView }),
  openProfile: (pubkey) => set((s) => ({ currentView: "profile", selectedPubkey: pubkey, previousView: s.currentView as View })),
  openThread: (note, from) => set({ currentView: "thread", selectedNote: note, previousView: from }),
  openSearch: (query) => set({ currentView: "search", pendingSearch: query }),
  openDM: (pubkey) => set({ currentView: "dm", pendingDMPubkey: pubkey }),
  goBack: () => set((s) => ({
    currentView: s.previousView !== s.currentView ? s.previousView : "feed",
    selectedNote: null,
  })),
  toggleSidebar: () => set((s) => {
    const next = !s.sidebarCollapsed;
    localStorage.setItem(SIDEBAR_KEY, String(next));
    return { sidebarCollapsed: next };
  }),
}));
