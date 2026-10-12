import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PodcastShow } from "../types/podcast";

// The podcast list is "cloud wins": at each start the relays' list replaces
// this device's, so that a show removed on another device goes here too.
// A change whose publish failed was thrown away by that, and the failure
// went to a development-only log.

const fetchPodcastList = vi.hoisted(() => vi.fn());
const publishPodcastList = vi.hoisted(() => vi.fn());
const ndk = vi.hoisted(() => ({ signer: {} as object | undefined }));
vi.mock("../lib/nostr/podcasts", () => ({ fetchPodcastList, publishPodcastList }));
vi.mock("../lib/nostr/core", () => ({ getNDK: () => ndk }));

import { usePodcastStore } from "./podcast";
import { useToastStore } from "./toast";
import { setCurrentAccount } from "../lib/currentAccount";

// Avoids a dev-dependency on @types/node just for this.
declare const process: {
  on(event: "unhandledRejection", handler: (reason: unknown) => void): void;
  off(event: "unhandledRejection", handler: (reason: unknown) => void): void;
};

const ME = "aa".repeat(32);
const OTHER = "bb".repeat(32);
const show = (name: string): PodcastShow => ({ feedUrl: `https://example.com/${name}.xml`, title: name }) as PodcastShow;
const A = show("a");
const B = show("b");
const C = show("c");
const X = show("x");
const Y = show("y");
const NO_RELAYS = new Error("Not enough relays received the event (0 published, 1 required)");
const FAILED = "Couldn't publish your podcast subscriptions: none of your relays accepted it. The change is saved on this device, and Vega will try again when it next starts. Check your relays and try again.";
const names = () => usePodcastStore.getState().subscriptions.map((s) => s.title);
/** The titles in the list that was published last. */
const lastPublished = () => {
  const calls = publishPodcastList.mock.calls;
  return calls.length ? (calls[calls.length - 1][0] as PodcastShow[]).map((s) => s.title) : null;
};
const toasts = () => useToastStore.getState().toasts;
const said = () => toasts().map((t) => [t.type, t.message]);
/** Past the pause before a change is published, and the publish itself. */
const published = async () => { await vi.advanceTimersByTimeAsync(1600); };
/** What the relays hold for this account. `null`: every one answered, and there is no list. */
const onRelays = (shows: PodcastShow[] | null) => fetchPodcastList.mockImplementation(async () => (shows ? { status: "found", shows, createdAt: 1000 } : { status: "none" }));
/** It cannot be told what the relays hold: none is up, or one did not answer. */
const outOfReach = () => fetchPodcastList.mockImplementation(async () => ({ status: "unknown" }));
/** Publishing works again, and what is sent is counted from here. */
const relaysTakeIt = () => publishPodcastList.mockReset().mockResolvedValue(true);
/** Vega is closed and started again: the store forgets, this device's storage does not. */
const restart = async (pubkey = ME) => {
  await vi.advanceTimersByTimeAsync(0);
  usePodcastStore.setState({ activePubkey: null, subscriptions: [] });
  setCurrentAccount(pubkey);
  usePodcastStore.getState().setActiveAccount(pubkey);
  await usePodcastStore.getState().hydrateSubscriptions(pubkey);
};

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("wrystr_podcast_legacy_migrated", "1");
  fetchPodcastList.mockReset();
  relaysTakeIt();
  ndk.signer = {};
  useToastStore.setState({ toasts: [] });
  onRelays([A, B]);
  await restart();
  publishPodcastList.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe("podcast subscriptions: the ordinary case", () => {
  it("starts from the relays' list", () => {
    expect(names()).toEqual(["a", "b"]);
    expect(publishPodcastList).not.toHaveBeenCalled();
  });

  it("publishes a change a moment later, and says nothing when it goes out", async () => {
    usePodcastStore.getState().subscribe(X);
    expect(publishPodcastList).not.toHaveBeenCalled();
    await published();
    expect(publishPodcastList).toHaveBeenCalledTimes(1);
    expect(lastPublished()).toEqual(["a", "b", "x"]);
    expect(toasts()).toEqual([]);
  });

  // Once a change is out, the relays' list is the list again: a show removed on another device goes here too.
  it("takes the relays' list at the next start once the change has been published", async () => {
    usePodcastStore.getState().subscribe(X);
    await published();
    onRelays([A]); // changed on another device since
    await restart();
    expect(names()).toEqual(["a"]);
    expect(publishPodcastList).toHaveBeenCalledTimes(1);
  });

  it("with nothing unpublished, the relays' list replaces this device's, as before", async () => {
    onRelays([A]);
    await restart();
    expect(names()).toEqual(["a"]);
    expect(publishPodcastList).not.toHaveBeenCalled();
  });
});

describe("podcast subscriptions: a change that could not be published", () => {
  it("says so, in the words for a failed publish, and offers to try again", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    await published();
    expect(said()).toEqual([["error", FAILED]]);
    expect(toasts()[0].action?.label).toBe("Try again");
    expect(names()).toEqual(["a", "b", "x"]);
  });

  // The data loss: subscribed while the relays could not be reached, and gone at the next start.
  it("keeps a show subscribed to meanwhile, and publishes it at the next start", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    await published();

    relaysTakeIt();
    onRelays([A, B]); // the relays still hold the list from before
    await restart();
    expect(names()).toEqual(["a", "b", "x"]);
    expect(lastPublished()).toEqual(["a", "b", "x"]);
  });

  it("keeps a show unsubscribed from meanwhile", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().unsubscribe(B.feedUrl);
    await published();

    relaysTakeIt();
    onRelays([A, B]);
    await restart();
    expect(names()).toEqual(["a"]);
    expect(lastPublished()).toEqual(["a"]);
  });

  it("keeps a change made just before Vega was closed, before it was published at all", async () => {
    usePodcastStore.getState().subscribe(X); // closed within the pause: nothing was sent
    usePodcastStore.getState().setActiveAccount(null); // the pause is abandoned with the session
    onRelays([A, B]);
    await restart();
    expect(names()).toEqual(["a", "b", "x"]);
    expect(lastPublished()).toEqual(["a", "b", "x"]);
  });

  it("goes on trying at each start for as long as the publish fails, then takes the relays' list again", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    await published();
    onRelays([A, B]);
    await restart();
    await restart();
    expect(names()).toEqual(["a", "b", "x"]);
    relaysTakeIt();
    await restart(); // this one goes out
    expect(lastPublished()).toEqual(["a", "b", "x"]);
    onRelays([A]);
    await restart();
    expect(names()).toEqual(["a"]);
  });

  // Shows keep the place they have on the relays, and what is new here goes at the end.
  it("keeps the relays' order, with what was added here at the end", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    usePodcastStore.getState().unsubscribe(A.feedUrl);
    usePodcastStore.getState().subscribe(A); // back again: changed here, and in both lists
    await published();
    relaysTakeIt();
    onRelays([C, B, A]);
    await restart();
    expect(names()).toEqual(["c", "b", "a", "x"]);
  });

  it("ends on the last thing done to a show: added and then removed, or the other way round", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    usePodcastStore.getState().unsubscribe(X.feedUrl);
    usePodcastStore.getState().unsubscribe(B.feedUrl);
    usePodcastStore.getState().subscribe(B);
    await published();
    relaysTakeIt();
    onRelays([A, B, X]); // the relays do hold x, from another device
    await restart();
    expect(names()).toEqual(["a", "b"]);
  });
});

// What was changed here is made again on top of whatever the relays hold
// now. No clock is compared: a time would have to be set against another
// device's, and cannot say what to do when both sides changed.
describe("podcast subscriptions: another device changed the list too", () => {
  it("keeps a show another device added before the change here", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().unsubscribe(B.feedUrl); // this device still thinks the list is a, b
    await published();
    relaysTakeIt();
    onRelays([A, B, C]); // c was added elsewhere, before or after: it does not matter
    await restart();
    expect(names()).toEqual(["a", "c"]);
    expect(lastPublished()).toEqual(["a", "c"]);
  });

  it("lets a show another device removed stay removed", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    await published();
    relaysTakeIt();
    onRelays([A]); // b was removed elsewhere
    await restart();
    expect(names()).toEqual(["a", "x"]);
  });

  // A publish that was reported failed and arrived after all (a relay that
  // wanted a sign-in first). The relays' list is then this device's own
  // earlier one, and must not be taken for another device's.
  it("does not bring a show back because this device's own earlier list arrived late", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X); // "failed", and arrives after all
    await published();
    usePodcastStore.getState().unsubscribe(B.feedUrl); // fails for real
    await published();
    relaysTakeIt();
    onRelays([A, B, X]);
    await restart();
    expect(names()).toEqual(["a", "x"]);
  });
});

describe("podcast subscriptions: a publish that did not carry everything", () => {
  // A second change while the first publish is on its way. That publish going
  // out is not the second change going out.
  it("keeps a change made while an earlier publish was on its way", async () => {
    let finish: (sent: boolean) => void = () => {};
    publishPodcastList.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    usePodcastStore.getState().subscribe(X);
    await published(); // the first publish is on its way, with a, b, x
    usePodcastStore.getState().subscribe(Y);
    finish(true);
    usePodcastStore.getState().setActiveAccount(null); // closed before the second went out

    relaysTakeIt();
    onRelays([A, B, X]);
    await restart();
    expect(names()).toEqual(["a", "b", "x", "y"]);
    expect(lastPublished()).toEqual(["a", "b", "x", "y"]);
  });

  // Signed out within the pause: the publish runs with no key and sends nothing.
  it("keeps a change when there was no key to sign its publish with", async () => {
    usePodcastStore.getState().subscribe(X);
    publishPodcastList.mockResolvedValue(false); // nothing went out
    await published();
    expect(toasts()).toEqual([]);

    relaysTakeIt();
    onRelays([A, B]);
    await restart();
    expect(names()).toEqual(["a", "b", "x"]);
    expect(lastPublished()).toEqual(["a", "b", "x"]);
  });

  // Signed out, or switched, within the pause, and someone else is signed in when it ends.
  it("does not publish one account's list under the next account's key, and keeps the change", async () => {
    usePodcastStore.getState().subscribe(X);
    setCurrentAccount(OTHER);
    fetchPodcastList.mockClear();
    await published();
    expect(publishPodcastList).not.toHaveBeenCalled();
    expect(fetchPodcastList).not.toHaveBeenCalled(); // not even read: it is not this account's turn

    onRelays([A, B]);
    await restart(ME);
    expect(names()).toEqual(["a", "b", "x"]);
  });
});

// A change used to go out as this device's whole list, as it stood here.
// That is right only if this device has just read the relays' list, and it
// often has not: the start's read found nobody, or is still on its way.
describe("podcast subscriptions: a change is published on top of the relays' list, read first", () => {
  it("reads the relays' list before publishing a change, and publishes on top of it", async () => {
    onRelays([A, C]); // changed on another device since this one last looked
    usePodcastStore.getState().subscribe(X);
    await published();
    expect(lastPublished()).toEqual(["a", "c", "x"]);
    expect(names()).toEqual(["a", "c", "x"]);
  });

  // The start found no relay. A minute later they are back, and one show is added.
  it("does not publish this device's list over one it could not read at the start", async () => {
    outOfReach();
    await restart(); // this device still has a, b from before
    onRelays([A, C]);
    usePodcastStore.getState().subscribe(X);
    await published();
    expect(lastPublished()).toEqual(["a", "c", "x"]);
  });

  // A device that has never had the list, and could not read it at the start.
  // One subscription from here used to replace the whole list on the relays.
  it("does not replace the relays' list with one show from a device that never had it", async () => {
    localStorage.clear();
    localStorage.setItem("wrystr_podcast_legacy_migrated", "1");
    outOfReach();
    await restart();
    expect(names()).toEqual([]);
    onRelays([A, B]);
    usePodcastStore.getState().subscribe(X);
    await published();
    expect(lastPublished()).toEqual(["a", "b", "x"]);
    expect(publishPodcastList).toHaveBeenCalledTimes(1);
  });

  it("says so, publishes nothing and keeps the change when the relays' list cannot be read at that moment", async () => {
    outOfReach();
    usePodcastStore.getState().subscribe(X);
    await published();
    expect(publishPodcastList).not.toHaveBeenCalled();
    expect(said()).toEqual([["error", "Couldn't publish your podcast subscriptions: the list on your relays could not be read. The change is saved on this device, and Vega will try again when it next starts."]]);
    expect(toasts()[0].action?.label).toBe("Try again");

    onRelays([A, B]);
    toasts()[0].action?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastPublished()).toEqual(["a", "b", "x"]);
  });

  // The start's read is still on its way when a show is added. Two things
  // went out: the start's result, and then the list as it stood at the click.
  it("publishes once, and the right list, for a change made while the start was still reading", async () => {
    let answer: (shows: PodcastShow[]) => void = () => {};
    fetchPodcastList.mockImplementationOnce(() => new Promise((resolve) => { answer = (shows) => resolve({ status: "found", shows, createdAt: 1000 }); }));
    usePodcastStore.setState({ activePubkey: null, subscriptions: [] });
    usePodcastStore.getState().setActiveAccount(ME);
    const starting = usePodcastStore.getState().hydrateSubscriptions(ME); // reading…
    usePodcastStore.getState().subscribe(X);
    await vi.advanceTimersByTimeAsync(1600); // the pause is over while the start still reads
    outOfReach(); // and by the time the change's own round comes, nobody answers
    answer([A, C]);
    await starting;
    await vi.advanceTimersByTimeAsync(0);
    expect(publishPodcastList.mock.calls.map(([shows]) => (shows as PodcastShow[]).map((s) => s.title))).toEqual([["a", "c", "x"]]);
    expect(names()).toEqual(["a", "c", "x"]);
    // Nothing was left waiting, so there is nothing to have failed.
    expect(toasts()).toEqual([]);
  });

  // The account changes while the relays are being read for a change.
  it("publishes nothing, and puts nothing in place, when the account changes while the relays are read", async () => {
    let answer: (shows: PodcastShow[]) => void = () => {};
    fetchPodcastList.mockImplementationOnce(() => new Promise((resolve) => { answer = (shows) => resolve({ status: "found", shows, createdAt: 1000 }); }));
    usePodcastStore.getState().subscribe(X);
    await published(); // reading…
    setCurrentAccount(OTHER);
    usePodcastStore.getState().setActiveAccount(OTHER);
    answer([A, C]);
    await vi.advanceTimersByTimeAsync(0);
    expect(publishPodcastList).not.toHaveBeenCalled();
    expect(names()).toEqual([]); // the other account's own list, untouched

    onRelays([A, C]);
    await restart(ME); // and the change is still waiting for the account that made it
    expect(lastPublished()).toEqual(["a", "c", "x"]);
  });

  it("takes nothing and publishes nothing when reading the relays fails outright", async () => {
    fetchPodcastList.mockRejectedValue(new Error("boom"));
    usePodcastStore.getState().subscribe(X);
    await published();
    expect(publishPodcastList).not.toHaveBeenCalled();
    expect(names()).toEqual(["a", "b", "x"]);
    expect(toasts()).toHaveLength(1);
  });

  // One round at a time: a second change waits for the first to have gone out, and is then read and published in its turn.
  it("publishes changes made in two rounds one after the other, each on top of what the relays hold by then", async () => {
    let finish: (sent: boolean) => void = () => {};
    publishPodcastList.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    usePodcastStore.getState().subscribe(X);
    await published(); // round one: read a, b; publishing a, b, x
    usePodcastStore.getState().subscribe(Y);
    await published(); // round two waits its turn
    expect(publishPodcastList).toHaveBeenCalledTimes(1);
    onRelays([A, B, X]);
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(publishPodcastList).toHaveBeenCalledTimes(2);
    expect(lastPublished()).toEqual(["a", "b", "x", "y"]);
  });

  // A remote signer nobody approves never answers. Every later change waited behind it for good.
  it("gives up on a signer that does not answer, says so, and lets the next change through", async () => {
    publishPodcastList.mockImplementationOnce(() => new Promise<boolean>(() => {}));
    usePodcastStore.getState().subscribe(X);
    await published();
    await vi.advanceTimersByTimeAsync(30000);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toContain("the signer did not answer");

    usePodcastStore.getState().subscribe(Y);
    await published();
    expect(lastPublished()).toEqual(["a", "b", "x", "y"]);
  });

  // Storage full, say. Nobody waits for a round, so nobody can catch what it throws.
  it("goes on with the next round when one fails outright, and leaves nothing uncaught", async () => {
    const uncaught = vi.fn();
    process.on("unhandledRejection", uncaught);
    try {
      fetchPodcastList.mockImplementationOnce(async () => ({ status: "found", shows: null as unknown as PodcastShow[], createdAt: 1 }));
      usePodcastStore.getState().subscribe(X);
      await published(); // this round throws inside
      usePodcastStore.getState().subscribe(Y);
      await published();
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(uncaught).not.toHaveBeenCalled();
      expect(lastPublished()).toEqual(["a", "b", "x", "y"]);
    } finally {
      process.off("unhandledRejection", uncaught);
    }
  });

  it("does nothing for a show that is not in the list", async () => {
    usePodcastStore.getState().unsubscribe(X.feedUrl);
    await published();
    expect(fetchPodcastList).toHaveBeenCalledTimes(1); // the start's read, and no other
    expect(publishPodcastList).not.toHaveBeenCalled();
  });
});

describe("podcast subscriptions: the start", () => {
  // "Could not tell" is not "no list".
  it("takes nothing and publishes nothing when the relays' list cannot be read", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    await published();
    relaysTakeIt();
    outOfReach();
    await restart();
    expect(names()).toEqual(["a", "b", "x"]);
    expect(publishPodcastList).not.toHaveBeenCalled();

    onRelays([A, B]); // and the change is still on record for when they do
    await restart();
    expect(lastPublished()).toEqual(["a", "b", "x"]);
  });

  it("does not publish this device's list as a first list when the relays' cannot be read, and makes no fuss at the start", async () => {
    outOfReach();
    await restart();
    expect(names()).toEqual(["a", "b"]);
    expect(publishPodcastList).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });

  // An empty list on the relays is a list someone emptied. It was taken for
  // no list at all, and this device published its own copy back.
  it("takes an emptied list from the relays as it is, and does not put this device's back", async () => {
    onRelays([]);
    await restart();
    expect(names()).toEqual([]);
    expect(publishPodcastList).not.toHaveBeenCalled();
  });

  it("publishes this device's list as the first one when the relays answer that there is none", async () => {
    onRelays(null);
    await restart();
    expect(lastPublished()).toEqual(["a", "b"]);
    expect(toasts()).toEqual([]);
  });

  // That publish used to go out with no word either way.
  it("says so when that first list could not be published, and Try again sends it", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    onRelays(null);
    await restart();
    expect(said()).toEqual([["error", FAILED]]);
    expect(names()).toEqual(["a", "b"]);

    relaysTakeIt();
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    failed.action?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastPublished()).toEqual(["a", "b"]);
    expect(said()).toEqual([["success", "Podcast subscriptions published."]]);
  });

  it("sends a first list that failed again at the next start, on top of what another device published meanwhile", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    onRelays(null);
    await restart();
    relaysTakeIt();
    onRelays([C]);
    await restart();
    expect(names()).toEqual(["c", "a", "b"]);
    expect(lastPublished()).toEqual(["c", "a", "b"]);
  });

  // Signed in without a key (read-only), or the key is not there yet.
  it("without a key, shows the relays' list with this device's changes, publishes nothing, and keeps them for later", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    await published();
    relaysTakeIt();
    ndk.signer = undefined;
    onRelays([A, C]);
    useToastStore.setState({ toasts: [] });
    await restart();
    expect(names()).toEqual(["a", "c", "x"]);
    expect(publishPodcastList).not.toHaveBeenCalled();
    // Nobody asked for anything: a start without a key is not a failure to report.
    expect(toasts()).toEqual([]);

    ndk.signer = {};
    await restart();
    expect(lastPublished()).toEqual(["a", "c", "x"]);
  });
});

// Before per-account lists there was one list on the device. The first
// account to start after that takes it over.
describe("podcast subscriptions: the list from before accounts had their own", () => {
  const fresh = async (stored: PodcastShow[]) => {
    localStorage.clear();
    localStorage.setItem("wrystr_podcast_subs", JSON.stringify(stored));
    publishPodcastList.mockClear();
  };

  it("joins it with a list another device has already published, and publishes the result", async () => {
    await fresh([A, X]);
    onRelays([A, B]);
    await restart();
    expect(names()).toEqual(["a", "b", "x"]);
    expect(lastPublished()).toEqual(["a", "b", "x"]);
  });

  // That publish went straight out with no record and no word. When it
  // failed, the next start took the relays' list and the shows were gone.
  it("still has those shows at the next start when that publish failed, and says that it failed", async () => {
    await fresh([A, X]);
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    onRelays([A, B]);
    await restart();
    expect(said()).toEqual([["error", FAILED]]);
    relaysTakeIt();
    await restart();
    expect(names()).toEqual(["a", "b", "x"]);
    expect(lastPublished()).toEqual(["a", "b", "x"]);
  });
});

describe("podcast subscriptions: the toast", () => {
  it("Try again publishes the list as it stands now, says so, and the next start takes the relays' list again", async () => {
    publishPodcastList.mockRejectedValueOnce(NO_RELAYS).mockResolvedValue(true);
    usePodcastStore.getState().subscribe(X);
    await published();
    usePodcastStore.getState().subscribe(Y);
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    failed.action?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastPublished()).toEqual(["a", "b", "x", "y"]);
    expect(said()).toEqual([["success", "Podcast subscriptions published."]]);
    onRelays([A]);
    await restart();
    expect(names()).toEqual(["a"]);
  });

  // "Try again" with no key of this account's: the toast closed and nothing came of it.
  it("says why when Try again had no key of this account's to sign with", async () => {
    publishPodcastList.mockRejectedValueOnce(NO_RELAYS).mockResolvedValue(false);
    usePodcastStore.getState().subscribe(X);
    await published();
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    failed.action?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(said()).toEqual([["error", "Couldn't publish your podcast subscriptions: you are not signed in with a key that can sign. The change is saved on this device, and Vega will try again when it next starts."]]);
  });

  // A bunker that did not come back: the account is there, read-only, and the toast from before still offers to try.
  it("says why when Try again finds no key at all", async () => {
    publishPodcastList.mockRejectedValueOnce(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    await published();
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    ndk.signer = undefined;
    publishPodcastList.mockClear();
    failed.action?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(publishPodcastList).not.toHaveBeenCalled();
    expect(said()).toEqual([["error", "Couldn't publish your podcast subscriptions: you are not signed in with a key that can sign. The change is saved on this device, and Vega will try again when it next starts."]]);
  });

  it("is taken down when the list goes out with a later change", async () => {
    publishPodcastList.mockRejectedValueOnce(NO_RELAYS).mockResolvedValue(true);
    usePodcastStore.getState().subscribe(X);
    await published();
    expect(toasts()).toHaveLength(1);
    usePodcastStore.getState().unsubscribe(A.feedUrl);
    await published();
    expect(toasts()).toEqual([]);
  });

  // A failure that comes back after the switch is not the new account's to hear.
  it("is not shown to the next account, and the change is kept for the one that made it", async () => {
    let fail: (err: Error) => void = () => {};
    publishPodcastList.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    usePodcastStore.getState().subscribe(X);
    await published();
    setCurrentAccount(OTHER);
    fail(NO_RELAYS);
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts()).toEqual([]);

    relaysTakeIt();
    onRelays([A, B]);
    await restart(ME);
    expect(names()).toEqual(["a", "b", "x"]);
  });

  it("keeps what is unpublished per account", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    await published();
    relaysTakeIt();
    onRelays([B]);
    await restart(OTHER);
    expect(names()).toEqual(["b"]); // the other account takes the relays' list as ever
    expect(publishPodcastList).not.toHaveBeenCalled();
  });
});

describe("podcast subscriptions: nobody is signed in", () => {
  // After signing out, what is subscribed to is nobody's. It went into the
  // last account's list, and was published under its name at the next sign-in.
  it("keeps what is subscribed to while signed out off every account's list and record", async () => {
    usePodcastStore.getState().setActiveAccount(null);
    setCurrentAccount(null);
    usePodcastStore.getState().subscribe(X);
    await published();
    expect(publishPodcastList).not.toHaveBeenCalled();

    onRelays([A, B]);
    await restart(ME);
    expect(names()).toEqual(["a", "b"]);
    expect(publishPodcastList).not.toHaveBeenCalled();
  });

  it("forgets an account's list and its record when the account is removed from this computer", async () => {
    publishPodcastList.mockRejectedValue(NO_RELAYS);
    usePodcastStore.getState().subscribe(X);
    await published();
    usePodcastStore.getState().setActiveAccount(null);
    usePodcastStore.getState().forgetAccount(ME);
    relaysTakeIt();
    // Added again later, with no relay in reach: nothing of the old list is left on this computer.
    outOfReach();
    await restart(ME);
    expect(names()).toEqual([]);
    // And with the relays back, their list is taken as it is: no old change is made to it again.
    onRelays([A]);
    await restart(ME);
    expect(names()).toEqual(["a"]);
    expect(publishPodcastList).not.toHaveBeenCalled();
  });
});
