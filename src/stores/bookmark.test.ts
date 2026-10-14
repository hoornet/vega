import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/nostr", () => ({ fetchReplaceableList: vi.fn(), publishReplaceableList: vi.fn() }));

import { useBookmarkStore } from "./bookmark";
import { useToastStore } from "./toast";
import { fetchReplaceableList, publishReplaceableList } from "../lib/nostr";
import { setCurrentAccount } from "../lib/currentAccount";

const toasts = () => useToastStore.getState().toasts;
const said = () => toasts().map((t) => [t.type, t.message]);
const state = () => useBookmarkStore.getState();
const published = async () => { await vi.advanceTimersByTimeAsync(1100); };
const list = (tags: string[][], content = "", createdAt = 100) => ({ status: "found" as const, list: { tags, content, createdAt } });
const relaysHold = (tags: string[][], content = "", createdAt = 100) => vi.mocked(fetchReplaceableList).mockResolvedValue(list(tags, content, createdAt));
const relaysHoldNone = () => vi.mocked(fetchReplaceableList).mockResolvedValue({ status: "none" });
const relaysCannotTell = () => vi.mocked(fetchReplaceableList).mockResolvedValue({ status: "unknown" });
const lastPublished = () => { const calls = vi.mocked(publishReplaceableList).mock.calls; return calls[calls.length - 1]; };

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(publishReplaceableList).mockReset().mockResolvedValue(true);
  relaysHoldNone();
  await vi.advanceTimersByTimeAsync(2000);
  vi.mocked(publishReplaceableList).mockClear();
  vi.mocked(fetchReplaceableList).mockClear();
  useBookmarkStore.setState({ bookmarkedIds: [], bookmarkedArticleAddrs: [], listOutcome: "pending", listFor: null });
  useToastStore.setState({ toasts: [] });
  setCurrentAccount("me");
});
afterEach(() => { vi.useRealTimers(); });

describe("fetchBookmarks: how the load ended", () => {
  // "No bookmarked notes." used to be the answer to a fetch nobody answered.
  it("is unreachable when the relays could not tell and nothing was read before", async () => {
    relaysCannotTell();
    await state().fetchBookmarks("me");
    expect(state().listOutcome).toBe("unreachable");
  });

  it("is answered when every relay answered and there is no list", async () => {
    await state().fetchBookmarks("me");
    expect(state().listOutcome).toBe("answered");
  });

  it("is answered when a list came back, notes or articles, with every tag kept", async () => {
    useBookmarkStore.setState({ listOutcome: "unreachable" });
    relaysHold([["a", "30023:pk:d"], ["e", "n1"], ["t", "reading"]], "private");
    await state().fetchBookmarks("me");
    expect(state().listOutcome).toBe("answered");
    expect(state().bookmarkedArticleAddrs).toEqual(["30023:pk:d"]);
    expect(state().bookmarkedIds).toEqual(["n1"]);
    expect(publishReplaceableList).not.toHaveBeenCalled();
  });

  it("keeps the list this device read before when nobody answers, and is answered from it", async () => {
    relaysHold([["e", "n1"]]);
    await state().fetchBookmarks("me");
    relaysCannotTell();
    await state().fetchBookmarks("me");
    expect(state().bookmarkedIds).toEqual(["n1"]);
    expect(state().listOutcome).toBe("answered");
  });

  it("is an error when the read failed", async () => {
    vi.mocked(fetchReplaceableList).mockRejectedValue(new Error("boom"));
    await state().fetchBookmarks("me");
    expect(state().listOutcome).toBe("error");
  });

  it("takes the bookmarks an older build kept on this computer as this account's, once", async () => {
    localStorage.setItem("wrystr_bookmarks", JSON.stringify(["old-note"]));
    localStorage.setItem("wrystr_bookmarks_articles", JSON.stringify(["30023:pk:old"]));
    relaysHold([["e", "n1"]]);
    await state().fetchBookmarks("me");
    expect(state().bookmarkedIds).toEqual(["n1", "old-note"]);
    expect(state().bookmarkedArticleAddrs).toEqual(["30023:pk:old"]);
    expect(lastPublished()).toEqual([10003, [["e", "n1"], ["e", "old-note"], ["a", "30023:pk:old"]], ""]);
  });
});

describe("fetchBookmarks: what is known while it is asking", () => {
  const during = async (pubkey: string) => {
    let seen: string | undefined;
    vi.mocked(fetchReplaceableList).mockImplementation(async () => { seen = state().listOutcome; return { status: "none" }; });
    await state().fetchBookmarks(pubkey);
    return seen;
  };

  it("starts as not asked", () => {
    expect(useBookmarkStore.getInitialState().listOutcome).toBe("pending");
  });

  it("is not known while the first fetch is under way", async () => {
    expect(await during("me")).toBe("pending");
    expect(state().listOutcome).toBe("answered");
  });

  it("keeps an answer already given for this account while it asks again", async () => {
    await during("me");
    expect(await during("me")).toBe("answered");
  });

  it("is not known again for another account", async () => {
    await during("me");
    setCurrentAccount("someone-else");
    expect(await during("someone-else")).toBe("pending");
  });

  for (const failed of ["unreachable", "error"] as const) {
    it(`is not known again when the last fetch was ${failed}`, async () => {
      useBookmarkStore.setState({ listOutcome: failed, listFor: "me" });
      expect(await during("me")).toBe("pending");
    });
  }
});

describe("bookmarking and the relays", () => {
  it("keeps the bookmark here at once, and publishes the relays' list with it a second later, content and other tags kept", async () => {
    relaysHold([["e", "n1"], ["t", "reading"]], "private");
    await state().fetchBookmarks("me");
    await state().addBookmark("n2");
    await state().addArticleBookmark("30023:pk:d");
    expect(state().bookmarkedIds).toEqual(["n1", "n2"]);
    expect(state().isBookmarked("n2")).toBe(true);
    expect(publishReplaceableList).not.toHaveBeenCalled();
    await published();
    expect(publishReplaceableList).toHaveBeenCalledTimes(1);
    expect(lastPublished()).toEqual([10003, [["e", "n1"], ["t", "reading"], ["e", "n2"], ["a", "30023:pk:d"]], "private"]);
  });

  it("publishes nothing while the relays' list is not known, keeps the bookmark here, and says so", async () => {
    relaysCannotTell();
    await state().fetchBookmarks("me");
    await state().addBookmark("n2");
    await published();
    expect(publishReplaceableList).not.toHaveBeenCalled();
    expect(state().bookmarkedIds).toEqual(["n2"]);
    expect(said()).toEqual([["error", "Couldn't publish your bookmarks: the list on your relays could not be read. The change is kept on this device, and Vega will try again when it next starts."]]);
    useToastStore.setState({ toasts: [] });
    relaysHold([["e", "n1"]]);
    await state().fetchBookmarks("me");
    expect(lastPublished()).toEqual([10003, [["e", "n1"], ["e", "n2"]], ""]);
  });

  it("a removal holds here until it goes out, and goes out on the list as the relays hold it", async () => {
    relaysHold([["e", "n1"], ["e", "n2"]]);
    await state().fetchBookmarks("me");
    vi.mocked(publishReplaceableList).mockRejectedValueOnce(new Error("no relay"));
    await state().removeBookmark("n1");
    await published();
    expect(said()).toEqual([["error", "Couldn't publish your bookmarks. The removal is on this device only until it goes out; Vega will try again when it next starts."]]);
    expect(state().bookmarkedIds).toEqual(["n2"]);
    useToastStore.setState({ toasts: [] });
    // Another device added n3 meanwhile; the removal still applies.
    relaysHold([["e", "n1"], ["e", "n2"], ["e", "n3"]], "", 200);
    await state().fetchBookmarks("me");
    expect(lastPublished()).toEqual([10003, [["e", "n2"], ["e", "n3"]], ""]);
    expect(state().bookmarkedIds).toEqual(["n2", "n3"]);
    expect(said()).toEqual([]);
  });

  it("Try again publishes on the list as the relays hold it now, and says so", async () => {
    await state().fetchBookmarks("me");
    vi.mocked(publishReplaceableList).mockRejectedValue(new Error("no relay"));
    await state().addBookmark("n2");
    await published();
    expect(said()).toEqual([["error", "Couldn't publish your bookmarks. The new one is saved on this device only until it goes out; Vega will try again when it next starts."]]);
    vi.mocked(publishReplaceableList).mockResolvedValue(true);
    toasts()[0].action!.run();
    await vi.advanceTimersByTimeAsync(10);
    expect(said()).toEqual([["success", "Bookmarks published."]]);
  });

  it("says why when a retry had nothing to sign with", async () => {
    await state().fetchBookmarks("me");
    vi.mocked(publishReplaceableList).mockRejectedValue(new Error("no relay"));
    await state().addBookmark("n2");
    await published();
    vi.mocked(publishReplaceableList).mockResolvedValue(false);
    toasts()[0].action!.run();
    await vi.advanceTimersByTimeAsync(10);
    expect(said()).toEqual([["error", "Couldn't publish your bookmarks: you are not signed in with a key that can sign."]]);
  });

  it("does not publish a change as the next account", async () => {
    await state().fetchBookmarks("me");
    await state().addBookmark("n2");
    setCurrentAccount("other");
    await published();
    expect(publishReplaceableList).not.toHaveBeenCalled();
    expect(localStorage.getItem("wrystr_bookmark_changes_me")).toContain("n2");
  });

  it("shows each account its own list", async () => {
    relaysHold([["e", "mine"]]);
    await state().fetchBookmarks("me");
    setCurrentAccount("other");
    relaysHold([["e", "theirs"]]);
    await state().fetchBookmarks("other");
    expect(state().bookmarkedIds).toEqual(["theirs"]);
    expect(state().listFor).toBe("other");
  });
});

describe("read state of articles", () => {
  it("is kept on this device", () => {
    state().markArticleRead("30023:pk:d");
    expect(state().isArticleRead("30023:pk:d")).toBe(true);
    state().markArticleUnread("30023:pk:d");
    expect(state().isArticleRead("30023:pk:d")).toBe(false);
  });
});
