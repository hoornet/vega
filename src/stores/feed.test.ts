import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NDKEvent } from "@nostr-dev-kit/ndk";


// Mock the nostr module
vi.mock("../lib/nostr", () => ({
  connectToRelays: vi.fn(),
  ensureConnected: vi.fn().mockResolvedValue(true),
  fetchGlobalFeed: vi.fn(),
  fetchTrendingCandidates: vi.fn(),
  fetchBatchEngagement: vi.fn(),
  getNDK: vi.fn(() => ({ pool: { relays: new Map() } })),
}));

// Mock the db module
vi.mock("../lib/db", () => ({
  dbLoadFeed: vi.fn().mockResolvedValue([]),
  dbSaveNotes: vi.fn(),
}));

import { useFeedStore } from "./feed";
import { fetchTrendingCandidates, fetchBatchEngagement, fetchGlobalFeed, getNDK } from "../lib/nostr";
import { recordFetchOutcome } from "../lib/nostr/fetchTotals";

/** The relays answered, with these notes. */
const answering = (notes: NDKEvent[]) => async () => { recordFetchOutcome(true); return notes; };
/** The fetch ran out of time with nothing collected. */
const timingOut = async () => { recordFetchOutcome(false); return [] as NDKEvent[]; };

function makeMockNote(id: string, created_at: number): NDKEvent {
  const event = { id, created_at, content: "test", kind: 1, pubkey: "pk", tags: [], sig: "", rawEvent: () => ({ id, created_at, content: "test", kind: 1, pubkey: "pk", tags: [], sig: "" }) } as unknown as NDKEvent;
  return event;
}

describe("useFeedStore - loadTrendingFeed", () => {
  beforeEach(() => {
    useFeedStore.setState({
      notes: [],
      trendingNotes: [],
      trendingLoading: false,
      loading: false,
      connected: false,
      outcome: { global: "answered", trending: "answered" },
      focusedNoteIndex: -1,
    });
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("scores and sorts notes by engagement", async () => {
    const now = Math.floor(Date.now() / 1000);
    const notes = [
      makeMockNote("a", now - 100),
      makeMockNote("b", now - 100),
      makeMockNote("c", now - 100),
    ];

    const engagement = new Map([
      ["a", { reactions: 10, replies: 0, zapSats: 0, reactionGroups: new Map<string, number>(), myReactions: new Set<string>() }],  // score: 10
      ["b", { reactions: 0, replies: 5, zapSats: 0, reactionGroups: new Map<string, number>(), myReactions: new Set<string>() }],   // score: 15
      ["c", { reactions: 1, replies: 1, zapSats: 100, reactionGroups: new Map<string, number>(), myReactions: new Set<string>() }],  // score: 5
    ]);

    vi.mocked(fetchTrendingCandidates).mockResolvedValue(notes);
    vi.mocked(fetchBatchEngagement).mockResolvedValue(engagement);

    await useFeedStore.getState().loadTrendingFeed(true);

    const trending = useFeedStore.getState().trendingNotes;
    expect(trending).toHaveLength(3);
    expect(trending[0].id).toBe("b"); // highest score: 15
    expect(trending[1].id).toBe("a"); // score: 10
    expect(trending[2].id).toBe("c"); // score: 5
  });

  // Trending deliberately does NOT drop zero-engagement notes. 2bb1341
  // ("trending always shows notes") removed the `.filter(s => s.score > 0)`
  // and added a +0.1 base score, because engagement fetches time out often
  // enough that the filter produced an empty Trending tab. Don't reinstate
  // the filter to make a test pass — these two pin the intended behaviour.
  it("ranks zero-engagement notes last instead of dropping them", async () => {
    const now = Math.floor(Date.now() / 1000);
    const notes = [
      makeMockNote("a", now - 100),
      makeMockNote("b", now - 100),
    ];

    const engagement = new Map([
      ["a", { reactions: 5, replies: 0, zapSats: 0, reactionGroups: new Map<string, number>(), myReactions: new Set<string>() }],
      ["b", { reactions: 0, replies: 0, zapSats: 0, reactionGroups: new Map<string, number>(), myReactions: new Set<string>() }],
    ]);

    vi.mocked(fetchTrendingCandidates).mockResolvedValue(notes);
    vi.mocked(fetchBatchEngagement).mockResolvedValue(engagement);

    await useFeedStore.getState().loadTrendingFeed(true);

    const trending = useFeedStore.getState().trendingNotes;
    expect(trending.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("still shows notes when engagement data is unavailable", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Newest last, to prove the ordering comes from recency decay rather than
    // from the order the relays happened to return them in.
    const notes = [
      makeMockNote("older", now - 7200),
      makeMockNote("newer", now - 60),
    ];

    vi.mocked(fetchTrendingCandidates).mockResolvedValue(notes);
    vi.mocked(fetchBatchEngagement).mockResolvedValue(new Map());

    await useFeedStore.getState().loadTrendingFeed(true);

    expect(useFeedStore.getState().trendingNotes.map((n) => n.id)).toEqual(["newer", "older"]);
  });

  it("limits results to 50", async () => {
    const now = Math.floor(Date.now() / 1000);
    const notes = Array.from({ length: 60 }, (_, i) => makeMockNote(`n${i}`, now - i));
    const engagement = new Map(
      notes.map((n) => [n.id, { reactions: 10, replies: 1, zapSats: 0, reactionGroups: new Map<string, number>(), myReactions: new Set<string>() }])
    );

    vi.mocked(fetchTrendingCandidates).mockResolvedValue(notes);
    vi.mocked(fetchBatchEngagement).mockResolvedValue(engagement);

    await useFeedStore.getState().loadTrendingFeed(true);

    expect(useFeedStore.getState().trendingNotes).toHaveLength(50);
  });

  it("handles empty feed gracefully", async () => {
    vi.mocked(fetchTrendingCandidates).mockResolvedValue([]);

    await useFeedStore.getState().loadTrendingFeed(true);

    expect(useFeedStore.getState().trendingNotes).toHaveLength(0);
    expect(useFeedStore.getState().trendingLoading).toBe(false);
  });
});


describe("loadOlderNotes: one empty answer is not the end of history", () => {
  beforeEach(() => {
    vi.mocked(fetchGlobalFeed).mockReset();
    useFeedStore.setState({
      notes: [makeMockNote("seed", 1000)],
      loadingOlder: false,
      feedReachedEnd: false,
    });
  });

  it("retries once before concluding the history has ended", async () => {
    vi.useFakeTimers();
    try {
      // First answer empty, second has something. Before #63 the first empty
      // answer latched infinite scroll off for the rest of the session.
      vi.mocked(fetchGlobalFeed)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeMockNote("older", 900)]);

      const done = useFeedStore.getState().loadOlderNotes();
      await vi.advanceTimersByTimeAsync(3100);
      await done;

      expect(vi.mocked(fetchGlobalFeed)).toHaveBeenCalledTimes(2);
      expect(useFeedStore.getState().feedReachedEnd).toBe(false);
      expect(useFeedStore.getState().notes.map((n) => n.id)).toContain("older");
    } finally {
      vi.useRealTimers();
    }
  });

  it("believes two empty answers in a row", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchGlobalFeed).mockResolvedValue([]);

      const done = useFeedStore.getState().loadOlderNotes();
      await vi.advanceTimersByTimeAsync(3100);
      await done;

      expect(vi.mocked(fetchGlobalFeed)).toHaveBeenCalledTimes(2);
      expect(useFeedStore.getState().feedReachedEnd).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry when the first answer already had something", async () => {
    // The retry costs 3 seconds; it must only apply to the empty case.
    vi.mocked(fetchGlobalFeed).mockResolvedValueOnce([makeMockNote("older", 900)]);

    await useFeedStore.getState().loadOlderNotes();

    expect(vi.mocked(fetchGlobalFeed)).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().feedReachedEnd).toBe(false);
  });

  it("stops if a refresh ended the feed while it was waiting to retry", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchGlobalFeed).mockResolvedValue([]);
      const done = useFeedStore.getState().loadOlderNotes();

      // Something else concluded the feed during the 3s wait.
      useFeedStore.setState({ feedReachedEnd: true });
      await vi.advanceTimersByTimeAsync(3100);
      await done;

      expect(vi.mocked(fetchGlobalFeed)).toHaveBeenCalledTimes(1); // no retry
      expect(useFeedStore.getState().loadingOlder).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});


describe("loadTrendingFeed: how the load ended", () => {
  const onScreen = [makeMockNote("old-1", 1000), makeMockNote("old-2", 900)];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchTrendingCandidates).mockReset();
    vi.mocked(fetchBatchEngagement).mockReset().mockResolvedValue(new Map());
    localStorage.clear();
    useFeedStore.setState({ trendingNotes: onScreen, trendingLoading: false, outcome: { global: "pending", trending: "pending" } });
  });
  afterEach(() => { vi.useRealTimers(); });

  const refresh = async () => {
    const done = useFeedStore.getState().loadTrendingFeed(true);
    await vi.advanceTimersByTimeAsync(3100); // the retry after an empty answer
    await done;
  };

  // A refresh emptied the list before asking, so an unanswered refresh left
  // "No trending notes right now" where notes had been.
  it("keeps the notes on screen while a refresh is under way", async () => {
    let seenDuring: number | undefined;
    vi.mocked(fetchTrendingCandidates).mockImplementation(async () => {
      seenDuring = useFeedStore.getState().trendingNotes.length;
      recordFetchOutcome(true);
      return [makeMockNote("new", 2000)];
    });
    await refresh();
    expect(seenDuring).toBe(2);
    expect(useFeedStore.getState().trendingNotes.map((n) => n.id)).toEqual(["new"]);
  });

  it("is unreachable, with the old notes kept, when nobody answered", async () => {
    vi.mocked(fetchTrendingCandidates).mockImplementation(timingOut);
    await refresh();
    const s = useFeedStore.getState();
    expect(s.outcome.trending).toBe("unreachable");
    expect(s.trendingNotes).toBe(onScreen);
    expect(s.trendingLoading).toBe(false);
  });

  it("is empty when a relay answered a refresh with nothing", async () => {
    vi.mocked(fetchTrendingCandidates).mockImplementation(answering([]));
    await refresh();
    const s = useFeedStore.getState();
    expect(s.outcome.trending).toBe("answered");
    expect(s.trendingNotes).toEqual([]);
  });

  it("is an error, with the old notes kept, when the load throws", async () => {
    vi.mocked(fetchTrendingCandidates).mockRejectedValue(new Error("boom"));
    await refresh();
    const s = useFeedStore.getState();
    expect(s.outcome.trending).toBe("error");
    expect(s.trendingNotes).toBe(onScreen);
    expect(s.trendingLoading).toBe(false);
  });

  it("goes back to answered once a load succeeds", async () => {
    useFeedStore.setState({ outcome: { global: "answered", trending: "unreachable" } });
    vi.mocked(fetchTrendingCandidates).mockImplementation(answering([makeMockNote("new", 2000)]));
    await refresh();
    expect(useFeedStore.getState().outcome.trending).toBe("answered");
  });

  it("leaves the other tab's outcome alone", async () => {
    useFeedStore.setState({ outcome: { global: "error", trending: "pending" } });
    vi.mocked(fetchTrendingCandidates).mockImplementation(timingOut);
    await refresh();
    expect(useFeedStore.getState().outcome).toEqual({ global: "error", trending: "unreachable" });
  });
});

describe("loadFeed: how the load ended", () => {
  const onScreen = [makeMockNote("old", 1000)];

  beforeEach(() => {
    vi.mocked(fetchGlobalFeed).mockReset();
    useFeedStore.setState({ notes: onScreen, loading: false, outcome: { global: "pending", trending: "pending" }, lastUpdated: {} });
  });

  it("starts as not asked: nothing is known until a load has ended", () => {
    expect(useFeedStore.getInitialState().outcome).toEqual({ global: "pending", trending: "pending" });
  });

  it("is unreachable, with the notes kept, when nobody answered", async () => {
    vi.mocked(fetchGlobalFeed).mockImplementation(timingOut);
    await useFeedStore.getState().loadFeed();
    const s = useFeedStore.getState();
    expect(s.outcome.global).toBe("unreachable");
    expect(s.notes.map((n) => n.id)).toEqual(["old"]);
    expect(s.loading).toBe(false);
  });

  // "just now" in the header, beside notes that are from before.
  it("does not move the time of the last update when nobody answered", async () => {
    useFeedStore.setState({ lastUpdated: { global: 1234 } });
    vi.mocked(fetchGlobalFeed).mockImplementation(timingOut);
    await useFeedStore.getState().loadFeed();
    expect(useFeedStore.getState().lastUpdated.global).toBe(1234);
  });

  it("moves the time of the last update when a relay answered, even with nothing", async () => {
    useFeedStore.setState({ lastUpdated: { global: 1234 } });
    vi.mocked(fetchGlobalFeed).mockImplementation(answering([]));
    await useFeedStore.getState().loadFeed();
    expect(useFeedStore.getState().lastUpdated.global).toBeGreaterThan(1234);
  });

  it("is answered when a relay answered with nothing", async () => {
    vi.mocked(fetchGlobalFeed).mockImplementation(answering([]));
    await useFeedStore.getState().loadFeed();
    expect(useFeedStore.getState().outcome.global).toBe("answered");
  });

  it("is answered, and merges, when notes came back", async () => {
    useFeedStore.setState({ outcome: { global: "unreachable", trending: "answered" } });
    vi.mocked(fetchGlobalFeed).mockImplementation(answering([makeMockNote("new", 2000)]));
    await useFeedStore.getState().loadFeed();
    const s = useFeedStore.getState();
    expect(s.outcome.global).toBe("answered");
    expect(s.notes.map((n) => n.id)).toEqual(["new", "old"]);
  });

  // Notes came back, so relays are reachable, whatever else timed out meanwhile.
  it("is answered when notes came back although another fetch went unanswered", async () => {
    vi.mocked(fetchGlobalFeed).mockImplementation(async () => { recordFetchOutcome(false); return [makeMockNote("new", 2000)]; });
    await useFeedStore.getState().loadFeed();
    expect(useFeedStore.getState().outcome.global).toBe("answered");
  });

  it("is an error, with the notes kept and loading over, when the load throws", async () => {
    vi.mocked(fetchGlobalFeed).mockRejectedValue(new Error("boom"));
    await useFeedStore.getState().loadFeed();
    const s = useFeedStore.getState();
    expect(s.outcome.global).toBe("error");
    expect(s.notes.map((n) => n.id)).toEqual(["old"]);
    expect(s.loading).toBe(false);
  });

  it("leaves the other tab's outcome alone", async () => {
    useFeedStore.setState({ outcome: { global: "answered", trending: "unreachable" } });
    vi.mocked(fetchGlobalFeed).mockRejectedValue(new Error("boom"));
    await useFeedStore.getState().loadFeed();
    expect(useFeedStore.getState().outcome).toEqual({ global: "error", trending: "unreachable" });
  });
});

// NDK hands an event to every matching subscription the moment it is
// published, before any relay has answered. A note that no relay then took
// appeared under "1 new note", beside "Couldn't publish".
describe("useFeedStore - the live subscription", () => {
  it("takes notes from relays, not from this app's own publishing", () => {
    const subscribe = vi.fn((_filter: unknown, _opts: unknown) => ({ on: vi.fn(), stop: vi.fn() }));
    vi.mocked(getNDK).mockReturnValue({ pool: { relays: new Map() }, subscribe } as never);
    useFeedStore.getState().startLiveFeed();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0][1]).toMatchObject({ skipOptimisticPublishEvent: true, closeOnEose: false });
    vi.mocked(getNDK).mockReturnValue({ pool: { relays: new Map() } } as never);
  });
});
