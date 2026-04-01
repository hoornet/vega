import { create } from "zustand";
import { NDKEvent, NDKFilter, NDKKind, NDKSubscription, NDKSubscriptionCacheUsage } from "@nostr-dev-kit/ndk";
import { connectToRelays, ensureConnected, resetNDK, fetchGlobalFeed, fetchBatchEngagement, fetchTrendingCandidates, getNDK } from "../lib/nostr";
import { seedReactionsCache } from "../hooks/useReactions";
import { useToastStore } from "./toast";
import { dbLoadFeed, dbSaveNotes } from "../lib/db";
import { diagWrapFetch, logDiag, startRelaySnapshots, getRelayStates } from "../lib/feedDiagnostics";
// Local relay imports deferred to avoid circular dependency
// import { isLocalRelayEnabled, connectLocalRelay } from "../lib/localRelay";

const TRENDING_CACHE_KEY = "wrystr_trending_cache";
const TRENDING_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_FEED_SIZE = 200;

// Live subscription handle — persists across store calls
let liveSub: NDKSubscription | null = null;

export function isLiveSubActive(): boolean {
  return liveSub !== null;
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;

interface FeedState {
  notes: NDKEvent[];
  loading: boolean;
  connected: boolean;
  error: string | null;
  focusedNoteIndex: number;
  lastUpdated: Record<string, number>;
  trendingNotes: NDKEvent[];
  trendingLoading: boolean;
  connect: () => Promise<void>;
  loadCachedFeed: () => Promise<void>;
  loadFeed: () => Promise<void>;
  startLiveFeed: () => void;
  loadTrendingFeed: (force?: boolean) => Promise<void>;
  setFocusedNoteIndex: (n: number) => void;
}

export const useFeedStore = create<FeedState>((set, get) => ({
  notes: [],
  loading: false,
  connected: false,
  error: null,
  focusedNoteIndex: -1,
  lastUpdated: {},
  trendingNotes: [],
  trendingLoading: false,
  setFocusedNoteIndex: (n: number) => set({ focusedNoteIndex: n }),

  connect: async () => {
    try {
      set({ error: null });
      const connectStart = performance.now();
      // connectToRelays() can hang if NDK's instance.connect() never resolves — safety timeout
      await Promise.race([
        connectToRelays(),
        new Promise<void>((resolve) => setTimeout(resolve, 15000)),
      ]);
      set({ connected: true });

      // Connect local embedded relay if enabled, then sync recent events
      try {
        const { isLocalRelayEnabled, connectLocalRelay, syncToLocalRelay } = await import("../lib/localRelay");
        if (isLocalRelayEnabled()) {
          await connectLocalRelay();
          const { useUserStore } = await import("./user");
          const { pubkey, follows } = useUserStore.getState();
          if (pubkey) {
            syncToLocalRelay(pubkey, follows).catch((err) =>
              console.warn("[Vega] Local relay sync failed:", err),
            );
          }
        }
      } catch (err) {
        console.warn("[Vega] Local relay setup failed:", err);
      }

      const connectMs = Math.round(performance.now() - connectStart);
      logDiag({
        ts: new Date().toISOString(),
        action: "relay_connect",
        durationMs: connectMs,
        relayStates: getRelayStates(),
        details: `Initial connection complete`,
      });
      startRelaySnapshots();

      // Monitor relay connectivity — check every 5s, reconnect if needed.
      // Always call getNDK() fresh — instance may be replaced by resetNDK().
      let offlineStreak = 0;

      const checkConnection = () => {
        const currentNdk = getNDK();
        const relays = Array.from(currentNdk.pool?.relays?.values() ?? []);
        const hasConnected = relays.some((r) => r.connected);

        if (hasConnected) {
          if (offlineStreak > 0) {
            useToastStore.getState().addToast("Back online", "success");
          }
          offlineStreak = 0;
          if (!get().connected) set({ connected: true });
        } else {
          offlineStreak++;
          // Mark offline after 3 consecutive checks (15s grace)
          if (offlineStreak >= 3 && get().connected) {
            set({ connected: false });
            logDiag({ ts: new Date().toISOString(), action: "connection_lost", details: `No relays connected after ${offlineStreak} checks` });
            useToastStore.getState().addToast("Connection lost \u2014 reconnecting\u2026", "warning");
            // Nuclear reset after 6 consecutive failures (30s)
            if (offlineStreak >= 6) {
              offlineStreak = 0;
              useToastStore.getState().addToast("Resetting relay connections\u2026", "info");
              resetNDK().then(() => {
                if (getNDK().pool?.relays) {
                  const after = Array.from(getNDK().pool.relays.values());
                  if (after.some((r) => r.connected)) {
                    set({ connected: true });
                    useToastStore.getState().addToast("Relays reconnected", "success");
                    // Restart live sub after NDK reset
                    get().startLiveFeed();
                  }
                }
              }).catch(() => {});
            } else {
              currentNdk.connect().catch(() => {});
            }
          }
        }
      };
      setInterval(checkConnection, 5000);
    } catch (err) {
      set({ error: `Connection failed: ${err}` });
    }
  },

  loadCachedFeed: async () => {
    try {
      const rawNotes = await dbLoadFeed(MAX_FEED_SIZE);
      if (rawNotes.length === 0) return;
      const ndk = getNDK();
      const events = rawNotes.map((raw) => new NDKEvent(ndk, JSON.parse(raw)));
      set({ notes: events });
    } catch {
      // Cache read failure is non-critical
    }
  },

  /**
   * One-shot feed fetch — loads initial batch, then starts live subscription.
   */
  loadFeed: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      await ensureConnected();
      const fresh = await diagWrapFetch("global_fetch", () => fetchGlobalFeed(80));

      // Merge with currently displayed notes
      const freshIds = new Set(fresh.map((n) => n.id));
      const kept = get().notes.filter((n) => !freshIds.has(n.id));
      const merged = [...fresh, ...kept]
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
        .slice(0, MAX_FEED_SIZE);

      set({ notes: merged, loading: false, focusedNoteIndex: -1, lastUpdated: { ...get().lastUpdated, global: Date.now() } });

      // Persist fresh notes to SQLite (fire-and-forget)
      dbSaveNotes(fresh.map((e) => JSON.stringify(e.rawEvent())));

      // Start live subscription after initial load
      get().startLiveFeed();
    } catch (err) {
      set({ error: `Feed failed: ${err}`, loading: false });
    }
  },

  /**
   * Start a persistent live subscription for new notes.
   * New events stream in and are prepended to the feed in real time.
   */
  startLiveFeed: () => {
    // Close existing subscription if any
    if (liveSub) {
      try { liveSub.stop(); } catch { /* ignore */ }
      liveSub = null;
    }

    const ndk = getNDK();
    const since = Math.floor(Date.now() / 1000);
    const filter: NDKFilter = { kinds: [NDKKind.Text], since, limit: 20 };

    const sub = ndk.subscribe(filter, {
      closeOnEose: false,  // Keep subscription open — this is the key difference
      groupable: false,
      cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
    });

    sub.on("event", (event: NDKEvent) => {
      const current = get().notes;
      // Deduplicate
      if (current.some((n) => n.id === event.id)) return;

      const updated = [event, ...current]
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
        .slice(0, MAX_FEED_SIZE);
      set({ notes: updated, lastUpdated: { ...get().lastUpdated, global: Date.now() } });

      // Debounced save to SQLite — batch saves every 5s
      if (!saveTimer) {
        saveTimer = setTimeout(() => {
          saveTimer = null;
          const toSave = get().notes.slice(0, 20);
          dbSaveNotes(toSave.map((e) => JSON.stringify(e.rawEvent())));
        }, 5000);
      }
    });

    sub.on("eose", () => {
      logDiag({
        ts: new Date().toISOString(),
        action: "live_feed_eose",
        details: "Live subscription received EOSE — now streaming new events",
      });
    });

    liveSub = sub;
    console.log("[Vega] Live feed subscription started");
  },

  loadTrendingFeed: async (force?: boolean) => {
    if (get().trendingLoading) return;

    // Check cache first (skip if forced refresh)
    if (!force) {
      try {
        const cached = localStorage.getItem(TRENDING_CACHE_KEY);
        if (cached) {
          const { timestamp } = JSON.parse(cached) as { noteIds: string[]; timestamp: number };
          if (Date.now() - timestamp < TRENDING_TTL && get().trendingNotes.length > 0) {
            return; // Cache still valid and notes already in store
          }
        }
      } catch { /* ignore cache errors */ }
    }

    set({ trendingLoading: true, ...(force ? { trendingNotes: [] } : {}) });
    try {
      const notes = await fetchTrendingCandidates(200, 24);

      if (notes.length === 0) {
        set({ trendingNotes: [], trendingLoading: false });
        return;
      }

      const eventIds = notes.map((n) => n.id).filter(Boolean) as string[];
      const engagement = await fetchBatchEngagement(eventIds);

      // Seed per-note reaction cache so emoji pills render instantly
      for (const [id, eng] of engagement) {
        if (eng.reactionGroups.size > 0) {
          seedReactionsCache(id, eng.reactionGroups, eng.myReactions);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const scored = notes
        .map((note) => {
          const eng = engagement.get(note.id) ?? { reactions: 0, replies: 0, zapSats: 0 };
          const ageHours = (now - (note.created_at ?? now)) / 3600;
          const decay = 1 / (1 + ageHours * 0.15);
          const engScore = eng.reactions * 1 + eng.replies * 3 + eng.zapSats * 0.01;
          // Base recency score ensures notes appear even when engagement data times out
          const score = (engScore + 0.1) * decay;
          return { note, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
        .map((s) => s.note);

      set({ trendingNotes: scored, trendingLoading: false, lastUpdated: { ...get().lastUpdated, trending: Date.now() } });

      // Cache note IDs + timestamp
      localStorage.setItem(TRENDING_CACHE_KEY, JSON.stringify({
        noteIds: scored.map((n) => n.id),
        timestamp: Date.now(),
      }));
    } catch (err) {
      set({ error: `Trending failed: ${err}`, trendingLoading: false });
    }
  },
}));
