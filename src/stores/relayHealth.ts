import { create } from "zustand";
import { checkAllRelays, type RelayHealthResult } from "../lib/nostr/relayHealth";
import { getStoredRelayUrls } from "../lib/nostr";

interface RelayHealthState {
  results: RelayHealthResult[];
  checking: boolean;
  lastChecked: number | null;
  checkAll: () => Promise<void>;
}

let again = false;

export const useRelayHealthStore = create<RelayHealthState>((set, get) => ({
  results: [],
  checking: false,
  lastChecked: null,

  checkAll: async () => {
    // A check asked for while one is running (a relay removed mid-check) runs once it is done.
    if (get().checking) { again = true; return; }
    // Immediately prune stale results for relays no longer stored
    const currentUrls = new Set(getStoredRelayUrls());
    const pruned = get().results.filter((r) => currentUrls.has(r.url));
    set({ checking: true, results: pruned });
    try {
      const urls = Array.from(currentUrls);
      const results = await checkAllRelays(urls);
      // Only relays still in the list: one removed while the check ran must not come back with its result.
      const stillStored = new Set(getStoredRelayUrls());
      set({ results: results.filter((r) => stillStored.has(r.url)), lastChecked: Date.now(), checking: false });
    } catch {
      set({ checking: false });
    }
    if (again) { again = false; void get().checkAll(); }
  },
}));
