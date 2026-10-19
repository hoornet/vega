import { create } from "zustand";

const KEY = "wrystr_relay_list_unshared";

/**
 * Whether the relay list on this computer has changed since it was last
 * shared (published as kind 10002). Set by every add and remove, Undo
 * included, and cleared when a share goes out for the list as it was. A
 * store, not component state: Undo runs from a toast after the Relays view
 * may be gone. Per device, like the stored list itself; a share by another
 * account on this computer clears it too (a known gap).
 */
interface RelayListShareState {
  unshared: boolean;
  mark: (unshared: boolean) => void;
}

export const useRelayListShare = create<RelayListShareState>((set) => ({
  unshared: localStorage.getItem(KEY) === "true",
  mark: (unshared) => {
    if (unshared) localStorage.setItem(KEY, "true"); else localStorage.removeItem(KEY);
    set({ unshared });
  },
}));
