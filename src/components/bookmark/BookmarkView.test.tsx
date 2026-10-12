import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

// Three different things used to read "No bookmarked notes." under a header
// that said "12 saved": nothing saved, saved but nobody answered, and saved
// but the relays no longer have them.


vi.mock("../../lib/nostr", () => ({
  fetchNoteById: vi.fn().mockResolvedValue(null),
  fetchByAddr: vi.fn(),
  fetchWithTimeout: vi.fn(),
  getNDK: () => ({}),
  fetchBookmarkList: vi.fn(),
  fetchBookmarkListFull: vi.fn(),
  publishBookmarkListFull: vi.fn(),
}));
vi.mock("../../lib/db", () => ({ dbLoadBookmarkedNotes: vi.fn().mockResolvedValue([]), dbSaveBookmarkedNotes: vi.fn() }));
const account = vi.hoisted(() => ({ pubkey: "me" as string | null }));
vi.mock("../../stores/user", () => ({ useUserStore: () => ({ pubkey: account.pubkey }) }));
vi.mock("../feed/NoteCard", () => ({ NoteCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));
vi.mock("../article/ArticleCard", () => ({ ArticleCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));

import { BookmarkView } from "./BookmarkView";
import { useBookmarkStore } from "../../stores/bookmark";
import { fetchWithTimeout, fetchByAddr } from "../../lib/nostr";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const note = (id: string) => ({ id, content: `note ${id}`, created_at: 1000, kind: 1, pubkey: "pk", tags: [], rawEvent: () => ({ id }) }) as unknown as NDKEvent;
const article = (id: string) => ({ id, content: `article ${id}`, created_at: 1000, kind: 30023, pubkey: "pk", tags: [["d", id]], rawEvent: () => ({ id }) }) as unknown as NDKEvent;
const answering = (events: NDKEvent[]) => async () => { recordFetchOutcome(true); return new Set(events); };
const timingOut = async () => { recordFetchOutcome(false); return new Set<NDKEvent>(); };
const fetchBookmarks = vi.fn();
const NOTHING_SAVED = "No bookmarked notes.";

const saved = (ids: string[], addrs: string[] = []) => useBookmarkStore.setState({ bookmarkedIds: ids, bookmarkedArticleAddrs: addrs });
/** Rendered, and past the first load. */
const shown = async () => {
  render(<BookmarkView />);
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
};

beforeEach(() => {
    vi.mocked(fetchWithTimeout).mockReset();
  vi.mocked(fetchByAddr).mockReset();
  fetchBookmarks.mockReset();
  localStorage.clear();
  account.pubkey = "me";
  useBookmarkStore.setState({ bookmarkedIds: [], bookmarkedArticleAddrs: [], readArticleAddrs: [], listOutcome: "answered", listFor: "me", fetchBookmarks });
});
afterEach(cleanup);

describe("BookmarkView: a list with nothing to show", () => {
  it("says nothing is saved when the relays answered and there is no list", async () => {
    await shown();
    expect(screen.getByText(NOTHING_SAVED)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is loading, not empty, until the list has been asked for", () => {
    useBookmarkStore.setState({ listOutcome: "pending" });
    render(<BookmarkView />);
    expect(screen.getByRole("status", { name: "Loading bookmarks…" })).toBeTruthy();
    expect(screen.queryByText(NOTHING_SAVED)).toBeNull();
    expect(screen.queryByText("0 saved")).toBeNull();
  });

  // Signed out there is no list to ask for: what this device holds is all there is.
  it("says nothing is saved at once when there is no account to ask for", async () => {
    account.pubkey = null;
    useBookmarkStore.setState({ listOutcome: "pending", listFor: null });
    await shown();
    expect(screen.getByText(NOTHING_SAVED)).toBeTruthy();
    expect(fetchBookmarks).not.toHaveBeenCalled();
  });

  it("counts what is saved in the header, and not a zero beside a list that could not be read", async () => {
    await shown();
    expect(screen.getByText("0 saved")).toBeTruthy();
    cleanup();
    useBookmarkStore.setState({ listOutcome: "unreachable" });
    await shown();
    expect(screen.queryByText("0 saved")).toBeNull();
    cleanup();
    // What this device already knows is still counted, whatever the last fetch did.
    saved(["a", "b"]);
    vi.mocked(fetchWithTimeout).mockImplementation(timingOut);
    await shown();
    expect(screen.getByText("2 saved")).toBeTruthy();
  });

  it("says the relays could not be reached when the list itself got no answer", async () => {
    useBookmarkStore.setState({ listOutcome: "unreachable" });
    await shown();
    expect(screen.getByRole("alert").textContent).toContain("so your saved notes can't be loaded");
    expect(screen.queryByText(NOTHING_SAVED)).toBeNull();
    fetchBookmarks.mockClear(); // it was also asked for when the view opened
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchBookmarks).toHaveBeenCalledTimes(1);
    expect(fetchBookmarks).toHaveBeenCalledWith("me");
  });

  it("says the list could not be loaded when reading it failed", async () => {
    useBookmarkStore.setState({ listOutcome: "error" });
    await shown();
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load your saved notes.");
    expect(screen.queryByText(NOTHING_SAVED)).toBeNull();
  });

  it("shows the saved notes the relays have", async () => {
    saved(["a", "b"]);
    vi.mocked(fetchWithTimeout).mockImplementation(answering([note("a"), note("b")]));
    await shown();
    expect(screen.getByText("note a")).toBeTruthy();
    expect(screen.getByText("note b")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the relays could not be reached when notes are saved and nobody answered", async () => {
    saved(["a", "b"]);
    vi.mocked(fetchWithTimeout).mockImplementation(timingOut);
    await shown();
    expect(screen.getByRole("alert").textContent).toContain("so your saved notes can't be loaded");
    expect(screen.queryByText(NOTHING_SAVED)).toBeNull();
    expect(screen.queryByText(/did not have/)).toBeNull();
  });

  it("asks for the notes again on Try again", async () => {
    saved(["a"]);
    vi.mocked(fetchWithTimeout).mockImplementationOnce(timingOut).mockImplementation(answering([note("a")]));
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("note a")).toBeTruthy();
    expect(fetchBookmarks).toHaveBeenCalledTimes(1); // on mount only: the list is known, the notes were not
  });

  // Saved, asked for, and the relays said they do not have them. Not "nothing saved".
  it("says the relays did not have them when notes are saved and the relays answered with none", async () => {
    saved(["a", "b"]);
    vi.mocked(fetchWithTimeout).mockImplementation(answering([]));
    await shown();
    expect(screen.getByText("2 saved, but your relays did not have any of them.")).toBeTruthy();
    expect(screen.queryByText(NOTHING_SAVED)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The last saved note is removed: what was true of it is not true of nothing.
  it("goes back to nothing saved when the last saved note is removed", async () => {
    saved(["a"]);
    vi.mocked(fetchWithTimeout).mockImplementation(answering([]));
    await shown();
    expect(screen.getByText("1 saved, but your relays did not have it.")).toBeTruthy();
    act(() => { saved([]); });
    expect(screen.queryByText(/did not have/)).toBeNull();
    expect(screen.getByText(NOTHING_SAVED)).toBeTruthy();
  });

  it("says it of one note in the singular", async () => {
    saved(["a"]);
    vi.mocked(fetchWithTimeout).mockImplementation(answering([]));
    await shown();
    expect(screen.getByText("1 saved, but your relays did not have it.")).toBeTruthy();
  });

  // Saved by event id, found, and they are articles: the view lists them
  // under Articles. "Your relays did not have any of them" was said of two
  // items the relays had just returned.
  it("does not call saved items missing when the relays returned them and they are articles", async () => {
    saved(["x", "y"]);
    vi.mocked(fetchWithTimeout).mockImplementation(answering([article("x"), article("y")]));
    await shown();
    expect(screen.queryByText(/did not have/)).toBeNull();
    expect(screen.getByText(NOTHING_SAVED)).toBeTruthy();
    expect(screen.getByText("What you saved is under the other tab.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Articles/ }));
    expect(screen.getByText("article x")).toBeTruthy();
    expect(screen.getByText("article y")).toBeTruthy();
  });

  it("treats a load that throws as not loaded, never as missing", async () => {
    saved(["a"]);
    vi.mocked(fetchWithTimeout).mockRejectedValue(new Error("boom"));
    await shown();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/did not have/)).toBeNull();
  });
});

describe("BookmarkView: the articles tab", () => {
  const openArticles = async () => {
    await shown();
    fireEvent.click(screen.getByRole("tab", { name: /Articles/ }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  };

  it("says no article is saved when none is", async () => {
    await openArticles();
    expect(screen.getByText("No bookmarked articles.")).toBeTruthy();
  });

  it("says the relays could not be reached when articles are saved and nobody answered", async () => {
    saved([], ["30023:pk:x"]);
    vi.mocked(fetchByAddr).mockImplementation(async () => { recordFetchOutcome(false); return null; });
    await openArticles();
    expect(screen.getByRole("alert").textContent).toContain("so your saved articles can't be loaded");
    expect(screen.queryByText("No bookmarked articles.")).toBeNull();
  });

  it("says the relays did not have it when they answered with nothing", async () => {
    saved([], ["30023:pk:x"]);
    vi.mocked(fetchByAddr).mockImplementation(async () => { recordFetchOutcome(true); return null; });
    await openArticles();
    expect(screen.getByText("1 saved, but your relays did not have it.")).toBeTruthy();
  });

  it("keeps the articles on screen when a later ask goes unanswered", async () => {
    saved([], ["30023:pk:x"]);
    vi.mocked(fetchByAddr).mockImplementationOnce(async () => { recordFetchOutcome(true); return article("x"); }).mockImplementation(async () => { recordFetchOutcome(false); return null; });
    await openArticles();
    expect(screen.getByText("article x")).toBeTruthy();
    // The list is published again with the same address: the view asks again.
    useBookmarkStore.setState({ bookmarkedArticleAddrs: ["30023:pk:x"] });
    await waitFor(() => expect(vi.mocked(fetchByAddr)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByText("article x")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
