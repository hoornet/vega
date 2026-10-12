import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

// Two tabs share this view. Since a load nobody answers keeps the rows it
// finds, the rows must be the tab's own: Latest's articles were once kept
// "from before" under Following, where the laxer filter also showed the
// profile-less spam that Latest hides.

const user = vi.hoisted(() => ({ loggedIn: true, follows: ["writer"] as string[], followsStatus: "loaded" as "idle" | "loading" | "loaded" | "unknown", fetchFollows: (() => {}) as () => void }));

vi.mock("../../lib/nostr", () => ({
  fetchArticleFeed: vi.fn(),
  fetchProfiles: vi.fn(),
  getNDK: () => ({}),
}));
vi.mock("../../lib/db", () => ({ dbLoadArticles: vi.fn().mockResolvedValue([]), dbSaveNotes: vi.fn() }));
vi.mock("../../hooks/useProfile", () => ({ peekCachedProfile: async () => undefined, primeProfileCache: () => {} }));
vi.mock("../../stores/user", () => ({ useUserStore: () => user, useCanSign: () => false }));
vi.mock("../../stores/mute", () => {
  const mute = { mutedPubkeys: [] as string[], contentMatchesMutedKeyword: () => false };
  return { useMuteStore: <T,>(pick: (s: typeof mute) => T) => pick(mute) };
});
vi.mock("../../stores/wot", () => {
  const wot = { enabled: false, wotSet: new Set<string>() };
  return { useWoTStore: <T,>(pick: (s: typeof wot) => T) => pick(wot) };
});
// Every article row, in every render pass, with the tab that pass was for.
// The tab list renders before the rows, so `shown.tab` is already this pass's.
const shown = vi.hoisted(() => ({ tab: "", log: [] as { tab: string; row: string }[] }));
vi.mock("../shared/Tabs", async (original) => {
  const real = await original<typeof import("../shared/Tabs")>();
  const Tabs = <T extends string>(props: Parameters<typeof real.Tabs<T>>[0]) => { shown.tab = props.value; return <real.Tabs {...props} />; };
  return { ...real, Tabs };
});
vi.mock("./ArticleCard", () => ({ ArticleCard: ({ event }: { event: NDKEvent }) => { shown.log.push({ tab: shown.tab, row: event.content }); return <article>{event.content}</article>; } }));

import { ArticleFeed } from "./ArticleFeed";
import { fetchArticleFeed, fetchProfiles } from "../../lib/nostr";
import { dbLoadArticles } from "../../lib/db";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const article = (id: string, pubkey: string) => ({ id, content: `article ${id}`, created_at: 1000, kind: 30023, pubkey, tags: [["d", id], ["title", id]], rawEvent: () => ({ id }) }) as unknown as NDKEvent;
/** What the relays hold: Latest is everyone's, Following only the writer's. */
const LATEST = [article("good", "writer"), article("spam", "nobody")];
const FOLLOWING = [article("good", "writer")];
type Answer = "rows" | "nothing" | "silent" | "throws";
const relays = { latest: "rows" as Answer, following: "rows" as Answer };
const fetchFollows = vi.fn();
const settled = () => waitFor(() => expect(screen.queryByRole("status")).toBeNull());
const openFollowing = async () => { fireEvent.click(screen.getByRole("tab", { name: "Following" })); await settled(); };
const rows = () => screen.queryAllByRole("article").map((e) => e.textContent);

beforeEach(() => {
  Object.assign(user, { loggedIn: true, follows: ["writer"], followsStatus: "loaded", fetchFollows });
  relays.latest = "rows"; relays.following = "rows";
  fetchFollows.mockClear();
  shown.tab = ""; shown.log.length = 0;
  vi.mocked(fetchArticleFeed).mockReset().mockImplementation(async (_limit?: number, authors?: string[]) => {
    const how = authors ? relays.following : relays.latest;
    if (how === "throws") throw new Error("boom");
    if (how === "silent") { recordFetchOutcome(false); return []; }
    recordFetchOutcome(true);
    return how === "nothing" ? [] : authors ? FOLLOWING : LATEST;
  });
  // The writer has a profile. The spam key has none, which is what Latest hides it for.
  vi.mocked(fetchProfiles).mockReset().mockImplementation(async (pubkeys: string[]) => new Map(pubkeys.filter((pk) => pk === "writer").map((pk) => [pk, { name: "Writer" }])));
});
afterEach(cleanup);

describe("ArticleFeed: Latest", () => {
  it("shows the articles whose author has a profile", async () => {
    render(<ArticleFeed />);
    await settled();
    expect(rows()).toEqual(["article good"]);
  });

  it("says there are none when a relay answered with none", async () => {
    relays.latest = "nothing";
    render(<ArticleFeed />);
    await settled();
    expect(screen.getByText("No articles found on your relays.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The whole point: this used to read "No articles found on your relays."
  it("says the relays could not be reached when nobody answered, and asks again on Try again", async () => {
    relays.latest = "silent";
    render(<ArticleFeed />);
    await settled();
    expect(screen.getByRole("alert").textContent).toContain("so articles can't be loaded");
    expect(screen.queryByText(/No articles/)).toBeNull();
    relays.latest = "rows";
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settled();
    expect(rows()).toEqual(["article good"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the load failed when it throws", async () => {
    relays.latest = "throws";
    render(<ArticleFeed />);
    await settled();
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load articles.");
  });

  it("says the filters left nothing when articles came and none passed them", async () => {
    vi.mocked(fetchProfiles).mockResolvedValue(new Map());
    render(<ArticleFeed />);
    await settled();
    expect(screen.getByText("Nothing left after your filters.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ArticleFeed: Following never shows Latest's rows", () => {
  it("shows what the people you follow wrote", async () => {
    render(<ArticleFeed />);
    await settled();
    await openFollowing();
    expect(rows()).toEqual(["article good"]);
    expect(vi.mocked(fetchArticleFeed)).toHaveBeenLastCalledWith(40, ["writer"]);
  });

  it("says the relays could not be reached, with no rows, when its fetch goes unanswered", async () => {
    render(<ArticleFeed />);
    await settled();
    expect(rows()).toEqual(["article good"]);
    relays.following = "silent";
    await openFollowing();
    expect(rows()).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("so articles can't be loaded");
  });

  it("shows no rows when its fetch throws", async () => {
    render(<ArticleFeed />);
    await settled();
    relays.following = "throws";
    await openFollowing();
    expect(rows()).toEqual([]);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("says nobody you follow has written when a relay answered with none", async () => {
    render(<ArticleFeed />);
    await settled();
    relays.following = "nothing";
    await openFollowing();
    expect(rows()).toEqual([]);
    expect(screen.getByText("No articles from people you follow yet.")).toBeTruthy();
  });

  it("is loading, with no rows, straight after the tab is clicked", async () => {
    render(<ArticleFeed />);
    await settled();
    relays.following = "silent";
    fireEvent.click(screen.getByRole("tab", { name: "Following" }));
    expect(rows()).toEqual([]);
    expect(screen.getByRole("status").textContent).toBe("Loading articles…");
    await settled();
  });

  // Not just once things settle: in no render pass at all. The rows are
  // cleared by the load that the tab switch starts, and that happens after
  // the first render for the new tab. Read from the list as it stood, that
  // render put Latest's rows under Following, under Following's laxer filter.
  it("never renders a Latest row in a pass for Following, nor the other way round", async () => {
    render(<ArticleFeed />);
    await settled();
    expect(shown.log.filter((r) => r.tab === "latest").map((r) => r.row)).toContain("article good");
    relays.following = "silent";
    shown.log.length = 0;
    await openFollowing();
    expect(shown.log.filter((r) => r.tab === "following")).toEqual([]);
    // And back: Following loads its one article, then Latest goes unanswered.
    relays.following = "rows";
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settled();
    expect(rows()).toEqual(["article good"]);
    relays.latest = "silent";
    shown.log.length = 0;
    fireEvent.click(screen.getByRole("tab", { name: "Latest" }));
    await settled();
    expect(shown.log.filter((r) => r.tab === "latest")).toEqual([]);
  });

  for (const [status, sentence] of [["loaded", "You're not following anyone yet."], ["unknown", "the list of people you follow can't be loaded"]] as const) {
    it(`shows no rows under the follow list's own state (${status})`, async () => {
      user.follows = [];
      user.followsStatus = status;
      render(<ArticleFeed />);
      await settled();
      expect(rows()).toEqual(["article good"]);
      fireEvent.click(screen.getByRole("tab", { name: "Following" }));
      expect(rows()).toEqual([]);
      expect(screen.getByRole("tabpanel").textContent).toContain(sentence);
      expect(vi.mocked(fetchArticleFeed)).toHaveBeenCalledTimes(1);
    });
  }

  it("asks for the follow list again from its own Try again", async () => {
    user.follows = [];
    user.followsStatus = "unknown";
    render(<ArticleFeed />);
    await settled();
    fireEvent.click(screen.getByRole("tab", { name: "Following" }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchFollows).toHaveBeenCalledTimes(1);
  });
});

describe("ArticleFeed: Latest never shows Following's rows", () => {
  // Following's rows held under Latest read "Nothing left after your filters".
  it("says the relays could not be reached when Latest goes unanswered after Following loaded", async () => {
    relays.latest = "silent";
    render(<ArticleFeed />);
    await settled();
    await openFollowing();
    expect(rows()).toEqual(["article good"]);
    fireEvent.click(screen.getByRole("tab", { name: "Latest" }));
    await settled();
    expect(rows()).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("so articles can't be loaded");
    expect(screen.queryByText("Nothing left after your filters.")).toBeNull();
  });
});

describe("ArticleFeed: what a load nobody answers keeps", () => {
  // The local cache puts Latest on screen at once. An empty result from the
  // relays used to replace it, and the list went blank.
  it("keeps the rows the cache put on screen", async () => {
    vi.mocked(dbLoadArticles).mockResolvedValueOnce([JSON.stringify({ id: "c".repeat(64), pubkey: "writer", kind: 30023, created_at: 900, content: "article cached", tags: [["d", "cached"]], sig: "" })]);
    relays.latest = "silent";
    render(<ArticleFeed />);
    await settled();
    await waitFor(() => expect(rows()).toEqual(["article cached"]));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/No articles/)).toBeNull();
  });

  // Rows for one follow list are not rows for another.
  it("does not keep Following's rows for a different follow list", async () => {
    render(<ArticleFeed />);
    await settled();
    await openFollowing();
    expect(rows()).toEqual(["article good"]);
    relays.following = "silent";
    user.follows = ["writer", "another"];
    fireEvent.click(screen.getByRole("tab", { name: "Latest" }));
    await settled();
    await openFollowing();
    expect(rows()).toEqual([]);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
