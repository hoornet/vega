import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

// The feed with nothing to show, and the feed after a refresh nobody answered.
// Both used to end as "No notes to show." or a blank list.

// Before the stores are imported: the feed opens on the tab stored here, and
// the first-paint test below can only see the stores' initial state.
vi.hoisted(() => { localStorage.setItem("wrystr_feed_tab", "following"); });
const user = vi.hoisted(() => ({ loggedIn: true, pubkey: "me", follows: ["friend"] as string[], followsStatus: "loaded" as "idle" | "loading" | "loaded" | "unknown", fetchFollows: (() => {}) as () => void }));
const mute = vi.hoisted(() => ({ mutedPubkeys: [] as string[], contentMatchesMutedKeyword: () => false }));

vi.mock("../../lib/nostr", () => ({
  fetchFollowFeed: vi.fn(),
  ensureConnected: vi.fn().mockResolvedValue(true),
  getNDK: () => ({ signer: {}, pool: { relays: new Map() } }),
}));
vi.mock("../../lib/db", () => ({ dbLoadFeed: vi.fn().mockResolvedValue([]), dbSaveNotes: vi.fn() }));
vi.mock("../../lib/feedDiagnostics", () => ({
  diagWrapFetch: (_action: string, fetch: () => Promise<unknown>) => fetch(),
  logDiag: vi.fn(), startRelaySnapshots: vi.fn(), startDiagFileFlusher: vi.fn(), getRelayStates: () => [],
}));
vi.mock("../../stores/user", () => ({ useUserStore: <T,>(pick: (s: typeof user) => T) => pick(user) }));
vi.mock("../../stores/mute", () => ({ useMuteStore: <T,>(pick: (s: typeof mute) => T) => pick(mute) }));
vi.mock("../../stores/wot", () => {
  const wot = { enabled: false, wotSet: new Set<string>(), loading: false, buildWoT: () => {} };
  return { useWoTStore: Object.assign(<T,>(pick: (s: typeof wot) => T) => pick(wot), { getState: () => wot }) };
});
// No layout in jsdom: show every row.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 100, key: index })),
    getTotalSize: () => count * 100,
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));
vi.mock("./NoteCard", () => ({ NoteCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));
vi.mock("../article/ArticleCard", () => ({ ArticleCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));
const compose = vi.hoisted(() => ({ confirmPosted: undefined as undefined | boolean | ((event: unknown) => boolean) }));
vi.mock("./ComposeBox", () => ({ ComposeBox: (props: { confirmPosted?: boolean | ((event: unknown) => boolean) }) => { compose.confirmPosted = props.confirmPosted; return null; } }));
vi.mock("./RelayStatusBadge", () => ({ RelayStatusBadge: () => null }));

import { Feed } from "./Feed";
import { useFeedStore } from "../../stores/feed";
import { useUIStore } from "../../stores/ui";
import { fetchFollowFeed } from "../../lib/nostr";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const note = (id: string, pubkey = "friend") => ({ id, content: `note ${id}`, created_at: 1000, kind: 1, pubkey, tags: [] }) as unknown as NDKEvent;
const answering = (events: NDKEvent[]) => async () => { recordFetchOutcome(true); return events; };
const timingOut = async () => { recordFetchOutcome(false); return [] as NDKEvent[]; };
const loadFeed = vi.fn(async () => {});
const loadTrendingFeed = vi.fn(async () => {});
const fetchFollows = vi.fn();
const EMPTY = "No notes to show.";
const STALE_UNREACHABLE = "Couldn't reach your relays, so this may be out of date.";
const STALE = /so this may be out of date/;

/** Rendered on `tab`, and past its first load. */
const shownAndKept = async (tab: "following" | "global" | "trending") => {
  // A stored choice: an account that follows nobody is otherwise sent to Trending.
  localStorage.setItem("wrystr_feed_tab", tab);
  useUIStore.setState({ feedTab: tab });
  const view = render(<Feed />);
  await settled();
  return view;
};
const shown = async (tab: "following" | "global" | "trending") => { await shownAndKept(tab); };
/** The tab's load is over. Not "no status on the page": the line about old notes is one. */
const settled = () => waitFor(() => {
  expect(screen.getByRole("button", { name: "Refresh" }).getAttribute("aria-busy")).not.toBe("true");
  expect(screen.queryByText(/^Loading/)).toBeNull();
});
const refresh = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await settled();
};

beforeEach(() => {
    Object.assign(user, { loggedIn: true, pubkey: "me", follows: ["friend"], followsStatus: "loaded", fetchFollows });
  mute.mutedPubkeys = [];
  vi.mocked(fetchFollowFeed).mockReset();
  loadFeed.mockClear(); loadTrendingFeed.mockClear(); fetchFollows.mockClear();
  localStorage.clear();
  useFeedStore.setState({
    notes: [], pendingNotes: [], trendingNotes: [], loading: false, trendingLoading: false, loadingOlder: false,
    outcome: { global: "answered", trending: "answered" }, lastUpdated: {}, focusedNoteIndex: -1,
    connect: async () => {}, loadCachedFeed: async () => {}, loadFeed, loadTrendingFeed, loadOlderNotes: async () => {},
  });
});
afterEach(cleanup);

describe("Feed: the Following tab", () => {
  it("shows the notes from the people you follow", async () => {
    vi.mocked(fetchFollowFeed).mockImplementation(answering([note("a"), note("b")]));
    await shown("following");
    expect(screen.getByText("note a")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(STALE)).toBeNull();
  });

  it("says there are none when a relay answered with none", async () => {
    vi.mocked(fetchFollowFeed).mockImplementation(answering([]));
    await shown("following");
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The whole point: this used to read "No notes to show."
  it("says the relays could not be reached when nobody answered, and asks again on Try again", async () => {
    vi.mocked(fetchFollowFeed).mockImplementationOnce(timingOut).mockImplementation(answering([note("a")]));
    await shown("following");
    expect(screen.getByRole("alert").textContent).toContain("so notes from the people you follow can't be loaded");
    expect(screen.queryByText(EMPTY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("note a")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the load failed when it throws, and never that there are none", async () => {
    vi.mocked(fetchFollowFeed).mockRejectedValue(new Error("boom"));
    await shown("following");
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load notes from the people you follow.");
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  // An empty result used to replace the notes: a feed that had loaded went blank.
  it("keeps the notes and says so when a refresh goes unanswered", async () => {
    vi.mocked(fetchFollowFeed).mockImplementationOnce(answering([note("a")])).mockImplementation(timingOut);
    await shown("following");
    await refresh();
    expect(screen.getByText("note a")).toBeTruthy();
    expect(screen.getByText(STALE_UNREACHABLE)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the notes and says so when a refresh fails", async () => {
    vi.mocked(fetchFollowFeed).mockImplementationOnce(answering([note("a")])).mockRejectedValue(new Error("boom"));
    await shown("following");
    await refresh();
    expect(screen.getByText("note a")).toBeTruthy();
    expect(screen.getByText("Couldn't refresh, so this may be out of date.")).toBeTruthy();
  });

  // While it is asking again it does not yet know that it failed again.
  it("takes the line away while the next refresh is under way", async () => {
    vi.mocked(fetchFollowFeed)
      .mockImplementationOnce(answering([note("a")]))
      .mockImplementationOnce(timingOut)
      .mockImplementation(() => new Promise<NDKEvent[]>(() => { /* never */ }));
    await shown("following");
    await refresh();
    expect(screen.getByText(STALE_UNREACHABLE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" }).getAttribute("aria-busy")).toBe("true"));
    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.getByText("note a")).toBeTruthy();
  });

  // Following someone starts a new load. If nobody answers it, the notes
  // already on screen are still this account's and stay.
  it("keeps the notes when the follow list changes and the new load goes unanswered", async () => {
    vi.mocked(fetchFollowFeed).mockImplementationOnce(answering([note("a")])).mockImplementation(timingOut);
    const view = await shownAndKept("following");
    user.follows = ["friend", "second-friend"];
    view.rerender(<Feed />);
    await settled();
    expect(vi.mocked(fetchFollowFeed)).toHaveBeenCalledTimes(2);
    expect(screen.getByText("note a")).toBeTruthy();
    expect(screen.getByText(STALE_UNREACHABLE)).toBeTruthy();
  });

  it("drops the line about old notes once a refresh is answered", async () => {
    vi.mocked(fetchFollowFeed).mockImplementationOnce(answering([note("a")])).mockImplementationOnce(timingOut).mockImplementation(answering([note("b")]));
    await shown("following");
    await refresh();
    expect(screen.getByText(STALE_UNREACHABLE)).toBeTruthy();
    await refresh();
    expect(screen.getByText("note b")).toBeTruthy();
    expect(screen.queryByText(STALE)).toBeNull();
  });

  it("empties the tab when a refresh is answered with nothing", async () => {
    vi.mocked(fetchFollowFeed).mockImplementationOnce(answering([note("a")])).mockImplementation(answering([]));
    await shown("following");
    await refresh();
    expect(screen.queryByText("note a")).toBeNull();
    expect(screen.getByText(EMPTY)).toBeTruthy();
  });

  // Every note it holds is from someone muted: the list is empty for this
  // user, and says so. The refresh that then went unanswered is still
  // reported, in the line above: with no rows and no line, nothing said it.
  it("is empty, with the failed refresh still reported, when every note it holds is filtered out", async () => {
    vi.mocked(fetchFollowFeed).mockImplementationOnce(answering([note("a")])).mockImplementation(timingOut);
    mute.mutedPubkeys = ["friend"];
    await shown("following");
    expect(screen.queryByText(STALE)).toBeNull();
    await refresh();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(STALE_UNREACHABLE)).toBeTruthy();
  });

  // The feed is never unmounted. A load nobody answers keeps what is on
  // screen, which after a switch would be the other account's notes.
  it("does not keep one account's notes for the next", async () => {
    vi.mocked(fetchFollowFeed).mockImplementationOnce(answering([note("a")])).mockImplementation(timingOut);
    const view = await shownAndKept("following");
    expect(screen.getByText("note a")).toBeTruthy();
    Object.assign(user, { pubkey: "someone-else", follows: ["other-friend"] });
    view.rerender(<Feed />);
    await settled();
    expect(screen.queryByText("note a")).toBeNull();
    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("so notes from the people you follow can't be loaded");
  });

  // The follow list changes while a load is in flight, and each change starts
  // another. Only the newest may land.
  it("ignores a load that finishes after a newer one was started", async () => {
    let finishFirst: (events: NDKEvent[]) => void = () => {};
    vi.mocked(fetchFollowFeed)
      .mockImplementationOnce(() => new Promise<NDKEvent[]>((resolve) => { finishFirst = resolve; }))
      .mockImplementation(answering([note("new")]));
    localStorage.setItem("wrystr_feed_tab", "following");
    useUIStore.setState({ feedTab: "following" });
    const view = render(<Feed />);
    await waitFor(() => expect(vi.mocked(fetchFollowFeed)).toHaveBeenCalledTimes(1));
    user.follows = ["friend", "second-friend"];
    view.rerender(<Feed />);
    expect(await screen.findByText("note new")).toBeTruthy();
    recordFetchOutcome(true);
    finishFirst([note("stale")]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("note stale")).toBeNull();
    expect(screen.getByText("note new")).toBeTruthy();
  });

  // The very first paint, before any effect has started a load. Rendered to a
  // string because that is the one way to see it: `render` runs the effects
  // before it returns. A string render reads each store's initial state, not
  // what a test has set since, which is why the stored tab is set at the top
  // of this file, and why this checks that it is Following it is looking at.
  it("paints as loading, not empty, before its first load has even begun", () => {
    expect(useUIStore.getInitialState().feedTab).toBe("following");
    const firstPaint = renderToString(<Feed />);
    expect(firstPaint).toMatch(/aria-selected="true"[^>]*>Following</);
    expect(firstPaint).toContain("Loading notes…");
    expect(firstPaint).not.toContain(EMPTY);
    expect(vi.mocked(fetchFollowFeed)).not.toHaveBeenCalled(); // no effect ran: this was the first paint
  });

  it("is loading, not empty, until it has been asked", async () => {
    vi.mocked(fetchFollowFeed).mockImplementation(() => new Promise<NDKEvent[]>(() => { /* never */ }));
    localStorage.setItem("wrystr_feed_tab", "following");
    useUIStore.setState({ feedTab: "following" });
    render(<Feed />);
    await waitFor(() => expect(vi.mocked(fetchFollowFeed)).toHaveBeenCalled());
    expect(screen.getByRole("status", { name: "Loading notes…" })).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });
});

describe("Feed: the Following tab without a follow list", () => {
  beforeEach(() => { user.follows = []; });

  it("says the account follows nobody only when the list loaded", async () => {
    user.followsStatus = "loaded";
    await shown("following");
    expect(screen.getByText("You're not following anyone yet.")).toBeTruthy();
    expect(vi.mocked(fetchFollowFeed)).not.toHaveBeenCalled();
  });

  it("offers the stored interests under it", async () => {
    user.followsStatus = "loaded";
    localStorage.setItem("wrystr_interests", JSON.stringify(["bitcoin", "nostr"]));
    await shown("following");
    expect(screen.getByRole("button", { name: "#bitcoin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "#nostr" })).toBeTruthy();
  });

  it("survives a stored interests value that is not a list", async () => {
    user.followsStatus = "loaded";
    localStorage.setItem("wrystr_interests", "{not json");
    await shown("following");
    expect(screen.getByText("You're not following anyone yet.")).toBeTruthy();
  });

  it("says the relays could not be reached when the list is unknown, and asks for it again", async () => {
    user.followsStatus = "unknown";
    await shown("following");
    expect(screen.getByRole("alert").textContent).toContain("so the list of people you follow can't be loaded");
    expect(screen.queryByText("You're not following anyone yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchFollows).toHaveBeenCalledTimes(1);
  });

  it("says it is loading the list while it is", () => {
    user.followsStatus = "loading";
    localStorage.setItem("wrystr_feed_tab", "following");
    useUIStore.setState({ feedTab: "following" });
    render(<Feed />);
    expect(screen.getByRole("status").textContent).toBe("Loading the people you follow…");
    expect(screen.queryByText("You're not following anyone yet.")).toBeNull();
  });
});

describe("Feed: Global and Trending", () => {
  it("Global says the relays could not be reached, with nothing on screen", async () => {
    useFeedStore.setState({ outcome: { global: "unreachable", trending: "answered" } });
    await shown("global");
    expect(screen.getByRole("alert").textContent).toContain("so the feed can't be loaded");
    expect(screen.queryByText(EMPTY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(loadFeed).toHaveBeenCalledTimes(2); // once on mount, once now
  });

  it("Global keeps its notes and says so when the refresh went unanswered", async () => {
    useFeedStore.setState({ notes: [note("g", "stranger")], outcome: { global: "unreachable", trending: "answered" } });
    await shown("global");
    expect(screen.getByText("note g")).toBeTruthy();
    expect(screen.getByText(STALE_UNREACHABLE)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Global says there is nothing when a relay answered with nothing", async () => {
    await shown("global");
    expect(screen.getByText(EMPTY)).toBeTruthy();
  });

  // The first load only starts once the relays are connected, which can take
  // many seconds with the network gone. Until then nothing has been asked.
  for (const tab of ["global", "trending"] as const) {
    it(`${tab} is loading, not empty, until it has been asked`, async () => {
      useFeedStore.setState({ outcome: { global: "pending", trending: "pending" } });
      localStorage.setItem("wrystr_feed_tab", tab);
      useUIStore.setState({ feedTab: tab });
      render(<Feed />);
      expect(screen.getByRole("status", { name: "Loading notes…" })).toBeTruthy();
      expect(screen.queryByText(EMPTY)).toBeNull();
      expect(screen.queryByText("No trending notes right now.")).toBeNull();
    });
  }

  it("says nothing about being out of date for notes from the cache, before anything was asked", async () => {
    useFeedStore.setState({ notes: [note("g", "stranger")], outcome: { global: "pending", trending: "pending" } });
    localStorage.setItem("wrystr_feed_tab", "global");
    useUIStore.setState({ feedTab: "global" });
    render(<Feed />);
    expect(screen.getByText("note g")).toBeTruthy();
    expect(screen.queryByText(STALE)).toBeNull();
  });

  it("Global shows a skeleton while it loads, not a sentence", async () => {
    useFeedStore.setState({ loading: true });
    localStorage.setItem("wrystr_feed_tab", "global");
    useUIStore.setState({ feedTab: "global" });
    render(<Feed />);
    expect(screen.getByRole("status", { name: "Loading notes…" })).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("Trending says the relays could not be reached, and refreshes on Try again", async () => {
    useFeedStore.setState({ outcome: { global: "answered", trending: "unreachable" } });
    await shown("trending");
    expect(screen.getByRole("alert").textContent).toContain("so trending notes can't be loaded");
    expect(screen.queryByText("No trending notes right now.")).toBeNull();
    loadTrendingFeed.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(loadTrendingFeed).toHaveBeenCalledWith(true);
  });

  it("Trending says there is nothing trending when a relay answered with nothing", async () => {
    await shown("trending");
    expect(screen.getByText("No trending notes right now.")).toBeTruthy();
  });

  // One tab's failure is not the other's.
  it("a tab's outcome is its own", async () => {
    useFeedStore.setState({ notes: [note("g", "stranger")], outcome: { global: "answered", trending: "error" } });
    await shown("global");
    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Feed: whether a note just posted needs saying", () => {
  /** What the feed tells the compose box about a note posted on this tab. */
  const needsSaying = (event: NDKEvent) => (typeof compose.confirmPosted === "function" ? compose.confirmPosted(event) : compose.confirmPosted);
  const mine = (content: string) => ({ ...note("mine", "me"), content }) as unknown as NDKEvent;

  beforeEach(() => { vi.mocked(fetchFollowFeed).mockImplementation(answering([])); });

  // Trending is ranked, not newest first: the box emptied and nothing else changed.
  it("does on Trending, whatever the note", async () => {
    await shown("trending");
    expect(needsSaying(mine("hello nostr"))).toBe(true);
  });

  // It goes to the top of the list: that is the confirmation.
  it("does not on Following or Global for a note the tab will show", async () => {
    await shown("following");
    expect(needsSaying(mine("hello nostr"))).toBe(false);
    cleanup();
    await shown("global");
    expect(needsSaying(mine("hello nostr"))).toBe(false);
  });

  // The feed drops anything that starts with "[" or "{". "[Thread] why relays
  // matter" was posted, the box emptied, and nothing appeared.
  it("does when the tab's own filters would hide the note", async () => {
    await shown("following");
    expect(needsSaying(mine("[Thread] why relays matter"))).toBe(true);
    cleanup();
    await shown("global");
    expect(needsSaying(mine("{not json, just a brace"))).toBe(true);
  });

  it("does when the note is by someone the tab mutes", async () => {
    mute.mutedPubkeys = ["me"];
    await shown("global");
    expect(needsSaying(mine("hello nostr"))).toBe(true);
  });
});

