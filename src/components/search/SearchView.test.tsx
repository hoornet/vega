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
vi.mock("../../stores/user", () => ({ useUserStore: () => ({ loggedIn: false, follows: [] as string[] }) }));
vi.mock("../../stores/mute", () => ({ useMuteStore: () => ({ mutedPubkeys: [] as string[], contentMatchesMutedKeyword: () => false }) }));
vi.mock("../../stores/dismissedSuggestions", () => ({ useDismissedSuggestionsStore: () => ({ dismissedPubkeys: [] as string[], dismiss: () => {} }) }));
vi.mock("../feed/NoteCard", () => ({ NoteCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));
vi.mock("../article/ArticleCard", () => ({ ArticleCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));
vi.mock("../shared/FollowButton", () => ({ FollowButton: () => null }));

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
