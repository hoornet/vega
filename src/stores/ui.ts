import { create } from "zustand";

import { NDKEvent } from "@nostr-dev-kit/ndk";

type View = "feed" | "search" | "relays" | "settings" | "profile" | "thread" | "article-editor";

interface UIState {
  currentView: View;
  sidebarCollapsed: boolean;
  selectedPubkey: string | null;
  selectedNote: NDKEvent | null;
  previousView: View;
  setView: (view: View) => void;
  openProfile: (pubkey: string) => void;
  openThread: (note: NDKEvent, from: View) => void;
  goBack: () => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set, _get) => ({
  currentView: "feed",
  sidebarCollapsed: false,
  selectedPubkey: null,
  selectedNote: null,
  previousView: "feed",
  setView: (currentView) => set({ currentView }),
  openProfile: (pubkey) => set((s) => ({ currentView: "profile", selectedPubkey: pubkey, previousView: s.currentView as View })),
  openThread: (note, from) => set({ currentView: "thread", selectedNote: note, previousView: from }),
  goBack: () => set((s) => ({
    currentView: s.previousView !== s.currentView ? s.previousView : "feed",
    selectedNote: null,
  })),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
