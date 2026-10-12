import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("./nostr", () => ({ publishRepost: vi.fn() }));

import { repostNote } from "./repost";
import { publishRepost } from "./nostr";
import { setCurrentAccount } from "./currentAccount";
import { repostKey, useRepostedStore } from "../stores/reposted";
import { useToastStore } from "../stores/toast";

const NOTE = { id: "note-1", pubkey: "author", content: "hello", kind: 1, tags: [] } as unknown as NDKEvent;
const OTHER = { ...NOTE, id: "note-2" } as unknown as NDKEvent;
const NO_RELAYS = new Error("Not enough relays received the event (0 published, 1 required)");
const toasts = () => useToastStore.getState().toasts;
const stateOf = (pubkey: string, note: NDKEvent) => useRepostedStore.getState().byKey[repostKey(pubkey, note.id)];
/** The app switches account. */
const signInAs = (pubkey: string | null) => { setCurrentAccount(pubkey); };

beforeEach(() => {
  vi.mocked(publishRepost).mockReset().mockResolvedValue(undefined as never);
  useRepostedStore.setState({ byKey: {} });
  useToastStore.setState({ toasts: [] });
  signInAs("alice");
});

describe("repostNote", () => {
  it("reposts, records it for that account, and says nothing more", async () => {
    await repostNote("alice", NOTE);
    expect(publishRepost).toHaveBeenCalledWith(NOTE);
    expect(stateOf("alice", NOTE)).toBe("done");
    expect(toasts()).toEqual([]);
  });

  it("does not repost a note twice for one account, however it is reached", async () => {
    await repostNote("alice", NOTE);
    await repostNote("alice", NOTE);
    expect(publishRepost).toHaveBeenCalledTimes(1);
  });

  it("does not start a second repost while the first is on its way", async () => {
    let finish: () => void = () => {};
    vi.mocked(publishRepost).mockImplementation(() => new Promise<never>((resolve) => { finish = () => resolve(undefined as never); }));
    const first = repostNote("alice", NOTE);
    expect(stateOf("alice", NOTE)).toBe("pending");
    await repostNote("alice", NOTE);
    expect(publishRepost).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });

  it("says so when no relay took it, releases the claim, and offers to try again", async () => {
    vi.mocked(publishRepost).mockRejectedValueOnce(NO_RELAYS);
    await repostNote("alice", NOTE);
    expect(stateOf("alice", NOTE)).toBeUndefined();
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].type).toBe("error");
    expect(toasts()[0].message).toContain("Nothing was reposted.");
    expect(toasts()[0].action?.label).toBe("Try again");
    toasts()[0].action?.run();
    await vi.waitFor(() => expect(stateOf("alice", NOTE)).toBe("done"));
    expect(publishRepost).toHaveBeenCalledTimes(2);
  });

  // The same words for both. Merged on the words, "Try again" retried only the last.
  it("keeps two failed reposts as two toasts, each retrying its own note", async () => {
    vi.mocked(publishRepost).mockRejectedValue(NO_RELAYS);
    await repostNote("alice", NOTE);
    await repostNote("alice", OTHER);
    expect(toasts()).toHaveLength(2);
    vi.mocked(publishRepost).mockReset().mockResolvedValue(undefined as never);
    toasts()[0].action?.run();
    await vi.waitFor(() => expect(publishRepost).toHaveBeenCalledTimes(1));
    expect(publishRepost).toHaveBeenCalledWith(NOTE);
  });

  // The repost would be signed by whoever is signed in now, and recorded under the other.
  it("Try again does nothing, and says so, once the account has changed", async () => {
    vi.mocked(publishRepost).mockRejectedValueOnce(NO_RELAYS);
    await repostNote("alice", NOTE);
    const retry = toasts()[0].action;
    signInAs("bob");
    retry?.run();
    await Promise.resolve();
    expect(publishRepost).toHaveBeenCalledTimes(1);
    expect(stateOf("alice", NOTE)).toBeUndefined();
    expect(stateOf("bob", NOTE)).toBeUndefined();
    expect(toasts().map((t) => t.message)).toContain("That was for another account, so nothing was done.");
  });

  // The publish takes seconds. What comes back after a switch is not the new account's to hear.
  it("says nothing to the next account when the repost of the one before fails", async () => {
    let fail: (err: Error) => void = () => {};
    vi.mocked(publishRepost).mockImplementation(() => new Promise<never>((_, reject) => { fail = reject; }));
    const sent = repostNote("alice", NOTE);
    signInAs("bob");
    fail(NO_RELAYS);
    await sent;
    expect(toasts()).toEqual([]);
    expect(stateOf("alice", NOTE)).toBeUndefined(); // the claim is released all the same
  });

  it("records a repost for the account that made it although the account changed on the way", async () => {
    let finish: () => void = () => {};
    vi.mocked(publishRepost).mockImplementation(() => new Promise<never>((resolve) => { finish = () => resolve(undefined as never); }));
    const sent = repostNote("alice", NOTE);
    signInAs("bob");
    finish();
    await sent;
    expect(stateOf("alice", NOTE)).toBe("done");
    expect(stateOf("bob", NOTE)).toBeUndefined();
  });

  it("refuses to repost for an account that is not the one signed in", async () => {
    await repostNote("bob", NOTE);
    expect(publishRepost).not.toHaveBeenCalled();
    expect(stateOf("bob", NOTE)).toBeUndefined();
  });
});
