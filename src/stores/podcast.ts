import { create } from "zustand";
import type { PodcastShow, PodcastEpisode, PlaybackState } from "../types/podcast";
import { fetchPodcastList, publishPodcastList } from "../lib/nostr/podcasts";
import { getNDK } from "../lib/nostr/core";
import { debug } from "../lib/debug";

const STORAGE_KEY = "wrystr_podcast";
const SUBS_KEY_LEGACY = "wrystr_podcast_subs";
const LEGACY_MIGRATED_KEY = "wrystr_podcast_legacy_migrated";

function subsKey(pubkey: string | null): string {
  return pubkey ? `${SUBS_KEY_LEGACY}:${pubkey}` : SUBS_KEY_LEGACY;
}

interface EpisodeProgress {
  position: number;
  timestamp: number;
}

function loadPersistedState(): {
  volume: number;
  playbackRate: number;
  v4vEnabled: boolean;
  v4vSatsPerMinute: number;
  progressMap: Record<string, EpisodeProgress>;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { volume: 1, playbackRate: 1, v4vEnabled: false, v4vSatsPerMinute: 10, progressMap: {} };
    return JSON.parse(raw);
  } catch {
    return { volume: 1, playbackRate: 1, v4vEnabled: false, v4vSatsPerMinute: 10, progressMap: {} };
  }
}

function persist(partial: Partial<PodcastState>) {
  try {
    const prev = loadPersistedState();
    const next = {
      volume: partial.volume ?? prev.volume,
      playbackRate: partial.playbackRate ?? prev.playbackRate,
      v4vEnabled: partial.v4vEnabled ?? prev.v4vEnabled,
      v4vSatsPerMinute: partial.v4vSatsPerMinute ?? prev.v4vSatsPerMinute,
      progressMap: partial.progressMap ?? prev.progressMap,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

function loadSubscriptions(pubkey: string | null): PodcastShow[] {
  try {
    return JSON.parse(localStorage.getItem(subsKey(pubkey)) ?? "[]");
  } catch {
    return [];
  }
}

function saveSubscriptions(pubkey: string | null, subs: PodcastShow[]) {
  localStorage.setItem(subsKey(pubkey), JSON.stringify(subs));
}

// One-time legacy seed: pre-pubkey installs stored everything under SUBS_KEY_LEGACY.
// On the first account that hydrates after upgrade, adopt that list as the seed
// so users don't appear to lose their podcasts.
function consumeLegacySeed(pubkey: string): PodcastShow[] | null {
  if (localStorage.getItem(LEGACY_MIGRATED_KEY) === "1") return null;
  if (localStorage.getItem(subsKey(pubkey))) return null;
  try {
    const raw = localStorage.getItem(SUBS_KEY_LEGACY);
    if (!raw) return null;
    const legacy: PodcastShow[] = JSON.parse(raw);
    if (!Array.isArray(legacy) || legacy.length === 0) return null;
    return legacy;
  } catch { return null; }
}

// Debounced publish — runs ~1.5s after the last change. Cancelled on account switch
// so a stale list never gets published under the new account's signer.
let publishTimer: number | null = null;

function schedulePublish(shows: PodcastShow[]) {
  if (publishTimer !== null) window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => {
    publishTimer = null;
    publishPodcastList(shows).catch((err) => {
      debug.warn("[Vega] Failed to publish podcast subscriptions:", err);
    });
  }, 1500);
}

function cancelPendingPublish() {
  if (publishTimer !== null) {
    window.clearTimeout(publishTimer);
    publishTimer = null;
  }
}

interface PodcastState {
  currentEpisode: PodcastEpisode | null;
  playbackState: PlaybackState;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  v4vEnabled: boolean;
  v4vSatsPerMinute: number;
  v4vTotalStreamed: number;
  v4vStreaming: boolean;
  v4vIntervalId: number | null;
  progressMap: Record<string, EpisodeProgress>;
  playCounter: number;
  subscriptions: PodcastShow[];
  activePubkey: string | null;

  play: (episode: PodcastEpisode) => void;
  pause: () => void;
  resume: () => void;
  seek: (seconds: number) => void;
  setRate: (rate: number) => void;
  setVolume: (v: number) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  saveProgress: () => void;
  loadProgress: (guid: string) => number;
  addStreamedSats: (amount: number) => void;
  setV4VEnabled: (enabled: boolean) => void;
  setV4VSatsPerMinute: (sats: number) => void;
  setV4VStreaming: (streaming: boolean, intervalId?: number | null) => void;
  stop: () => void;
  subscribe: (show: PodcastShow) => void;
  unsubscribe: (feedUrl: string) => void;
  isSubscribed: (feedUrl: string) => boolean;
  setActiveAccount: (pubkey: string | null) => void;
  hydrateSubscriptions: (pubkey: string) => Promise<void>;
}

const persisted = loadPersistedState();

export const usePodcastStore = create<PodcastState>((set, get) => ({
  currentEpisode: null,
  playbackState: "idle",
  currentTime: 0,
  duration: 0,
  playbackRate: persisted.playbackRate,
  volume: persisted.volume,
  v4vEnabled: persisted.v4vEnabled,
  v4vSatsPerMinute: persisted.v4vSatsPerMinute,
  v4vTotalStreamed: 0,
  v4vStreaming: false,
  v4vIntervalId: null,
  progressMap: persisted.progressMap,
  playCounter: 0,
  subscriptions: loadSubscriptions(null),
  activePubkey: null,

  play: (episode) => {
    const position = get().loadProgress(episode.guid);
    set({
      currentEpisode: episode,
      playbackState: "loading",
      currentTime: position,
      duration: episode.duration || 0,
      playCounter: get().playCounter + 1,
    });
  },

  pause: () => set({ playbackState: "paused" }),

  resume: () => set({ playbackState: "playing" }),

  seek: (seconds) => set({ currentTime: seconds }),

  setRate: (rate) => {
    set({ playbackRate: rate });
    persist({ playbackRate: rate });
  },

  setVolume: (v) => {
    set({ volume: v });
    persist({ volume: v });
  },

  setPlaybackState: (state) => set({ playbackState: state }),

  setCurrentTime: (t) => set({ currentTime: t }),

  setDuration: (d) => set({ duration: d }),

  saveProgress: () => {
    const { currentEpisode, currentTime, progressMap } = get();
    if (!currentEpisode) return;
    const updated = {
      ...progressMap,
      [currentEpisode.guid]: { position: currentTime, timestamp: Date.now() },
    };
    set({ progressMap: updated });
    persist({ progressMap: updated });
  },

  loadProgress: (guid) => {
    const entry = get().progressMap[guid];
    return entry?.position ?? 0;
  },

  addStreamedSats: (amount) => set((s) => ({ v4vTotalStreamed: s.v4vTotalStreamed + amount })),

  setV4VEnabled: (enabled) => {
    set({ v4vEnabled: enabled });
    persist({ v4vEnabled: enabled });
  },

  setV4VSatsPerMinute: (sats) => {
    set({ v4vSatsPerMinute: sats });
    persist({ v4vSatsPerMinute: sats });
  },

  setV4VStreaming: (streaming, intervalId) => set({
    v4vStreaming: streaming,
    v4vIntervalId: intervalId ?? null,
  }),

  stop: () => {
    const { v4vIntervalId } = get();
    if (v4vIntervalId !== null) clearInterval(v4vIntervalId);
    get().saveProgress();
    set({
      currentEpisode: null,
      playbackState: "idle",
      currentTime: 0,
      duration: 0,
      v4vStreaming: false,
      v4vIntervalId: null,
    });
  },

  subscribe: (show) => {
    const { subscriptions, activePubkey } = get();
    if (subscriptions.some((s) => s.feedUrl === show.feedUrl)) return;
    const updated = [...subscriptions, show];
    set({ subscriptions: updated });
    saveSubscriptions(activePubkey, updated);
    if (activePubkey && getNDK().signer) schedulePublish(updated);
  },

  unsubscribe: (feedUrl) => {
    const { subscriptions, activePubkey } = get();
    const updated = subscriptions.filter((s) => s.feedUrl !== feedUrl);
    set({ subscriptions: updated });
    saveSubscriptions(activePubkey, updated);
    if (activePubkey && getNDK().signer) schedulePublish(updated);
  },

  isSubscribed: (feedUrl) => {
    return get().subscriptions.some((s) => s.feedUrl === feedUrl);
  },

  setActiveAccount: (pubkey) => {
    // Cancel any pending publish — it belongs to the previous account.
    cancelPendingPublish();
    if (pubkey === get().activePubkey) return;
    const subs = loadSubscriptions(pubkey);
    set({ activePubkey: pubkey, subscriptions: subs });
  },

  hydrateSubscriptions: async (pubkey) => {
    // 1. One-time legacy seed for first hydrate after upgrade
    const legacy = consumeLegacySeed(pubkey);
    if (legacy) {
      saveSubscriptions(pubkey, legacy);
      if (get().activePubkey === pubkey) set({ subscriptions: legacy });
      localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
    }

    // 2. Fetch from relay
    let result: { shows: PodcastShow[]; createdAt: number } | null = null;
    try {
      result = await fetchPodcastList(pubkey);
    } catch (err) {
      debug.warn("[Vega] Failed to fetch podcast subscriptions:", err);
      return;
    }

    // Account may have switched while we were fetching — bail if no longer active.
    if (get().activePubkey !== pubkey) return;

    if (result && result.shows.length > 0) {
      // Cloud wins: replace local cache with relay state.
      saveSubscriptions(pubkey, result.shows);
      set({ subscriptions: result.shows });
      return;
    }

    // 3. No cloud list yet — if we have local entries, publish them as initial seed.
    const localSubs = get().subscriptions;
    if (localSubs.length > 0 && getNDK().signer) {
      try {
        await publishPodcastList(localSubs);
      } catch (err) {
        debug.warn("[Vega] Failed to seed podcast subscriptions to relay:", err);
      }
    }
  },
}));
