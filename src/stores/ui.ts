import { create } from "zustand";

type View = "feed" | "relays" | "settings" | "profile";

interface UIState {
  currentView: View;
  sidebarCollapsed: boolean;
  selectedPubkey: string | null;
  setView: (view: View) => void;
  openProfile: (pubkey: string) => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  currentView: "feed",
  sidebarCollapsed: false,
  selectedPubkey: null,
  setView: (currentView) => set({ currentView }),
  openProfile: (pubkey) => set({ currentView: "profile", selectedPubkey: pubkey }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
