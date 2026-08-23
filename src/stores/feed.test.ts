import { describe, it, expect, vi, beforeEach } from "vitest";
import { NDKEvent } from "@nostr-dev-kit/ndk";

// Mock the nostr module
vi.mock("../lib/nostr", () => ({
  connectToRelays: vi.fn(),
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
import { fetchTrendingCandidates, fetchBatchEngagement, fetchGlobalFeed } from "../lib/nostr";

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
      error: null,
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
