import { describe, it, expect, vi, beforeEach } from "vitest";


vi.mock("../lib/nostr", () => ({
  fetchBookmarkList: vi.fn(),
  fetchBookmarkListFull: vi.fn(),
  publishBookmarkListFull: vi.fn(),
}));

import { useBookmarkStore } from "./bookmark";
import { fetchBookmarkList, fetchBookmarkListFull } from "../lib/nostr";
import { recordFetchOutcome } from "../lib/nostr/fetchTotals";

const NOTHING = { eventIds: [] as string[], articleAddrs: [] as string[] };
const answering = <T,>(value: T) => async () => { recordFetchOutcome(true); return value; };
const timingOut = <T,>(value: T) => async () => { recordFetchOutcome(false); return value; };

beforeEach(() => {
    vi.mocked(fetchBookmarkList).mockReset();
  vi.mocked(fetchBookmarkListFull).mockReset();
  localStorage.clear();
  useBookmarkStore.setState({ bookmarkedIds: [], bookmarkedArticleAddrs: [], listOutcome: "pending", listFor: null });
});

describe("fetchBookmarks: how the load ended", () => {
  // "No bookmarked notes." used to be the answer to a fetch nobody answered.
  it("is unreachable when no list came back and nobody answered", async () => {
    vi.mocked(fetchBookmarkListFull).mockImplementation(timingOut(NOTHING));
    await useBookmarkStore.getState().fetchBookmarks("me");
    expect(useBookmarkStore.getState().listOutcome).toBe("unreachable");
  });

  it("is answered when a relay answered and there is no list", async () => {
    vi.mocked(fetchBookmarkListFull).mockImplementation(answering(NOTHING));
    await useBookmarkStore.getState().fetchBookmarks("me");
    expect(useBookmarkStore.getState().listOutcome).toBe("answered");
  });

  it("is answered when a list came back, notes or articles", async () => {
    useBookmarkStore.setState({ listOutcome: "unreachable" });
    vi.mocked(fetchBookmarkListFull).mockImplementation(answering({ eventIds: [], articleAddrs: ["30023:pk:d"] }));
    await useBookmarkStore.getState().fetchBookmarks("me");
    const s = useBookmarkStore.getState();
    expect(s.listOutcome).toBe("answered");
    expect(s.bookmarkedArticleAddrs).toEqual(["30023:pk:d"]);
  });

  // "unreachable" is for no list coming back. A list of articles only is a list.
  for (const [what, list] of [["notes", { eventIds: ["a"], articleAddrs: [] }], ["articles", { eventIds: [], articleAddrs: ["30023:pk:d"] }]] as const) {
    it(`is answered when a list with only ${what} came back, whatever the network did`, async () => {
      vi.mocked(fetchBookmarkListFull).mockImplementation(timingOut({ eventIds: [...list.eventIds], articleAddrs: [...list.articleAddrs] }));
      await useBookmarkStore.getState().fetchBookmarks("me");
      expect(useBookmarkStore.getState().listOutcome).toBe("answered");
    });
  }

  it("keeps the bookmarks this device already knows when nobody answered", async () => {
    useBookmarkStore.setState({ bookmarkedIds: ["local-1"] });
    vi.mocked(fetchBookmarkListFull).mockImplementation(timingOut(NOTHING));
    await useBookmarkStore.getState().fetchBookmarks("me");
    const s = useBookmarkStore.getState();
    expect(s.listOutcome).toBe("unreachable");
    expect(s.bookmarkedIds).toEqual(["local-1"]);
  });

  describe("when the first way of reading the list fails", () => {
    beforeEach(() => { vi.mocked(fetchBookmarkListFull).mockRejectedValue(new Error("boom")); });

    it("is answered when the older way gets an answer", async () => {
      vi.mocked(fetchBookmarkList).mockImplementation(answering(["a"]));
      await useBookmarkStore.getState().fetchBookmarks("me");
      const s = useBookmarkStore.getState();
      expect(s.listOutcome).toBe("answered");
      expect(s.bookmarkedIds).toEqual(["a"]);
    });

    it("is unreachable when the older way hears nothing either", async () => {
      vi.mocked(fetchBookmarkList).mockImplementation(timingOut([] as string[]));
      await useBookmarkStore.getState().fetchBookmarks("me");
      expect(useBookmarkStore.getState().listOutcome).toBe("unreachable");
    });

    it("is an error when both fail", async () => {
      vi.mocked(fetchBookmarkList).mockRejectedValue(new Error("boom again"));
      await useBookmarkStore.getState().fetchBookmarks("me");
      expect(useBookmarkStore.getState().listOutcome).toBe("error");
    });
  });
});

describe("fetchBookmarks: what is known while it is asking", () => {
  /** The outcome as it stands while the fetch is in flight. */
  const during = async (pubkey: string) => {
    let seen: string | undefined;
    vi.mocked(fetchBookmarkListFull).mockImplementation(async () => {
      seen = useBookmarkStore.getState().listOutcome;
      recordFetchOutcome(true);
      return NOTHING;
    });
    await useBookmarkStore.getState().fetchBookmarks(pubkey);
    return seen;
  };

  it("starts as not asked", () => {
    expect(useBookmarkStore.getInitialState().listOutcome).toBe("pending");
  });

  it("is not known while the first fetch is under way", async () => {
    expect(await during("me")).toBe("pending");
    expect(useBookmarkStore.getState().listOutcome).toBe("answered");
  });

  // Reopening Bookmarks asks again. "Nothing saved" is already known and must not flash a skeleton.
  it("keeps an answer already given for this account while it asks again", async () => {
    await during("me");
    expect(await during("me")).toBe("answered");
  });

  it("is not known again for another account", async () => {
    await during("me");
    expect(await during("someone-else")).toBe("pending");
  });

  // Try again: the view must go back to loading, not sit on the alert for the five seconds the fetch may take.
  for (const failed of ["unreachable", "error"] as const) {
    it(`is not known again when the last fetch was ${failed}`, async () => {
      useBookmarkStore.setState({ listOutcome: failed, listFor: "me" });
      expect(await during("me")).toBe("pending");
    });
  }
});
