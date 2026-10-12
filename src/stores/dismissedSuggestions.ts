import { create } from "zustand";

const STORAGE_KEY = "wrystr_dismissed_suggestions";

function loadDismissed(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    // A stored value that is not a list of keys used to throw in the render.
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function saveDismissed(pubkeys: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pubkeys));
}

interface DismissedSuggestionsState {
  dismissedPubkeys: string[];
  dismiss: (pubkey: string) => void;
  undismiss: (pubkey: string) => void;
  isDismissed: (pubkey: string) => boolean;
  clearAll: () => void;
}

export const useDismissedSuggestionsStore = create<DismissedSuggestionsState>((set, get) => ({
  dismissedPubkeys: loadDismissed(),

  dismiss: (pubkey: string) => {
    const { dismissedPubkeys } = get();
    if (dismissedPubkeys.includes(pubkey)) return;
    const updated = [...dismissedPubkeys, pubkey];
    set({ dismissedPubkeys: updated });
    saveDismissed(updated);
  },

  undismiss: (pubkey: string) => {
    const updated = get().dismissedPubkeys.filter((p) => p !== pubkey);
    set({ dismissedPubkeys: updated });
    saveDismissed(updated);
  },

  isDismissed: (pubkey: string) => {
    return get().dismissedPubkeys.includes(pubkey);
  },

  clearAll: () => {
    set({ dismissedPubkeys: [] });
    saveDismissed([]);
  },
}));
