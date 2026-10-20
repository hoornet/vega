import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { NDKEvent, NDKUserProfile } from "@nostr-dev-kit/ndk";

const user = vi.hoisted(() => ({ pubkey: "me", follows: [] as string[] }));
const mute = vi.hoisted(() => ({ mutedPubkeys: [] as string[], contentMatchesMutedKeyword: (_c: string): boolean => false }));
vi.mock("../stores/user", () => ({ useUserStore: <T,>(pick: (s: typeof user) => T) => pick(user) }));
vi.mock("../stores/mute", () => ({ useMuteStore: <T,>(pick: (s: typeof mute) => T) => pick(mute) }));
const wot = vi.hoisted(() => ({ enabled: false as boolean, wotSet: new Set<string>() }));
vi.mock("../stores/wot", () => ({ useWoTStore: <T,>(pick: (s: typeof wot) => T) => pick(wot) }));
const ui = vi.hoisted(() => ({ feedLanguageFilter: null as string | null }));
vi.mock("../stores/ui", () => ({ useUIStore: <T,>(pick: (s: typeof ui) => T) => pick(ui) }));
vi.mock("../lib/nostr", () => ({ fetchProfiles: vi.fn() }));
vi.mock("./useProfile", () => ({ primeProfileCache: vi.fn(), peekCachedProfile: vi.fn(async () => undefined) }));

import { rankStartingPeople, presentable, useStartingPeople } from "./useStartingPeople";
import { useFeedStore } from "../stores/feed";
import { useDismissedSuggestionsStore } from "../stores/dismissedSuggestions";
import { fetchProfiles } from "../lib/nostr";
import { primeProfileCache, peekCachedProfile } from "./useProfile";
import { recordFetchOutcome } from "../lib/nostr/fetchTotals";

const note = (id: string, pubkey: string, tags: string[][] = []) => ({ id, pubkey, content: id, created_at: 1000, kind: 1, tags }) as unknown as NDKEvent;
const whole = (name: string): NDKUserProfile => ({ name, picture: `https://x/${name}.png` });
const profiles = (map: Record<string, NDKUserProfile>) => vi.mocked(fetchProfiles).mockImplementation(async () => { recordFetchOutcome(true); return new Map(Object.entries(map)); });
const loadTrendingFeed = vi.fn();

beforeEach(() => {
  localStorage.clear();
  user.follows = [];
  mute.mutedPubkeys = [];
  mute.contentMatchesMutedKeyword = () => false;
  wot.enabled = false;
  wot.wotSet = new Set();
  ui.feedLanguageFilter = null;
  vi.mocked(peekCachedProfile).mockReset().mockImplementation(async () => undefined);
  useDismissedSuggestionsStore.setState({ dismissedPubkeys: [] });
  useFeedStore.setState({ trendingNotes: [], trendingLoading: false, outcome: { global: "pending", trending: "pending" }, loadTrendingFeed });
  loadTrendingFeed.mockReset();
  vi.mocked(fetchProfiles).mockReset().mockResolvedValue(new Map());
  vi.mocked(primeProfileCache).mockReset();
});

describe("rankStartingPeople", () => {
  it("lists each author once, in the order of the notes, leaving out who is excluded", () => {
    const notes = [note("1", "a"), note("2", "b"), note("3", "a"), note("4", "me"), note("5", "c")];
    expect(rankStartingPeople(notes, new Set(["me"]), [])).toEqual(["a", "b", "c"]);
  });

  it("puts those posting on a picked topic first, whatever the tag's case", () => {
    const notes = [note("1", "a", [["e", "art"]]), note("2", "b", [["t", "Bitcoin"]]), note("3", "c", [["t"]]), note("4", "d", [["t", "art"]])];
    expect(rankStartingPeople(notes, new Set(), ["bitcoin", "art"])).toEqual(["b", "d", "a", "c"]);
  });
});

describe("presentable", () => {
  it("takes a name of any kind with a picture, and nothing less, and not a feed bridge", () => {
    expect(presentable({ name: "ana", picture: "https://x/a.png" })).toBe(true);
    expect(presentable({ name: "ana", picture: "https://x/a.png", nip05: "feed@rss.nostr.twinkle.lol" })).toBe(false);
    expect(presentable({ display_name: "Ana", picture: "https://x/a.png" })).toBe(true);
    expect(presentable({ picture: "https://x/a.png" })).toBe(false);
    expect(presentable({ name: "ana" })).toBe(false);
    expect(presentable({ name: "ana", picture: "" })).toBe(false);
    expect(presentable(undefined)).toBe(false);
  });
});

describe("useStartingPeople", () => {
  it("asks for the trending notes when there are none, and is loading meanwhile", () => {
    const { result } = renderHook(() => useStartingPeople());
    expect(loadTrendingFeed).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ pubkeys: [], status: "loading" });
  });

  it("offers the authors with a name and a picture, and keeps their profiles for the rows", async () => {
    useFeedStore.setState({ trendingNotes: [note("1", "a"), note("2", "b"), note("3", "c")], outcome: { global: "pending", trending: "answered" } });
    profiles({ a: whole("Ana"), b: { name: "no picture" }, c: whole("Cene") });
    const { result } = renderHook(() => useStartingPeople());
    expect(loadTrendingFeed).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.pubkeys).toEqual(["a", "c"]);
    expect(fetchProfiles).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(primeProfileCache).toHaveBeenCalledWith("a", whole("Ana"));
  });

  it("leaves out the account itself, who it follows, mutes or dismissed, and asks for no profile of theirs", async () => {
    useFeedStore.setState({ trendingNotes: [note("1", "me"), note("2", "a"), note("3", "b"), note("4", "c"), note("5", "d")], outcome: { global: "pending", trending: "answered" } });
    profiles({ a: whole("A"), b: whole("B"), c: whole("C"), d: whole("D") });
    user.follows = ["a"];
    mute.mutedPubkeys = ["b"];
    const { result, rerender } = renderHook(() => useStartingPeople());
    await waitFor(() => expect(result.current.pubkeys).toEqual(["c", "d"]));
    expect(fetchProfiles).toHaveBeenCalledWith(["c", "d"]);
    act(() => useDismissedSuggestionsStore.getState().dismiss("c"));
    rerender();
    expect(result.current.pubkeys).toEqual(["d"]);
    mute.mutedPubkeys = ["b", "d"];
    rerender();
    expect(result.current.pubkeys).toEqual([]);
    expect(fetchProfiles).toHaveBeenCalledTimes(1);
  });

  // The row of someone followed from the list stays (PeopleToStartWith); the hook itself keeps offering them.
  it("keeps offering someone followed since the candidates were chosen", async () => {
    useFeedStore.setState({ trendingNotes: [note("1", "a"), note("2", "b")], outcome: { global: "pending", trending: "answered" } });
    profiles({ a: whole("A"), b: whole("B") });
    const { result, rerender } = renderHook(() => useStartingPeople());
    await waitFor(() => expect(result.current.pubkeys).toEqual(["a", "b"]));
    user.follows = ["a"];
    rerender();
    expect(result.current.pubkeys).toEqual(["a", "b"]);
  });

  it("offers only the authors of notes the feed would show", async () => {
    useFeedStore.setState({ trendingNotes: [note("1", "bot"), note("2", "a"), note("3", "spam"), note("4", "out")], outcome: { global: "pending", trending: "answered" } });
    (useFeedStore.getState().trendingNotes[0] as { content: string }).content = '{"relay":"payload"}';
    (useFeedStore.getState().trendingNotes[2] as { content: string }).content = "buy now";
    mute.contentMatchesMutedKeyword = (c) => c.includes("buy");
    wot.enabled = true;
    wot.wotSet = new Set(["a", "bot", "spam"]);
    profiles({ bot: whole("Bot"), a: whole("A"), spam: whole("Spam"), out: whole("Out") });
    const { result } = renderHook(() => useStartingPeople());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.pubkeys).toEqual(["a"]);
  });

  it("keeps to the user's script filter, as the feed does", async () => {
    useFeedStore.setState({ trendingNotes: [note("1", "lat"), note("2", "cyr")], outcome: { global: "pending", trending: "answered" } });
    (useFeedStore.getState().trendingNotes[0] as { content: string }).content = "hello there";
    (useFeedStore.getState().trendingNotes[1] as { content: string }).content = "привет всем";
    ui.feedLanguageFilter = "Cyrillic";
    profiles({ lat: whole("Lat"), cyr: whole("Cyr") });
    const { result } = renderHook(() => useStartingPeople());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.pubkeys).toEqual(["cyr"]);
  });

  it("reads the profiles it already has from the cache, and asks only for the rest", async () => {
    useFeedStore.setState({ trendingNotes: [note("1", "a"), note("2", "b"), note("3", "c")], outcome: { global: "pending", trending: "answered" } });
    vi.mocked(peekCachedProfile).mockImplementation(async (pk) => (pk === "a" ? whole("A") : pk === "b" ? null : undefined));
    profiles({ c: whole("C") });
    const { result } = renderHook(() => useStartingPeople());
    await waitFor(() => expect(result.current.pubkeys).toEqual(["a", "c"]));
    expect(fetchProfiles).toHaveBeenCalledWith(["c"]);
  });

  it("asks once more when nobody answered the profile batch", async () => {
    vi.useFakeTimers();
    try {
      useFeedStore.setState({ trendingNotes: [note("1", "a")], outcome: { global: "pending", trending: "answered" } });
      vi.mocked(fetchProfiles).mockImplementationOnce(async () => { recordFetchOutcome(false); return new Map(); });
      profiles({ a: whole("A") });
      const { result } = renderHook(() => useStartingPeople());
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(result.current.status).toBe("loading");
      expect(fetchProfiles).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
      expect(fetchProfiles).toHaveBeenCalledTimes(2);
      expect(result.current.pubkeys).toEqual(["a"]);
    } finally { vi.useRealTimers(); }
  });

  // Offline, this would otherwise send a 40-author request every four seconds for ever.
  it("asks once more and no more when nobody answers again", async () => {
    vi.useFakeTimers();
    try {
      useFeedStore.setState({ trendingNotes: [note("1", "a")], outcome: { global: "pending", trending: "answered" } });
      vi.mocked(fetchProfiles).mockImplementation(async () => { recordFetchOutcome(false); return new Map(); });
      const { result } = renderHook(() => useStartingPeople());
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      expect(fetchProfiles).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe("none");
    } finally { vi.useRealTimers(); }
  });

  it("says there is nobody when no author has a name and a picture, and when nobody answered", async () => {
    useFeedStore.setState({ trendingNotes: [note("1", "a")], outcome: { global: "pending", trending: "answered" } });
    profiles({ a: { name: "no picture" } });
    const { result } = renderHook(() => useStartingPeople());
    await waitFor(() => expect(result.current.status).toBe("none"));
    useFeedStore.setState({ trendingNotes: [], outcome: { global: "pending", trending: "unreachable" } });
    const second = renderHook(() => useStartingPeople());
    expect(second.result.current.status).toBe("none");
    // Asked again, after "unreachable": looking, not nobody.
    useFeedStore.setState({ trendingLoading: true });
    second.rerender();
    expect(second.result.current.status).toBe("loading");
  });

  it("asks for a limited number of profiles, picked topics first", async () => {
    localStorage.setItem("wrystr_interests_me", JSON.stringify(["art"]));
    const notes = Array.from({ length: 45 }, (_, i) => note(`n${i}`, `p${i}`, i === 44 ? [["t", "art"]] : []));
    useFeedStore.setState({ trendingNotes: notes, outcome: { global: "pending", trending: "answered" } });
    profiles({});
    renderHook(() => useStartingPeople());
    await waitFor(() => expect(fetchProfiles).toHaveBeenCalled());
    const asked = vi.mocked(fetchProfiles).mock.calls[0][0];
    expect(asked.length).toBe(40);
    expect(asked[0]).toBe("p44");
  });

  it("keeps to the limit", async () => {
    useFeedStore.setState({ trendingNotes: ["a", "b", "c"].map((p) => note(p, p)), outcome: { global: "pending", trending: "answered" } });
    profiles({ a: whole("A"), b: whole("B"), c: whole("C") });
    const { result } = renderHook(() => useStartingPeople(2));
    await waitFor(() => expect(result.current.pubkeys).toEqual(["a", "b"]));
  });
});
