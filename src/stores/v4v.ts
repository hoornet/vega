import { create } from "zustand";
import { useToastStore } from "./toast";

const STORAGE_KEY = "wrystr_v4v";
const MAX_HISTORY = 500;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface V4VHistoryEntry {
  episodeGuid: string;
  episodeTitle: string;
  showTitle: string;
  satsStreamed: number;
  satsBoosted: number;
  recipients: { name: string; address: string; sats: number }[];
  timestamp: number;
}

interface V4VPersistedState {
  autoEnabled: boolean;
  perEpisodeCap: number;
  weeklyBudget: number;
  defaultRate: number;
  history: V4VHistoryEntry[];
}

interface V4VState extends V4VPersistedState {
  currentEpisodeSats: number;
  /** Of those, sats whose request went out but whose wallet answer never came: counted, since the sats left. */
  unconfirmedSats: number;
  /** The last payment that did not go out, for the dashboard; a toast says it once per episode and recipient. */
  lastFailure: { recipient: string; reason: string; at: number } | null;
  capReachedReason: string | null; // Set when a cap stops streaming

  // Computed
  weeklySpent: () => number;
  weeklyRemaining: () => number;
  isCapReached: () => boolean;

  // Actions
  setAutoEnabled: (v: boolean) => void;
  setPerEpisodeCap: (v: number) => void;
  setWeeklyBudget: (v: number) => void;
  setDefaultRate: (v: number) => void;
  setCapReachedReason: (reason: string | null) => void;
  addHistoryEntry: (entry: V4VHistoryEntry) => void;
  addCurrentEpisodeSats: (amount: number, unconfirmed?: boolean) => void;
  resetCurrentEpisodeSats: () => void;
  setLastFailure: (failure: { recipient: string; reason: string } | null) => void;
}

function loadPersisted(): V4VPersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { autoEnabled: false, perEpisodeCap: 0, weeklyBudget: 0, defaultRate: 10, history: [] };
    return JSON.parse(raw);
  } catch {
    return { autoEnabled: false, perEpisodeCap: 0, weeklyBudget: 0, defaultRate: 10, history: [] };
  }
}

function persist(state: V4VPersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function getPersistable(s: V4VState): V4VPersistedState {
  return {
    autoEnabled: s.autoEnabled,
    perEpisodeCap: s.perEpisodeCap,
    weeklyBudget: s.weeklyBudget,
    defaultRate: s.defaultRate,
    history: s.history,
  };
}

const initial = loadPersisted();

export const useV4VStore = create<V4VState>((set, get) => ({
  ...initial,
  currentEpisodeSats: 0,
  unconfirmedSats: 0,
  lastFailure: null,
  capReachedReason: null,

  weeklySpent: () => {
    const cutoff = Date.now() - WEEK_MS;
    return get().history
      .filter((e) => e.timestamp > cutoff)
      .reduce((sum, e) => sum + e.satsStreamed + e.satsBoosted, 0);
  },

  weeklyRemaining: () => {
    const { weeklyBudget } = get();
    if (weeklyBudget <= 0) return Infinity;
    return Math.max(0, weeklyBudget - get().weeklySpent());
  },

  isCapReached: () => {
    const { perEpisodeCap, currentEpisodeSats } = get();
    if (perEpisodeCap > 0 && currentEpisodeSats >= perEpisodeCap) return true;
    if (get().weeklyRemaining() <= 0) return true;
    return false;
  },

  setAutoEnabled: (v) => {
    const { perEpisodeCap, weeklyBudget } = get();
    if (v && (perEpisodeCap <= 0 || weeklyBudget <= 0)) {
      useToastStore.getState().addToast(
        "Set per-episode cap and weekly budget before enabling auto-stream",
        "warning",
      );
      return;
    }
    set({ autoEnabled: v });
    persist(getPersistable({ ...get(), autoEnabled: v }));
  },

  setPerEpisodeCap: (v) => {
    set({ perEpisodeCap: v });
    const s = { ...get(), perEpisodeCap: v };
    if (s.autoEnabled && v <= 0) {
      set({ autoEnabled: false });
      s.autoEnabled = false;
    }
    persist(getPersistable(s));
  },

  setWeeklyBudget: (v) => {
    set({ weeklyBudget: v });
    const s = { ...get(), weeklyBudget: v };
    if (s.autoEnabled && v <= 0) {
      set({ autoEnabled: false });
      s.autoEnabled = false;
    }
    persist(getPersistable(s));
  },

  setDefaultRate: (v) => {
    set({ defaultRate: v });
    persist(getPersistable({ ...get(), defaultRate: v }));
  },

  setCapReachedReason: (reason) => set({ capReachedReason: reason }),

  addHistoryEntry: (entry) => {
    const history = [entry, ...get().history].slice(0, MAX_HISTORY);
    set({ history });
    persist(getPersistable({ ...get(), history }));
  },

  addCurrentEpisodeSats: (amount, unconfirmed = false) => {
    set((s) => ({ currentEpisodeSats: s.currentEpisodeSats + amount, unconfirmedSats: s.unconfirmedSats + (unconfirmed ? amount : 0) }));
  },

  resetCurrentEpisodeSats: () => set({ currentEpisodeSats: 0, unconfirmedSats: 0, lastFailure: null, capReachedReason: null }),

  setLastFailure: (failure) => set({ lastFailure: failure ? { ...failure, at: Date.now() } : null }),
}));
