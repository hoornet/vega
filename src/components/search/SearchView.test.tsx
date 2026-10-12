import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("../../lib/nostr", () => ({
  advancedSearch: vi.fn(),
  fetchFollowSuggestions: vi.fn().mockResolvedValue([]),
  fetchProfile: vi.fn().mockResolvedValue(null),
  fetchTrendingHashtags: vi.fn().mockResolvedValue([]),
  fetchNoteById: vi.fn().mockResolvedValue(null),
}));
const user = vi.hoisted(() => ({ loggedIn: false, follows: [] as string[], followsStatus: "loaded" as "idle" | "loading" | "loaded" | "unknown", canSign: true }));
vi.mock("../../stores/user", () => ({ useUserStore: () => user, useCanSign: () => user.canSign }));
vi.mock("../../stores/mute", () => ({ useMuteStore: () => ({ mutedPubkeys: [] as string[], contentMatchesMutedKeyword: () => false }) }));
vi.mock("../../stores/dismissedSuggestions", () => ({ useDismissedSuggestionsStore: () => ({ dismissedPubkeys: [] as string[], dismiss: () => {} }) }));
vi.mock("../feed/NoteCard", () => ({ NoteCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));
vi.mock("../article/ArticleCard", () => ({ ArticleCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));
vi.mock("../shared/FollowButton", () => ({ FollowButton: () => null }));
vi.mock("../shared/PeopleToStartWith", () => ({ PeopleToStartWith: () => <p>people to start with</p> }));

import { SearchView } from "./SearchView";
import { useUIStore } from "../../stores/ui";
import { advancedSearch } from "../../lib/nostr";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const note = (id: string) => ({ id, content: `note ${id}`, created_at: 1000, kind: 1, pubkey: "pk", tags: [] }) as unknown as NDKEvent;
const NOTHING = { notes: [] as NDKEvent[], articles: [] as NDKEvent[], users: [] as NDKEvent[] };
const answering = (found: typeof NOTHING) => async () => { recordFetchOutcome(true); return found; };
const timingOut = async () => { recordFetchOutcome(false); return NOTHING; };
/** The view, opened on a search for "vega", and past it. */
const searched = async () => {
  useUIStore.setState({ pendingSearch: "vega" });
  render(<SearchView />);
  await waitFor(() => expect(vi.mocked(advancedSearch)).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/Searching/)).toBeNull());
};

beforeEach(() => { vi.mocked(advancedSearch).mockReset(); });
afterEach(cleanup);

describe("SearchView: a search that finds nothing", () => {
  it("shows what was found", async () => {
    vi.mocked(advancedSearch).mockImplementation(answering({ ...NOTHING, notes: [note("a")] }));
    await searched();
    expect(await screen.findByText("note a")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says there are no results when a relay answered with none", async () => {
    vi.mocked(advancedSearch).mockImplementation(answering(NOTHING));
    await searched();
    expect((await screen.findByText(/No results for/)).textContent).toBe("No results for vega.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The whole point: this used to read "No results for vega." The relays a
  // text search goes to are not the user's own, so it does not say "your relays".
  it("says no relay answered when none did, and searches again on Try again", async () => {
    vi.mocked(advancedSearch).mockImplementationOnce(timingOut).mockImplementation(answering({ ...NOTHING, notes: [note("a")] }));
    await searched();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No relay answered this search.");
    expect(alert.textContent).not.toContain("your relays");
    expect(screen.queryByText(/No results for/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("note a")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(vi.mocked(advancedSearch)).toHaveBeenCalledTimes(2);
  });

  // There was no catch: a search that threw ended as "No results" and an unhandled rejection.
  it("shows a search that throws as a failure, with its reason", async () => {
    vi.mocked(advancedSearch).mockRejectedValue(new Error("bad filter"));
    await searched();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load search results.");
    expect(alert.textContent).toContain("bad filter");
    expect(screen.queryByText(/No results for/)).toBeNull();
  });

  it("forgets the last search's failure when the next one is answered", async () => {
    vi.mocked(advancedSearch).mockImplementationOnce(timingOut).mockImplementation(answering(NOTHING));
    await searched();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByText(/No results for/)).textContent).toBe("No results for vega.");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// Follows-of-follows needs follows. A new account used to see the "Discover
// people" header with nothing under it.
describe("SearchView: Discover people for an account that follows nobody", () => {
  it("offers the people to start with, and says where they come from", async () => {
    user.loggedIn = true;
    user.follows = [];
    try {
      render(<SearchView />);
      expect(await screen.findByText("people to start with")).toBeTruthy();
      expect(screen.getByText("Posting lately. Follow a few and your Following feed fills up.")).toBeTruthy();
      expect(screen.queryByText("Follow more people to see suggestions here.")).toBeNull();
    } finally { user.loggedIn = false; }
  });

  it("offers nothing to a read-only account, which cannot follow", async () => {
    user.loggedIn = true;
    user.follows = [];
    user.canSign = false;
    try {
      render(<SearchView />);
      expect(screen.queryByText("people to start with")).toBeNull();
      expect(screen.queryByText(/Posting lately/)).toBeNull();
    } finally { user.loggedIn = false; user.canSign = true; }
  });

  it("offers nothing while the follow list has not loaded: an empty list that has not loaded says nothing", async () => {
    user.loggedIn = true;
    user.follows = [];
    user.followsStatus = "unknown";
    try {
      render(<SearchView />);
      expect(screen.getByText("Discover people")).toBeTruthy();
      expect(screen.queryByText("people to start with")).toBeNull();
      expect(screen.queryByText(/Posting lately/)).toBeNull();
    } finally { user.loggedIn = false; user.followsStatus = "loaded"; }
  });
});
