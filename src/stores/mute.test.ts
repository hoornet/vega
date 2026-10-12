import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/nostr", () => ({ fetchMuteList: vi.fn().mockResolvedValue([]), publishMuteList: vi.fn() }));

import { useMuteStore } from "./mute";
import { useToastStore } from "./toast";
import { publishMuteList } from "../lib/nostr";
import { setCurrentAccount } from "../lib/currentAccount";

const toasts = () => useToastStore.getState().toasts;
const said = () => toasts().map((t) => [t.type, t.message]);
/** Past the one-second pause before the list is published, and the publish itself. */
const published = async () => { await vi.advanceTimersByTimeAsync(1100); };
const MUTE_FAILED = "Couldn't publish your mute list. The mute is on this device only.";
const UNMUTE_FAILED = "Couldn't publish your mute list. The unmute is on this device only, and may be undone the next time your list is loaded.";

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(publishMuteList).mockReset().mockResolvedValue(true);
  await vi.advanceTimersByTimeAsync(2000); // nothing left over from the test before
  vi.mocked(publishMuteList).mockClear();
  useMuteStore.setState({ mutedPubkeys: [] });
  useToastStore.setState({ toasts: [] });
  setCurrentAccount("me");
});
afterEach(() => { vi.useRealTimers(); });

describe("muting and the relays", () => {
  it("mutes on this device at once, and publishes the list a second later", async () => {
    await useMuteStore.getState().mute("alice");
    expect(useMuteStore.getState().mutedPubkeys).toEqual(["alice"]);
    expect(publishMuteList).not.toHaveBeenCalled();
    await published();
    expect(publishMuteList).toHaveBeenCalledWith(["alice"]);
    expect(toasts()).toEqual([]);
  });

  // Mute then Undo inside a second made two lists with the same timestamp,
  // and which of two such events a relay keeps is not "the later one".
  it("publishes once for a mute and its undo in quick succession, with the list as it ends up", async () => {
    await useMuteStore.getState().mute("alice");
    await useMuteStore.getState().unmute("alice");
    await published();
    expect(vi.mocked(publishMuteList).mock.calls).toEqual([[[]]]);
  });

  // It used to be swallowed: the mute never reached the user's other devices and nothing said so.
  it("says so when a mute could not be published, and keeps the mute here", async () => {
    vi.mocked(publishMuteList).mockRejectedValue(new Error("Not enough relays received the event"));
    await useMuteStore.getState().mute("alice");
    await published();
    expect(useMuteStore.getState().mutedPubkeys).toEqual(["alice"]);
    expect(said()).toEqual([["error", MUTE_FAILED]]);
  });

  // "It is saved on this device and applies here" was not true of an unmute:
  // the next load merges the relays' list back in, and she is muted again.
  it("says something different, and true, when an unmute could not be published", async () => {
    useMuteStore.setState({ mutedPubkeys: ["alice"] });
    vi.mocked(publishMuteList).mockRejectedValue(new Error("boom"));
    await useMuteStore.getState().unmute("alice");
    await published();
    expect(useMuteStore.getState().mutedPubkeys).toEqual([]);
    expect(said()).toEqual([["error", UNMUTE_FAILED]]);
  });

  it("uses the unmute wording when a batch held an unmute at all", async () => {
    useMuteStore.setState({ mutedPubkeys: ["alice"] });
    vi.mocked(publishMuteList).mockRejectedValue(new Error("boom"));
    await useMuteStore.getState().unmute("alice");
    await useMuteStore.getState().mute("bob");
    await published();
    expect(said()).toEqual([["error", UNMUTE_FAILED]]);
  });

  // One list, one toast: the second failure takes the place of the first, with the words that are true now.
  it("is one toast for a failed mute and then a failed unmute", async () => {
    vi.mocked(publishMuteList).mockRejectedValue(new Error("boom"));
    await useMuteStore.getState().mute("alice");
    await published();
    await useMuteStore.getState().unmute("alice");
    await published();
    expect(said()).toEqual([["error", UNMUTE_FAILED]]);
    expect(toasts()[0].key).toBe("publish:mutes");
  });

  it("does not carry an earlier batch's unmute into the next one", async () => {
    useMuteStore.setState({ mutedPubkeys: ["alice"] });
    await useMuteStore.getState().unmute("alice");
    await published();
    vi.mocked(publishMuteList).mockRejectedValue(new Error("boom"));
    await useMuteStore.getState().mute("bob");
    await published();
    expect(said()).toEqual([["error", MUTE_FAILED]]);
  });

  // The list as it stands at the retry, not as it stood when the first try failed.
  it("Try again publishes the list as it stands now, and says so when it works", async () => {
    vi.mocked(publishMuteList).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(true);
    await useMuteStore.getState().mute("alice");
    await published();
    useMuteStore.setState({ mutedPubkeys: ["alice", "bob"] });
    expect(toasts()[0].action?.label).toBe("Try again");
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    failed.action?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(publishMuteList).mock.calls).toEqual([[["alice"]], [["alice", "bob"]]]);
    // The toast is gone and nothing else on screen changes: a retry that worked must say so.
    expect(said()).toEqual([["success", "Mute list published."]]);
  });

  // No key to sign with (a read-only account): nothing went out. The retry
  // used to close its toast and say nothing at all.
  it("says why when a retry had nothing to sign with, and not that it worked", async () => {
    vi.mocked(publishMuteList).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(false);
    await useMuteStore.getState().mute("alice");
    await published();
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    failed.action?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(publishMuteList).toHaveBeenCalledTimes(2);
    expect(said()).toEqual([["error", "Couldn't publish your mute list: you are not signed in with a key that can sign."]]);
  });

  it("says nothing when the first try had nothing to sign with", async () => {
    vi.mocked(publishMuteList).mockResolvedValue(false);
    await useMuteStore.getState().mute("alice");
    await published();
    expect(toasts()).toEqual([]);
  });

  // "The mute is on this device only" stayed up after the list had gone out with the next change.
  it("takes the failure down when the list goes out with a later change", async () => {
    vi.mocked(publishMuteList).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(true);
    await useMuteStore.getState().mute("alice");
    await published();
    expect(said()).toEqual([["error", MUTE_FAILED]]);
    await useMuteStore.getState().mute("bob");
    await published();
    expect(toasts()).toEqual([]);
  });

  it("says nothing about publishing when the first try works", async () => {
    await useMuteStore.getState().mute("alice");
    await published();
    expect(toasts()).toEqual([]);
  });

  it("says it again when the retry fails too", async () => {
    vi.mocked(publishMuteList).mockRejectedValue(new Error("boom"));
    await useMuteStore.getState().mute("alice");
    await published();
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    failed.action?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(said()).toEqual([["error", MUTE_FAILED]]);
    expect(toasts()[0].action?.label).toBe("Try again");
  });

  // It would publish this device's list under whoever is signed in by then.
  it("Try again does nothing, and says so, once the account has changed", async () => {
    vi.mocked(publishMuteList).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(true);
    await useMuteStore.getState().mute("alice");
    await published();
    const retry = toasts()[0].action;
    setCurrentAccount("someone-else");
    retry?.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(publishMuteList).toHaveBeenCalledTimes(1);
    expect(toasts().map((t) => t.message)).toContain("That was for another account, so nothing was done.");
  });

  // The list waits a second before it goes out. Signed by whoever is there
  // by then, it would replace the other account's mute list with this one.
  it("does not publish when the account changes during the pause", async () => {
    await useMuteStore.getState().mute("alice");
    setCurrentAccount("someone-else");
    await published();
    expect(publishMuteList).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });

  // One publish, for the account that made the last change. (That the list
  // itself is one for all accounts on this device is older than this, and a
  // known gap: see CLAUDE.md.)
  it("publishes once, for the account that made the last change of a batch", async () => {
    await useMuteStore.getState().mute("alice");
    setCurrentAccount("someone-else");
    await useMuteStore.getState().mute("bob");
    await published();
    expect(publishMuteList).toHaveBeenCalledTimes(1);
  });

  // What the account before it did must not word this one's failure.
  it("does not word one account's failed mute as the unmute the account before it made", async () => {
    useMuteStore.setState({ mutedPubkeys: ["alice"] });
    vi.mocked(publishMuteList).mockRejectedValue(new Error("boom"));
    await useMuteStore.getState().unmute("alice");
    setCurrentAccount("someone-else");
    await useMuteStore.getState().mute("bob");
    await published();
    expect(said()).toEqual([["error", MUTE_FAILED]]);
  });

  // A failure that comes back after the switch is not the new account's to hear.
  it("does not tell the next account about a publish that failed for the one before", async () => {
    let fail: (err: Error) => void = () => {};
    vi.mocked(publishMuteList).mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    await useMuteStore.getState().mute("alice");
    await published();
    setCurrentAccount("someone-else");
    fail(new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts()).toEqual([]);
  });

  it("does not tell the next account that the retry of the one before worked", async () => {
    let done: (published: boolean) => void = () => {};
    vi.mocked(publishMuteList).mockRejectedValueOnce(new Error("boom")).mockReturnValue(new Promise((resolve) => { done = resolve; }));
    await useMuteStore.getState().mute("alice");
    await published();
    const [failed] = toasts();
    useToastStore.getState().removeToast(failed.id);
    failed.action?.run();
    setCurrentAccount("someone-else");
    done(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts()).toEqual([]);
  });

  it("does not publish, or say anything, for someone already muted", async () => {
    useMuteStore.setState({ mutedPubkeys: ["alice"] });
    await useMuteStore.getState().mute("alice");
    await published();
    expect(publishMuteList).not.toHaveBeenCalled();
  });
});
