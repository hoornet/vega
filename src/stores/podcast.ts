import { create } from "zustand";
import type { PodcastShow, PodcastEpisode, PlaybackState } from "../types/podcast";
import { fetchPodcastList, publishPodcastList, type PodcastListResult } from "../lib/nostr/podcasts";
import { getNDK } from "../lib/nostr/core";
import { debug } from "../lib/debug";
import { useToastStore } from "./toast";
import { forThisAccount } from "../lib/toastActions";
import { stillAccount } from "../lib/currentAccount";
import { explainPublishError } from "../lib/publishErrors";
import { withinTime } from "../lib/timeLimit";

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

// The shows whose place in the list was changed here and is not yet on a
// relay, per account: added or removed, it does not matter which.
//
// At each start the relays' list replaces this device's ("cloud wins", so
// that a show removed on another device goes here too). A change whose publish
// failed was thrown away by that, without a word: the failure went to a
// development-only log. With changes on record, this device's list decides
// for the shows it changed and the relays' list for all the others, and the
// result is published.
//
// Which shows, not when: a time has to be compared with a relay event's,
// which is another device's clock, and cannot say what to do when both sides
// changed. "This device changed X and B" can be applied to whatever list the
// relays hold, as often as it takes.
function unpublishedKey(pubkey: string): string {
  return `wrystr_podcast_subs_unpublished:${pubkey}`;
}

function loadUnpublished(pubkey: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(unpublishedKey(pubkey)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((url): url is string => typeof url === "string") : [];
  } catch {
    return [];
  }
}

// How many changes each account has made in this session. A publish clears
// the record only if none was made while it was on its way.
const revisions = new Map<string, number>();

/** Put a show on record as changed here. */
function noteChange(pubkey: string, feedUrl: string) {
  const changed = loadUnpublished(pubkey);
  if (!changed.includes(feedUrl)) changed.push(feedUrl);
  localStorage.setItem(unpublishedKey(pubkey), JSON.stringify(changed));
  revisions.set(pubkey, (revisions.get(pubkey) ?? 0) + 1);
}

/**
 * The relays' list, with this device's say on the shows it changed: in the
 * list if they are in this device's, out of it if they are not. Shows keep
 * the place they have on the relays, and new ones go at the end.
 */
function withChanges(relays: PodcastShow[], local: PodcastShow[], changedHere: string[]): PodcastShow[] {
  const changed = new Set(changedHere);
  const here = new Set(local.map((show) => show.feedUrl));
  const kept = relays.filter((show) => !changed.has(show.feedUrl) || here.has(show.feedUrl));
  const have = new Set(kept.map((show) => show.feedUrl));
  return [...kept, ...local.filter((show) => changed.has(show.feedUrl) && !have.has(show.feedUrl))];
}

const FAILED = "publish:podcasts";
const KEPT = "The change is saved on this device, and Vega will try again when it next starts.";
const NO_KEY = `Couldn't publish your podcast subscriptions: you are not signed in with a key that can sign. ${KEPT}`;
/** A signer that never answers must not hold up every later change. */
const PUBLISH_LIMIT_MS = 30000;

/** Say that the list did not go out, with a way to try again. */
function sayNotPublished(pubkey: string, message: string) {
  if (!stillAccount(pubkey)) return; // not the next account's failure to hear
  useToastStore.getState().addToast(message, "error", {
    key: FAILED,
    action: forThisAccount("Try again", () => void inTurn(() => reconcile(pubkey, "retry")), pubkey),
  });
}

/**
 * Publish this account's list, and say so if it could not be done. The
 * subscriptions are on this device either way, and the record of what was
 * changed stays until a publish has carried all of it, so the next start
 * tries again.
 */
async function publishSubscriptions(pubkey: string, shows: PodcastShow[], retry: boolean): Promise<void> {
  // Only ever called from `reconcile`, which has just made sure that this
  // account is the one signed in. `publishPodcastList` makes sure that the
  // key is this account's.
  const toasts = useToastStore.getState();
  const revision = revisions.get(pubkey) ?? 0;
  let published: boolean;
  try {
    published = await withinTime(publishPodcastList(shows, pubkey), PUBLISH_LIMIT_MS, "the signer did not answer");
  } catch (err) {
    debug.warn("[Vega] Failed to publish podcast subscriptions:", err);
    sayNotPublished(pubkey, explainPublishError(err, KEPT, "publish your podcast subscriptions"));
    return;
  }
  // No key of this account's to sign with: nothing went out, and the changes
  // stay on record. Asked for by hand, that is said: "Try again" must not
  // close its toast and leave nothing behind.
  if (!published) {
    if (retry) sayNotPublished(pubkey, NO_KEY);
    return;
  }
  // Changed again while this was on its way: what was sent is not all of it.
  // The whole record stays, and making a change twice does no harm.
  if ((revisions.get(pubkey) ?? 0) === revision) localStorage.removeItem(unpublishedKey(pubkey));
  if (!stillAccount(pubkey)) return;
  toasts.removeByKey(FAILED);
  // A retry that works must say so: its toast is gone and nothing else on screen changes.
  if (retry) toasts.addToast("Podcast subscriptions published.", "success");
}

// One round at a time. A round reads the relays' list, works out the result
// and publishes it. Two of them at once could each publish what they worked
// out from the same reading, and the one that knew less could be the one the
// relays keep. And a reading that was asked before another round's publish
// holds the list from before it, which then replaced what had just gone out.
let turns: Promise<void> = Promise.resolve();
function inTurn(round: () => Promise<void>): Promise<void> {
  // A round that fails (storage full, say) must not be the end of the line,
  // and is nobody's to catch: the callers do not wait for it.
  const quietly = () => round().catch((err) => { debug.warn("[Vega] Podcast subscriptions could not be brought in line:", err); });
  turns = turns.then(quietly, quietly);
  return turns;
}

/**
 * Bring this account's list and the relays' together. The one way a list is
 * taken from the relays, and the one way a change made here goes out: at the
 * start, a moment after a change, and from "Try again".
 *
 * A change is never published from what this device happens to hold. It used
 * to be: the whole list as it stood here went out, over whatever another
 * device had done since this one last looked, and over the relays' list
 * altogether when this device had not managed to read it at the start.
 */
async function reconcile(pubkey: string, why: "start" | "change" | "retry"): Promise<void> {
  const mine = () => usePodcastStore.getState().activePubkey === pubkey && stillAccount(pubkey);
  if (!mine()) return;
  // After a change: nothing is waiting any more, an earlier round took it along.
  if (why !== "start" && loadUnpublished(pubkey).length === 0) return;

  let read: PodcastListResult;
  try {
    read = await fetchPodcastList(pubkey);
  } catch (err) {
    debug.warn("[Vega] Failed to fetch podcast subscriptions:", err);
    read = { status: "unknown" };
  }
  // The account may have changed while the relays were asked.
  if (!mine()) return;

  // Could not tell what the relays hold: nothing is taken, and nothing is
  // published over a list that may well be there. This device's list and its
  // record stay as they are. After a change that is a change that did not go
  // out, and is said.
  if (read.status === "unknown") {
    if (why !== "start") sayNotPublished(pubkey, `Couldn't publish your podcast subscriptions: the list on your relays could not be read. ${KEPT}`);
    return;
  }
  const result = read.status === "found" ? read : null;

  const local = usePodcastStore.getState().subscriptions;
  const changedHere = loadUnpublished(pubkey);

  // Shows changed here that no relay knows of yet: this device decides for
  // those, the relays for the rest, so that a show added or removed on
  // another device meanwhile is kept as that device left it. Then published,
  // if there is a key.
  if (changedHere.length > 0) {
    const merged = result ? withChanges(result.shows, local, changedHere) : local;
    saveSubscriptions(pubkey, merged);
    usePodcastStore.setState({ subscriptions: merged });
    if (getNDK().signer) await publishSubscriptions(pubkey, merged, why === "retry");
    // No key at all (read-only, or a signer that did not come back). Asked
    // for by hand, that is said, as it is for a key that is not this account's.
    else if (why === "retry") sayNotPublished(pubkey, NO_KEY);
    return;
  }

  // Steady state: cloud wins. The relays' list is the list, empty or not: an
  // empty one is a list someone emptied, and was taken for no list at all,
  // so this device published its own copy back.
  if (result) {
    saveSubscriptions(pubkey, result.shows);
    usePodcastStore.setState({ subscriptions: result.shows });
    return;
  }

  // The relays answered, and there is no list: this device's is the first.
  // Its shows go on record as changed here, so that this publish failing is
  // not the end of it: "Try again" and the next start find them waiting.
  if (local.length > 0 && getNDK().signer) {
    for (const show of local) noteChange(pubkey, show.feedUrl);
    await publishSubscriptions(pubkey, local, false);
  }
}

// A change goes out a moment after the last one, so that several made in a
// row are one publish. Cancelled on account switch: the change stays on
// record and goes out at that account's next start.
let publishTimer: number | null = null;

function schedulePublish(pubkey: string) {
  if (publishTimer !== null) window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => {
    publishTimer = null;
    void inTurn(() => reconcile(pubkey, "change"));
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
  /** The account was removed from this computer: its list and its record of changes go with it. */
  forgetAccount: (pubkey: string) => void;
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
    if (activePubkey) {
      noteChange(activePubkey, show.feedUrl);
      if (getNDK().signer) schedulePublish(activePubkey);
    }
  },

  unsubscribe: (feedUrl) => {
    const { subscriptions, activePubkey } = get();
    if (!subscriptions.some((s) => s.feedUrl === feedUrl)) return;
    const updated = subscriptions.filter((s) => s.feedUrl !== feedUrl);
    set({ subscriptions: updated });
    saveSubscriptions(activePubkey, updated);
    if (activePubkey) {
      noteChange(activePubkey, feedUrl);
      if (getNDK().signer) schedulePublish(activePubkey);
    }
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
    // 1. One-time legacy seed for first hydrate after upgrade. The shows it
    // brings were never on a relay under this account: each goes on record
    // as changed here, so that a list another device has already published
    // is joined with them and not put in their place.
    const legacy = consumeLegacySeed(pubkey);
    if (legacy) {
      saveSubscriptions(pubkey, legacy);
      if (get().activePubkey === pubkey) set({ subscriptions: legacy });
      localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
      for (const show of legacy) noteChange(pubkey, show.feedUrl);
    }

    // 2. The relays' list, and whatever was changed here and is still waiting.
    await inTurn(() => reconcile(pubkey, "start"));
  },

  forgetAccount: (pubkey) => {
    localStorage.removeItem(subsKey(pubkey));
    localStorage.removeItem(unpublishedKey(pubkey));
    revisions.delete(pubkey);
  },
}));
