import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The contact list is the one thing these tests care about; everything else
// user.ts reaches into on a login path is stubbed, as in user.test.ts.
const ndk = { signer: {} as unknown, pool: { relays: new Map() } };
vi.mock("../lib/nostr", () => ({
  getNDK: vi.fn(() => ndk),
  publishContactList: vi.fn(),
  fetchContactList: vi.fn(),
}));
vi.mock("../lib/db", () => ({ dbLoadProfile: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/notificationPoller", () => ({
  startNotificationPoller: vi.fn(),
  stopNotificationPoller: vi.fn(),
}));
vi.mock("./mute", () => ({ useMuteStore: { getState: () => ({ fetchMuteList: vi.fn() }) } }));
vi.mock("./lightning", () => ({ useLightningStore: { getState: () => ({ loadNwcForAccount: vi.fn() }) } }));
vi.mock("./ui", () => ({ useUIStore: { getState: () => ({ setView: vi.fn() }) } }));
vi.mock("./feed", () => ({ useFeedStore: { getState: () => ({ loadFeed: vi.fn() }) } }));
vi.mock("./notifications", () => ({
  useNotificationsStore: { getState: () => ({ fetchNotifications: vi.fn() }) },
}));
vi.mock("./podcast", () => ({
  usePodcastStore: { getState: () => ({ setActiveAccount: vi.fn(), hydrateSubscriptions: vi.fn(), forgetAccount: vi.fn() }) },
}));

import { invoke } from "@tauri-apps/api/core";
import { fetchContactList, publishContactList } from "../lib/nostr";
import type { ContactListResult, ContactListSnapshot } from "../lib/contacts";
import { useUserStore } from "./user";
import { useToastStore } from "./toast";
import { currentAccount } from "../lib/currentAccount";
import { forThisAccount } from "../lib/toastActions";

const ME = "11".repeat(32);
const OTHER = "22".repeat(32);
const A = "aa".repeat(32);
const B = "bb".repeat(32);
const C = "cc".repeat(32);

const fetchMock = vi.mocked(fetchContactList);
const publishMock = vi.mocked(publishContactList);

// A realistic list: a relay hint and petname on one entry, a non-p tag, and the
// legacy relay map some clients still keep in `content`.
const RICH_TAGS = [["p", A, "wss://relay.example", "alice"], ["t", "nostr"], ["p", B]];
const RICH_CONTENT = '{"wss://relay.example":{"read":true,"write":true}}';
const rich = (createdAt = 100): ContactListSnapshot => ({ tags: RICH_TAGS, content: RICH_CONTENT, createdAt });
const found = (list: ContactListSnapshot): ContactListResult => ({ status: "found", list });
const NONE: ContactListResult = { status: "none" };
const UNKNOWN: ContactListResult = { status: "unknown" };

function loginAs(pubkey: string) {
  useUserStore.setState({ pubkey, npub: "npub1test", loggedIn: true });
}
const state = () => useUserStore.getState();
const toastMessages = () => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear(); // each test starts on a device that remembers no contact list
  vi.mocked(invoke).mockResolvedValue(null); // keychain calls on logout / removeAccount
  // logout() is the public way to drop everything the store remembers about a
  // contact list between tests, including the module-level base and retry timer.
  state().logout();
  ndk.signer = {};
  useToastStore.setState({ toasts: [] });
  publishMock.mockResolvedValue(undefined);
  loginAs(ME);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchFollows", () => {
  it("loads the list the relays returned", async () => {
    fetchMock.mockResolvedValue(found(rich()));
    await state().fetchFollows();
    expect(state().follows).toEqual([A, B]);
    expect(state().followsStatus).toBe("loaded");
  });

  it("shows the list as soon as the first relay has it, before the slow ones finish", async () => {
    let finish!: (r: ContactListResult) => void;
    fetchMock.mockImplementation((_pk, opts) => {
      opts?.onFound?.(rich());
      return new Promise((resolve) => { finish = resolve; });
    });
    const pending = state().fetchFollows();
    expect(state().follows).toEqual([A, B]);
    expect(state().followsStatus).toBe("loaded");
    finish(found(rich()));
    await pending;
  });

  it("treats a confirmed absence as an empty, loaded list", async () => {
    fetchMock.mockResolvedValue(NONE);
    await state().fetchFollows();
    expect(state().follows).toEqual([]);
    expect(state().followsStatus).toBe("loaded");
  });

  // The 2026-10-11 bug: this used to be indistinguishable from "follows nobody".
  it("says unknown, not empty, when the relays could not tell", async () => {
    fetchMock.mockResolvedValue(UNKNOWN);
    await state().fetchFollows();
    expect(state().follows).toEqual([]);
    expect(state().followsStatus).toBe("unknown");
  });

  it("keeps asking after an unknown, and recovers when a relay answers", async () => {
    fetchMock.mockResolvedValueOnce(UNKNOWN).mockResolvedValueOnce(found(rich()));
    await state().fetchFollows();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state().follows).toEqual([A, B]);
    expect(state().followsStatus).toBe("loaded");
  });

  it("does not throw away a loaded list because the relays went quiet later", async () => {
    fetchMock.mockResolvedValueOnce(found(rich())).mockResolvedValueOnce(UNKNOWN);
    await state().fetchFollows();
    await state().fetchFollows();
    expect(state().follows).toEqual([A, B]);
    expect(state().followsStatus).toBe("loaded");
  });

  it("clears the previous account's follows the moment another account loads", async () => {
    fetchMock.mockResolvedValueOnce(found(rich()));
    await state().fetchFollows();
    expect(state().follows).toEqual([A, B]);

    loginAs(OTHER);
    let finish!: (r: ContactListResult) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = state().fetchFollows();
    expect(state().follows).toEqual([]);
    expect(state().followsStatus).toBe("loading");
    finish(UNKNOWN);
    await pending;
  });
});

describe("follow / unfollow", () => {
  it("publishes nothing when the list could not be loaded, and says why", async () => {
    fetchMock.mockResolvedValue(UNKNOWN);
    await state().fetchFollows();

    await state().follow(C);

    expect(publishMock).not.toHaveBeenCalled();
    expect(state().follows).toEqual([]);
    expect(state().followsStatus).toBe("unknown");
    expect(toastMessages().join(" ")).toMatch(/nothing was changed/i);
  });

  it("publishes nothing on a cold start either, if the relays still cannot tell", async () => {
    // No fetchFollows at all: the very first thing the user does is press Follow.
    fetchMock.mockResolvedValue(UNKNOWN);
    await state().follow(C);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("adds to the newest list on the relays, keeping hints, other tags and content", async () => {
    fetchMock.mockResolvedValue(found(rich()));

    await state().follow(C);

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith([...RICH_TAGS, ["p", C]], RICH_CONTENT);
    expect(state().follows).toEqual([A, B, C]);
    expect(state().followsStatus).toBe("loaded");
  });

  it("removes only the person unfollowed", async () => {
    fetchMock.mockResolvedValue(found(rich()));
    await state().fetchFollows();

    await state().unfollow(B);

    expect(publishMock).toHaveBeenCalledWith([["p", A, "wss://relay.example", "alice"], ["t", "nostr"]], RICH_CONTENT);
    expect(state().follows).toEqual([A]);
  });

  it("picks up a follow made in another client since this one loaded", async () => {
    fetchMock.mockResolvedValueOnce(found({ tags: [["p", A]], content: "", createdAt: 100 }));
    await state().fetchFollows();
    // Meanwhile another client published a newer list that also has B.
    fetchMock.mockResolvedValueOnce(found({ tags: [["p", A], ["p", B]], content: "", createdAt: 200 }));

    await state().follow(C);

    expect(publishMock).toHaveBeenCalledWith([["p", A], ["p", B], ["p", C]], "");
  });

  it("still works from the list loaded earlier when the relays are quiet now", async () => {
    fetchMock.mockResolvedValueOnce(found(rich()));
    await state().fetchFollows();
    fetchMock.mockResolvedValueOnce(UNKNOWN);

    await state().follow(C);

    expect(publishMock).toHaveBeenCalledWith([...RICH_TAGS, ["p", C]], RICH_CONTENT);
  });

  it("prefers what we just published over a stale copy a relay still serves", async () => {
    const stale = found({ tags: [["p", A]], content: "", createdAt: 100 });
    fetchMock.mockResolvedValue(stale);
    await state().fetchFollows();
    vi.setSystemTime(new Date(1_000_000 * 1000)); // our publishes are newer than createdAt 100

    await state().follow(B);
    await state().follow(C);

    expect(publishMock).toHaveBeenLastCalledWith([["p", A], ["p", B], ["p", C]], "");
  });

  it("starts a list for an account the relays confirm has none", async () => {
    fetchMock.mockResolvedValue(NONE);
    await state().fetchFollows();

    await state().follow(A);

    expect(publishMock).toHaveBeenCalledWith([["p", A]], "");
    expect(state().follows).toEqual([A]);
  });

  it("never uses one account's list as the base for another's", async () => {
    fetchMock.mockResolvedValueOnce(found(rich()));
    await state().fetchFollows();

    loginAs(OTHER);
    fetchMock.mockResolvedValue(UNKNOWN);
    await state().follow(C);

    expect(publishMock).not.toHaveBeenCalled();
    expect(state().follows).not.toContain(A);
  });

  it("puts the list back and says so when publishing fails", async () => {
    fetchMock.mockResolvedValue(found(rich()));
    await state().fetchFollows();
    publishMock.mockRejectedValueOnce(new Error("relays refused"));

    await state().follow(C);

    expect(state().follows).toEqual([A, B]);
    expect(toastMessages().join(" ")).toMatch(/couldn't publish/i);
  });

  it("does nothing when asked to follow someone already followed", async () => {
    fetchMock.mockResolvedValue(found(rich()));
    await state().fetchFollows();
    fetchMock.mockClear();

    await state().follow(A);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  // Two clicks in quick succession used to be two lists built from the same
  // starting point: the second publish silently dropped the first person.
  it("applies quick successive changes one after the other, losing none", async () => {
    fetchMock.mockResolvedValue(found({ tags: [["p", A]], content: "", createdAt: 100 }));
    await state().fetchFollows();
    vi.setSystemTime(new Date(1_000_000 * 1000));

    const first = state().follow(B);
    const second = state().follow(C);
    // Both show at once, before anything has been published.
    expect(state().follows).toEqual([A, B, C]);
    await Promise.all([first, second]);

    expect(publishMock).toHaveBeenCalledTimes(2);
    expect(publishMock).toHaveBeenLastCalledWith([["p", A], ["p", B], ["p", C]], "");
    expect(state().follows).toEqual([A, B, C]);
  });

  it("lets an account confirmed empty at login follow someone even if a relay is slow just then", async () => {
    fetchMock.mockResolvedValueOnce(NONE);
    await state().fetchFollows();
    fetchMock.mockResolvedValue(UNKNOWN);

    await state().follow(A);

    expect(publishMock).toHaveBeenCalledWith([["p", A]], "");
  });

  it("does nothing without a signer", async () => {
    ndk.signer = undefined;
    fetchMock.mockResolvedValue(found(rich()));
    await state().follow(C);
    expect(publishMock).not.toHaveBeenCalled();
  });
});

describe("how a follow ended", () => {
  // The caller that confirms a follow in a toast goes by this. It used to
  // look at the list afterwards, and after a failed publish the list is put
  // back to what the relays hold, which may already have the person.
  it("is done when the list was published", async () => {
    fetchMock.mockResolvedValue(found(rich()));
    await state().fetchFollows();
    expect(await state().follow(C)).toBe("done");
    expect(await state().unfollow(C)).toBe("done");
  });

  it("is done, with nothing published, for someone already followed", async () => {
    fetchMock.mockResolvedValue(found(rich()));
    await state().fetchFollows();
    expect(await state().follow(A)).toBe("done");
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("is failed when the list could not be loaded", async () => {
    fetchMock.mockResolvedValue(UNKNOWN);
    expect(await state().follow(A)).toBe("failed");
    expect(toastMessages().join(" ")).toMatch(/couldn't load your follow list/i);
  });

  it("is failed when the list could not be published", async () => {
    fetchMock.mockResolvedValue(found(rich()));
    await state().fetchFollows();
    publishMock.mockRejectedValueOnce(new Error("relays refused"));
    expect(await state().follow(C)).toBe("failed");
  });

  // The relays hold a newer list that already has her, and the publish fails.
  // The list is put back to that copy, so she is in it: a caller looking at
  // the list would announce "Following" on top of "Couldn't publish".
  it("is failed even when the list it was put back to has the person in it", async () => {
    fetchMock.mockResolvedValue(found({ tags: [["p", A]], content: "", createdAt: 100 }));
    await state().fetchFollows();
    fetchMock.mockResolvedValue(found({ tags: [["p", A], ["p", C]], content: "", createdAt: 200 }));
    publishMock.mockRejectedValueOnce(new Error("relays refused"));

    expect(await state().follow(C)).toBe("failed");

    expect(state().follows).toContain(C);
    expect(toastMessages().join(" ")).toMatch(/couldn't publish/i);
  });

  it("is dropped without a key to sign with", async () => {
    ndk.signer = undefined;
    expect(await state().follow(C)).toBe("dropped");
    expect(toastMessages()).toEqual([]);
  });

  // Queued behind another change, and the account changed before its turn.
  it("is dropped when the account changed while it waited its turn", async () => {
    fetchMock.mockResolvedValue(found({ tags: [["p", A]], content: "", createdAt: 100 }));
    await state().fetchFollows();
    const first = state().follow(B);
    const second = state().follow(C);
    loginAs(OTHER);
    const outcomes = await Promise.all([first, second]);
    expect(outcomes[1]).toBe("dropped");
    expect(publishMock).not.toHaveBeenCalledWith(expect.arrayContaining([["p", C]]), expect.anything());
  });

  // The publish failed after the account changed. The list on screen is the
  // new account's and is left alone, and so is the new account: "Couldn't
  // publish your follow list" would be about a list it never touched.
  it("is dropped, and says nothing, when its publish fails after the account changed", async () => {
    fetchMock.mockResolvedValue(found({ tags: [["p", A]], content: "", createdAt: 100 }));
    await state().fetchFollows();
    let fail: (err: Error) => void = () => {};
    publishMock.mockImplementationOnce(() => new Promise<never>((_, reject) => { fail = reject; }));
    const following = state().follow(B);
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalled());
    loginAs(OTHER);
    useToastStore.setState({ toasts: [] });
    fail(new Error("relays refused"));
    expect(await following).toBe("dropped");
    expect(toastMessages()).toEqual([]);
  });

  it("the failures have said why with an error, not a warning", async () => {
    fetchMock.mockResolvedValue(UNKNOWN);
    await state().follow(A);
    expect(useToastStore.getState().toasts.map((t) => t.type)).toEqual(["error"]);
  });
});

describe("when the account changes", () => {
  // "Undo" and "Try again" were about what the other account did: pressed
  // under the new one they would follow, repost or publish as the wrong person.
  it("drops the toasts whose action was that account's, keeps the rest, and tells the rest of the app who is signed in", async () => {
    useToastStore.getState().addToast("Following Alice.", "success", { action: forThisAccount("Undo", () => {}) });
    useToastStore.getState().addToast("Connection lost.", "warning");
    // "Relays", "View": about no account in particular.
    useToastStore.getState().addToast("A relay refused Vega's sign-in.", "warning", { action: { label: "Relays", run: () => {} } });
    loginAs(OTHER);
    expect(toastMessages()).toEqual(["Connection lost.", "A relay refused Vega's sign-in."]);
    expect(currentAccount()).toBe(OTHER);
  });

  it("does nothing of the kind when something else about the user changes", async () => {
    useToastStore.getState().addToast("Following Alice.", "success", { action: forThisAccount("Undo", () => {}) });
    useUserStore.setState({ follows: [A] });
    expect(toastMessages()).toEqual(["Following Alice."]);
    expect(currentAccount()).toBe(ME);
  });

  it("signing out counts", async () => {
    useToastStore.getState().addToast("Couldn't repost.", "error", { action: forThisAccount("Try again", () => {}) });
    state().logout();
    expect(toastMessages()).toEqual([]);
    expect(currentAccount()).toBeNull();
  });
});

describe("the contact list this device remembers", () => {
  const cacheKey = (pk: string) => `wrystr_contact_list_${pk}`;
  // A fresh start on the same device: the store forgets, localStorage does not.
  const restart = () => { state().logout(); ndk.signer = {}; loginAs(ME); };

  it("is saved when a list loads, and shown at once on the next start", async () => {
    fetchMock.mockResolvedValueOnce(found(rich()));
    await state().fetchFollows();
    expect(JSON.parse(localStorage.getItem(cacheKey(ME))!)).toEqual(rich());

    restart();
    let finish!: (r: ContactListResult) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = state().fetchFollows();
    // Before any relay has answered:
    expect(state().follows).toEqual([A, B]);
    expect(state().followsStatus).toBe("loaded");
    finish(UNKNOWN);
    await pending;
    expect(state().follows).toEqual([A, B]);
    expect(state().followsStatus).toBe("loaded");
  });

  // The whole point: the holder relay is slow or gone, the app restarts, the
  // user presses Follow. Before the fix this published a list of one.
  it("is the base for a follow when the relays cannot tell after a restart", async () => {
    fetchMock.mockResolvedValueOnce(found(rich()));
    await state().fetchFollows();
    restart();
    fetchMock.mockResolvedValue(UNKNOWN);

    await state().follow(C);

    expect(publishMock).toHaveBeenCalledWith([...RICH_TAGS, ["p", C]], RICH_CONTENT);
  });

  it("is kept, and republished on the next change, when the relays have lost the list", async () => {
    fetchMock.mockResolvedValueOnce(found(rich()));
    await state().fetchFollows();
    restart();
    fetchMock.mockResolvedValue(NONE); // every relay answered: no list any more

    await state().fetchFollows();
    expect(state().follows).toEqual([A, B]);
    await state().follow(C);

    expect(publishMock).toHaveBeenCalledWith([...RICH_TAGS, ["p", C]], RICH_CONTENT);
  });

  it("gives way to a newer list from the relays", async () => {
    localStorage.setItem(cacheKey(ME), JSON.stringify({ tags: [["p", A]], content: "", createdAt: 100 }));
    fetchMock.mockResolvedValue(found({ tags: [["p", A], ["p", B]], content: "", createdAt: 200 }));
    await state().fetchFollows();
    expect(state().follows).toEqual([A, B]);
    expect(JSON.parse(localStorage.getItem(cacheKey(ME))!).createdAt).toBe(200);
  });

  it("is not replaced by an older copy a relay still serves", async () => {
    localStorage.setItem(cacheKey(ME), JSON.stringify({ tags: [["p", A], ["p", B]], content: "", createdAt: 200 }));
    fetchMock.mockResolvedValue(found({ tags: [["p", A]], content: "", createdAt: 100 }));
    await state().fetchFollows();
    expect(state().follows).toEqual([A, B]);
  });

  it("records a successful follow, and not a failed one", async () => {
    fetchMock.mockResolvedValue(found(rich()));
    await state().follow(C);
    expect(contactPubkeysOf(localStorage.getItem(cacheKey(ME)))).toEqual([A, B, C]);

    publishMock.mockRejectedValueOnce(new Error("relays refused"));
    await state().unfollow(A);
    expect(contactPubkeysOf(localStorage.getItem(cacheKey(ME)))).toEqual([A, B, C]);
  });

  it("is per account", async () => {
    fetchMock.mockResolvedValueOnce(found(rich()));
    await state().fetchFollows();

    loginAs(OTHER);
    fetchMock.mockResolvedValue(UNKNOWN);
    await state().fetchFollows();

    expect(state().follows).toEqual([]);
    expect(state().followsStatus).toBe("unknown");
    expect(localStorage.getItem(cacheKey(OTHER))).toBeNull();
  });

  it("ignores a corrupt entry instead of treating it as an empty list", async () => {
    localStorage.setItem(cacheKey(ME), '{"tags":"not-an-array"}');
    fetchMock.mockResolvedValue(UNKNOWN);
    await state().fetchFollows();
    expect(state().followsStatus).toBe("unknown");

    await state().follow(C);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("is forgotten when the account is removed from this device", async () => {
    fetchMock.mockResolvedValueOnce(found(rich()));
    await state().fetchFollows();
    state().removeAccount(ME);
    expect(localStorage.getItem(cacheKey(ME))).toBeNull();
  });
});

function contactPubkeysOf(raw: string | null): string[] {
  const tags: string[][] = raw ? JSON.parse(raw).tags : [];
  return tags.filter((t) => t[0] === "p").map((t) => t[1]);
}

