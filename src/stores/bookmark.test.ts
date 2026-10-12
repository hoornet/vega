import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";


vi.mock("../lib/nostr", () => ({
  fetchBookmarkList: vi.fn(),
  fetchBookmarkListFull: vi.fn(),
  publishBookmarkListFull: vi.fn(),
}));

import { useBookmarkStore } from "./bookmark";
import { fetchBookmarkList, fetchBookmarkListFull, publishBookmarkListFull } from "../lib/nostr";
import { useToastStore } from "./toast";
import { setCurrentAccount } from "../lib/currentAccount";
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

describe("bookmarks and the relays", () => {
  const toasts = () => useToastStore.getState().toasts;
  /** Past the one-second pause before the list is published, and the publish itself. */
  const published = async () => { await vi.advanceTimersByTimeAsync(1100); };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(publishBookmarkListFull).mockReset().mockResolvedValue(true);
    useToastStore.setState({ toasts: [] });
    setCurrentAccount("me");
  });
  afterEach(() => { vi.useRealTimers(); setCurrentAccount(null); });

  it("saves on this device at once and publishes the list a second later", async () => {
    await useBookmarkStore.getState().addBookmark("a");
    expect(useBookmarkStore.getState().bookmarkedIds).toEqual(["a"]);
    expect(publishBookmarkListFull).not.toHaveBeenCalled();
    await published();
    expect(publishBookmarkListFull).toHaveBeenCalledWith(["a"], []);
    expect(toasts()).toEqual([]);
  });

  it("publishes once for several changes made in quick succession", async () => {
    await useBookmarkStore.getState().addBookmark("a");
    await useBookmarkStore.getState().addBookmark("b");
    await useBookmarkStore.getState().addArticleBookmark("30023:pk:d");
    await published();
    expect(vi.mocked(publishBookmarkListFull).mock.calls).toEqual([[["a", "b"], ["30023:pk:d"]]]);
  });

  // It used to be swallowed: the icon stayed filled for something no relay had, and nothing said so.
  it("says so when the list could not be published, and keeps the bookmark here", async () => {
    vi.mocked(publishBookmarkListFull).mockRejectedValue(new Error("Not enough relays received the event"));
    await useBookmarkStore.getState().addBookmark("a");
    await published();
    expect(useBookmarkStore.getState().bookmarkedIds).toEqual(["a"]);
    expect(toasts().map((t) => [t.type, t.message])).toEqual([["error", "Couldn't publish your bookmarks. The new one is saved on this device only."]]);
  });

  // "They are saved on this device" was not true of a removal: the next load
  // merges the relays' list back in, and the bookmark is there again.
  it("says something different, and true, when a removal could not be published", async () => {
    useBookmarkStore.setState({ bookmarkedIds: ["a"] });
    vi.mocked(publishBookmarkListFull).mockRejectedValue(new Error("boom"));
    await useBookmarkStore.getState().removeBookmark("a");
    await published();
    expect(toasts().map((t) => t.message)).toEqual(["Couldn't publish your bookmarks. The removal is on this device only, and may be undone the next time your list is loaded."]);
  });

  it("uses the removal wording for a removed article too, and for a batch that held one", async () => {
    useBookmarkStore.setState({ bookmarkedArticleAddrs: ["30023:pk:d"] });
    vi.mocked(publishBookmarkListFull).mockRejectedValue(new Error("boom"));
    await useBookmarkStore.getState().removeArticleBookmark("30023:pk:d");
    await useBookmarkStore.getState().addBookmark("a");
    await published();
    expect(toasts()[0].message).toContain("The removal is on this device only");
  });

  // One list, one toast: the second failure takes the place of the first, with the words that are true now.
  it("is one toast for a failed bookmark and then a failed removal", async () => {
    vi.mocked(publishBookmarkListFull).mockRejectedValue(new Error("boom"));
    await useBookmarkStore.getState().addBookmark("a");
    await published();
    await useBookmarkStore.getState().removeBookmark("a");
    await published();
    expect(toasts().map((t) => t.message)).toEqual(["Couldn't publish your bookmarks. The removal is on this device only, and may be undone the next time your list is loaded."]);
    expect(toasts()[0].key).toBe("publish:bookmarks");
  });

  it("does not carry an earlier batch's removal into the next one", async () => {
    useBookmarkStore.setState({ bookmarkedIds: ["a"] });
    await useBookmarkStore.getState().removeBookmark("a");
    await published();
    vi.mocked(publishBookmarkListFull).mockRejectedValue(new Error("boom"));
    await useBookmarkStore.getState().addArticleBookmark("30023:pk:d");
    await published();
    expect(toasts()[0].message).toContain("The new one is saved on this device only.");
  });

  // The list as it stands at the retry, not as it stood when the first try failed.
  it("Try again publishes the list as it stands now, without waiting", async () => {
    vi.mocked(publishBookmarkListFull).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(true);
    await useBookmarkStore.getState().addBookmark("a");
    await published();
    useBookmarkStore.setState({ bookmarkedIds: ["a", "b"] });
    expect(toasts()[0].action?.label).toBe("Try again");
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    failed.action?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(publishBookmarkListFull).mock.calls).toEqual([[["a"], []], [["a", "b"], []]]);
    // The toast is gone and nothing else on screen changes: a retry that worked must say so.
    expect(toasts().map((t) => [t.type, t.message])).toEqual([["success", "Bookmarks published."]]);
  });

  // It would publish this device's list under whoever is signed in by then.
  it("Try again does nothing, and says so, once the account has changed", async () => {
    vi.mocked(publishBookmarkListFull).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(true);
    await useBookmarkStore.getState().addBookmark("a");
    await published();
    const retry = toasts()[0].action;
    setCurrentAccount("someone-else");
    retry?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(publishBookmarkListFull).toHaveBeenCalledTimes(1);
    expect(toasts().map((t) => t.message)).toContain("That was for another account, so nothing was done.");
  });

  // No key to sign with (a read-only account): nothing went out. The retry
  // used to close its toast and say nothing at all.
  it("says why when a retry had nothing to sign with, and not that it worked", async () => {
    vi.mocked(publishBookmarkListFull).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(false);
    await useBookmarkStore.getState().addBookmark("a");
    await published();
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    failed.action?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(publishBookmarkListFull).toHaveBeenCalledTimes(2);
    expect(toasts().map((t) => [t.type, t.message])).toEqual([["error", "Couldn't publish your bookmarks: you are not signed in with a key that can sign."]]);
  });

  it("says nothing when the first try had nothing to sign with", async () => {
    vi.mocked(publishBookmarkListFull).mockResolvedValue(false);
    await useBookmarkStore.getState().addBookmark("a");
    await published();
    expect(toasts()).toEqual([]);
  });

  // "Saved on this device only" stayed up after the list had gone out with the next change.
  it("takes the failure down when the list goes out with a later change", async () => {
    vi.mocked(publishBookmarkListFull).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(true);
    await useBookmarkStore.getState().addBookmark("a");
    await published();
    expect(toasts()).toHaveLength(1);
    await useBookmarkStore.getState().addBookmark("b");
    await published();
    expect(toasts()).toEqual([]);
  });

  // What the account before it did must not word this one's failure.
  it("does not word one account's failed bookmark as the removal the account before it made", async () => {
    useBookmarkStore.setState({ bookmarkedIds: ["a"] });
    vi.mocked(publishBookmarkListFull).mockRejectedValue(new Error("boom"));
    await useBookmarkStore.getState().removeBookmark("a");
    setCurrentAccount("someone-else");
    await useBookmarkStore.getState().addBookmark("b");
    await published();
    expect(toasts().map((t) => t.message)).toEqual(["Couldn't publish your bookmarks. The new one is saved on this device only."]);
  });

  // The list waits a second before it goes out. Signed by whoever is there
  // by then, it would replace the other account's bookmarks with these.
  it("does not publish when the account changes during the pause", async () => {
    await useBookmarkStore.getState().addBookmark("a");
    setCurrentAccount("someone-else");
    await published();
    expect(publishBookmarkListFull).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });

  // A failure that comes back after the switch is not the new account's to hear.
  it("does not tell the next account about a publish that failed for the one before", async () => {
    let fail: (err: Error) => void = () => {};
    vi.mocked(publishBookmarkListFull).mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    await useBookmarkStore.getState().addBookmark("a");
    await published();
    setCurrentAccount("someone-else");
    fail(new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts()).toEqual([]);
  });

  it("does not tell the next account that the retry of the one before worked", async () => {
    let done: (published: boolean) => void = () => {};
    vi.mocked(publishBookmarkListFull).mockRejectedValueOnce(new Error("boom")).mockReturnValue(new Promise((resolve) => { done = resolve; }));
    await useBookmarkStore.getState().addBookmark("a");
    await published();
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    failed.action?.run();
    setCurrentAccount("someone-else");
    done(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts()).toEqual([]);
  });
});
