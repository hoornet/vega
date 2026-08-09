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
import { fetchTrendingCandidates, fetchBatchEngagement } from "../lib/nostr";

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
