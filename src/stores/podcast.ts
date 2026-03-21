import { create } from "zustand";
import type { PodcastShow, PodcastEpisode, PlaybackState } from "../types/podcast";

const STORAGE_KEY = "wrystr_podcast";
const SUBS_KEY = "wrystr_podcast_subs";

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
}

function loadSubscriptions(): PodcastShow[] {
  try {
    return JSON.parse(localStorage.getItem(SUBS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveSubscriptions(subs: PodcastShow[]) {
  localStorage.setItem(SUBS_KEY, JSON.stringify(subs));
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
  subscriptions: loadSubscriptions(),

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
    const { subscriptions } = get();
    if (subscriptions.some((s) => s.feedUrl === show.feedUrl)) return;
    const updated = [...subscriptions, show];
    set({ subscriptions: updated });
    saveSubscriptions(updated);
  },

  unsubscribe: (feedUrl) => {
    const updated = get().subscriptions.filter((s) => s.feedUrl !== feedUrl);
    set({ subscriptions: updated });
    saveSubscriptions(updated);
  },

  isSubscribed: (feedUrl) => {
    return get().subscriptions.some((s) => s.feedUrl === feedUrl);
  },
}));
