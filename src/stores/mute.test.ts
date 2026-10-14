import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/nostr", () => ({ fetchReplaceableList: vi.fn(), publishReplaceableList: vi.fn() }));

import { useMuteStore } from "./mute";
import { useToastStore } from "./toast";
import { fetchReplaceableList, publishReplaceableList } from "../lib/nostr";
import { setCurrentAccount } from "../lib/currentAccount";

const toasts = () => useToastStore.getState().toasts;
const said = () => toasts().map((t) => [t.type, t.message]);
const muted = () => useMuteStore.getState().mutedPubkeys;
/** Past the one-second pause before the list is published, and the publish itself. */
const published = async () => { await vi.advanceTimersByTimeAsync(1100); };
const list = (tags: string[][], content = "", createdAt = 100) => ({ status: "found" as const, list: { tags, content, createdAt } });
const relaysHold = (tags: string[][], content = "", createdAt = 100) => vi.mocked(fetchReplaceableList).mockResolvedValue(list(tags, content, createdAt));
const relaysHoldNone = () => vi.mocked(fetchReplaceableList).mockResolvedValue({ status: "none" });
const relaysCannotTell = () => vi.mocked(fetchReplaceableList).mockResolvedValue({ status: "unknown" });
const lastPublished = () => { const calls = vi.mocked(publishReplaceableList).mock.calls; return calls[calls.length - 1]; };
const MUTE_FAILED = "Couldn't publish your mute list. The mute is on this device only until it goes out; Vega will try again when it next starts.";
const UNMUTE_FAILED = "Couldn't publish your mute list. The unmute is on this device only until it goes out; Vega will try again when it next starts.";

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(publishReplaceableList).mockReset().mockResolvedValue(true);
  relaysHoldNone();
  await vi.advanceTimersByTimeAsync(2000); // nothing left over from the test before
  vi.mocked(publishReplaceableList).mockClear();
  vi.mocked(fetchReplaceableList).mockClear();
  useMuteStore.setState({ mutedPubkeys: [], listFor: "me" });
  useToastStore.setState({ toasts: [] });
  setCurrentAccount("me");
});
afterEach(() => { vi.useRealTimers(); });

describe("reading the mute list", () => {
  it("shows the relays' list, every relay asked on its own", async () => {
    relaysHold([["p", "a"], ["t", "spam"], ["p", "b"]], "encrypted-private-mutes");
    await useMuteStore.getState().fetchMuteList("me");
    expect(fetchReplaceableList).toHaveBeenCalledWith(10000, "me");
    expect(muted()).toEqual(["a", "b"]);
    expect(publishReplaceableList).not.toHaveBeenCalled();
  });

  it("keeps what it read before when the relays cannot tell, and shows nothing for an account never read", async () => {
    relaysHold([["p", "a"]]);
    await useMuteStore.getState().fetchMuteList("me");
    relaysCannotTell();
    await useMuteStore.getState().fetchMuteList("me");
    expect(muted()).toEqual(["a"]);
    setCurrentAccount("other");
    await useMuteStore.getState().fetchMuteList("other");
    expect(muted()).toEqual([]);
    expect(useMuteStore.getState().listFor).toBe("other");
  });

  it("does not take an older list over what this device last published", async () => {
    relaysHold([["p", "a"]], "", 100);
    await useMuteStore.getState().fetchMuteList("me");
    relaysHold([], "", 50);
    await useMuteStore.getState().fetchMuteList("me");
    expect(muted()).toEqual(["a"]);
  });

  it("takes the mutes an older build kept on this computer as this account's, once", async () => {
    localStorage.setItem("wrystr_mutes", JSON.stringify(["old"]));
    relaysHold([["p", "a"]]);
    await useMuteStore.getState().fetchMuteList("me");
    expect(muted()).toEqual(["a", "old"]);
    expect(lastPublished()).toEqual([10000, [["p", "a"], ["p", "old"]], ""]);
  });
});

describe("muting and the relays", () => {
  it("mutes on this device at once, and publishes the relays' list with the change a second later, content and other tags kept", async () => {
    relaysHold([["p", "a"], ["t", "spam"], ["word", "crypto"]], "secret");
    await useMuteStore.getState().fetchMuteList("me");
    vi.mocked(fetchReplaceableList).mockClear();
    await useMuteStore.getState().mute("x");
    expect(muted()).toEqual(["a", "x"]);
    expect(publishReplaceableList).not.toHaveBeenCalled();
    await published();
    // Read again before publishing: the newest list the relays hold is the base.
    expect(fetchReplaceableList).toHaveBeenCalledTimes(1);
    expect(lastPublished()).toEqual([10000, [["p", "a"], ["t", "spam"], ["word", "crypto"], ["p", "x"]], "secret"]);
    expect(said()).toEqual([]);
  });

  it("applies the change to a list another device changed meanwhile", async () => {
    relaysHold([["p", "a"]]);
    await useMuteStore.getState().fetchMuteList("me");
    await useMuteStore.getState().mute("x");
    // Another device muted "b" while this one was thinking.
    relaysHold([["p", "a"], ["p", "b"]], "", 200);
    await published();
    expect(lastPublished()).toEqual([10000, [["p", "a"], ["p", "b"], ["p", "x"]], ""]);
    expect(muted()).toEqual(["a", "b", "x"]);
  });

  it("publishes once for a mute and its undo in quick succession, with the list as it ends up", async () => {
    relaysHold([["p", "a"]]);
    await useMuteStore.getState().fetchMuteList("me");
    await useMuteStore.getState().mute("x");
    await useMuteStore.getState().unmute("x");
    await useMuteStore.getState().unmute("a");
    await published();
    expect(publishReplaceableList).toHaveBeenCalledTimes(1);
    expect(lastPublished()).toEqual([10000, [], ""]);
    expect(muted()).toEqual([]);
  });

  // The follow-list accident: a list of one published over a longer one the relays could not be asked about.
  it("publishes nothing while the relays' list is not known, keeps the mute here, and says so", async () => {
    relaysCannotTell();
    await useMuteStore.getState().fetchMuteList("me");
    await useMuteStore.getState().mute("x");
    expect(muted()).toEqual(["x"]);
    await published();
    expect(publishReplaceableList).not.toHaveBeenCalled();
    expect(said()).toEqual([["error", "Couldn't publish your mute list: the list on your relays could not be read. The change is kept on this device, and Vega will try again when it next starts."]]);
    // Read at the next start: the change goes out on top of what the relays hold.
    useToastStore.setState({ toasts: [] });
    relaysHold([["p", "a"], ["p", "b"]]);
    await useMuteStore.getState().fetchMuteList("me");
    expect(lastPublished()).toEqual([10000, [["p", "a"], ["p", "b"], ["p", "x"]], ""]);
    expect(muted()).toEqual(["a", "b", "x"]);
  });

  it("starts a list when every relay answered that there is none", async () => {
    await useMuteStore.getState().fetchMuteList("me");
    await useMuteStore.getState().mute("x");
    await published();
    expect(lastPublished()).toEqual([10000, [["p", "x"]], ""]);
  });

  it("says so when a mute could not be published, and keeps the mute here for the next start", async () => {
    await useMuteStore.getState().fetchMuteList("me");
    vi.mocked(publishReplaceableList).mockRejectedValue(new Error("no relay"));
    await useMuteStore.getState().mute("x");
    await published();
    expect(muted()).toEqual(["x"]);
    expect(said()).toEqual([["error", MUTE_FAILED]]);
    expect(localStorage.getItem("wrystr_mute_changes_me")).toContain("x");
  });

  it("says something different, and true, when an unmute could not be published, and the unmute holds here", async () => {
    relaysHold([["p", "a"]]);
    await useMuteStore.getState().fetchMuteList("me");
    vi.mocked(publishReplaceableList).mockRejectedValue(new Error("no relay"));
    await useMuteStore.getState().unmute("a");
    await published();
    expect(said()).toEqual([["error", UNMUTE_FAILED]]);
    // Read again: the relays still have "a", and this device still says no.
    useToastStore.setState({ toasts: [] });
    vi.mocked(publishReplaceableList).mockResolvedValue(true);
    await useMuteStore.getState().fetchMuteList("me");
    expect(muted()).toEqual([]);
    expect(lastPublished()).toEqual([10000, [], ""]);
  });

  it("Try again publishes the change on the list as the relays hold it now, and says so when it works", async () => {
    await useMuteStore.getState().fetchMuteList("me");
    vi.mocked(publishReplaceableList).mockRejectedValue(new Error("no relay"));
    await useMuteStore.getState().mute("x");
    await published();
    const retry = toasts()[0].action!;
    vi.mocked(publishReplaceableList).mockResolvedValue(true);
    relaysHold([["p", "b"]]);
    retry.run();
    await vi.advanceTimersByTimeAsync(10);
    expect(lastPublished()).toEqual([10000, [["p", "b"], ["p", "x"]], ""]);
    expect(said()).toEqual([["success", "Mute list published."]]);
    expect(localStorage.getItem("wrystr_mute_changes_me")).toBe(JSON.stringify({}));
  });

  it("says why when a retry had nothing to sign with, and not that it worked", async () => {
    await useMuteStore.getState().fetchMuteList("me");
    vi.mocked(publishReplaceableList).mockRejectedValue(new Error("no relay"));
    await useMuteStore.getState().mute("x");
    await published();
    const retry = toasts()[0].action!;
    vi.mocked(publishReplaceableList).mockResolvedValue(false);
    retry.run();
    await vi.advanceTimersByTimeAsync(10);
    expect(said()).toEqual([["error", "Couldn't publish your mute list: you are not signed in with a key that can sign."]]);
  });

  it("says nothing when the first try had nothing to sign with, and keeps the change for later", async () => {
    await useMuteStore.getState().fetchMuteList("me");
    vi.mocked(publishReplaceableList).mockResolvedValue(false);
    await useMuteStore.getState().mute("x");
    await published();
    expect(said()).toEqual([]);
    expect(localStorage.getItem("wrystr_mute_changes_me")).toContain("x");
  });

  it("takes the failure down when the list goes out with a later change", async () => {
    await useMuteStore.getState().fetchMuteList("me");
    vi.mocked(publishReplaceableList).mockRejectedValueOnce(new Error("no relay"));
    await useMuteStore.getState().mute("x");
    await published();
    expect(said()).toHaveLength(1);
    await useMuteStore.getState().mute("y");
    await published();
    expect(said()).toEqual([]);
    expect(lastPublished()).toEqual([10000, [["p", "x"], ["p", "y"]], ""]);
  });

  it("does not publish a change as the next account, and keeps it for the one that made it", async () => {
    await useMuteStore.getState().fetchMuteList("me");
    await useMuteStore.getState().mute("x");
    setCurrentAccount("other");
    await published();
    expect(publishReplaceableList).not.toHaveBeenCalled();
    expect(localStorage.getItem("wrystr_mute_changes_me")).toContain("x");
  });

  it("keeps a change made while a publish was on its way", async () => {
    await useMuteStore.getState().fetchMuteList("me");
    let finish: (v: boolean) => void = () => {};
    vi.mocked(publishReplaceableList).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await useMuteStore.getState().mute("x");
    await published();
    await useMuteStore.getState().mute("y");
    finish(true);
    await vi.advanceTimersByTimeAsync(1100);
    expect(lastPublished()).toEqual([10000, [["p", "x"], ["p", "y"]], ""]);
  });
});
