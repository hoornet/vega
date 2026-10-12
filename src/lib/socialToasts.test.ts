import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FollowOutcome } from "../stores/user";

const user = vi.hoisted(() => ({
  follow: (() => Promise.resolve("done")) as (pk: string) => Promise<string>,
  unfollow: (() => Promise.resolve("done")) as (pk: string) => Promise<string>,
}));
const mutes = vi.hoisted(() => ({ mute: (() => Promise.resolve()) as (pk: string) => Promise<void>, unmute: (() => Promise.resolve()) as (pk: string) => Promise<void> }));
vi.mock("../stores/user", () => ({ useUserStore: { getState: () => user } }));
vi.mock("../stores/mute", () => ({ useMuteStore: { getState: () => mutes } }));

import { setFollowing, setMuted } from "./socialToasts";
import { setCurrentAccount } from "./currentAccount";
import { useToastStore } from "../stores/toast";

const toasts = () => useToastStore.getState().toasts;
const messages = () => toasts().map((t) => t.message);
const ending = (outcome: FollowOutcome) => vi.fn(async () => outcome);

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  setCurrentAccount("me");
  Object.assign(user, { follow: ending("done"), unfollow: ending("done") });
  Object.assign(mutes, { mute: vi.fn(async () => {}), unmute: vi.fn(async () => {}) });
});

describe("setFollowing", () => {
  it("follows, then says so with a way back", async () => {
    await setFollowing("alice", "Alice", true);
    expect(user.follow).toHaveBeenCalledWith("alice");
    expect(messages()).toEqual(["Following Alice."]);
    expect(toasts()[0].type).toBe("success");
    expect(toasts()[0].action?.label).toBe("Undo");
  });

  it("unfollows, then says so with a way back", async () => {
    await setFollowing("alice", "Alice", false);
    expect(user.unfollow).toHaveBeenCalledWith("alice");
    expect(messages()).toEqual(["Unfollowed Alice."]);
    expect(toasts()[0].action?.label).toBe("Undo");
  });

  it("Undo does the reverse, says so in the same toast, and offers no undo of the undo", async () => {
    await setFollowing("alice", "Alice", true);
    toasts()[0].action?.run();
    await vi.waitFor(() => expect(messages()).toEqual(["Unfollowed Alice."]));
    expect(user.unfollow).toHaveBeenCalledWith("alice");
    expect(toasts()[0].action).toBeUndefined();
  });

  // The store has said why. A second toast claiming it worked would be a lie.
  // It used to look at the list afterwards: after a failed publish the list
  // is put back to what the relays hold, which may already have the person.
  it("says nothing when the store says it failed", async () => {
    user.follow = ending("failed");
    await setFollowing("alice", "Alice", true);
    expect(messages()).toEqual([]);
  });

  // The account changed while it waited its turn. It was the other account's.
  it("says nothing when it was dropped", async () => {
    user.unfollow = ending("dropped");
    await setFollowing("alice", "Alice", false);
    expect(messages()).toEqual([]);
  });

  // A follow takes seconds to publish. Read after it, "the account" is the
  // new one, and it was handed an Undo for what the old one did.
  it("says nothing to the next account when the account changes while the follow is on its way", async () => {
    let finish: (outcome: FollowOutcome) => void = () => {};
    user.follow = vi.fn(() => new Promise<FollowOutcome>((resolve) => { finish = resolve; }));
    const following = setFollowing("alice", "Alice", true);
    setCurrentAccount("someone-else");
    finish("done");
    await following;
    expect(messages()).toEqual([]);
  });

  it("binds Undo to the account that followed, not to the one signed in when the toast is raised", async () => {
    await setFollowing("alice", "Alice", true);
    const undo = toasts()[0].action;
    expect(undo?.forAccount).toBe(true);
    setCurrentAccount("someone-else");
    setCurrentAccount("me");
    undo?.run();
    await vi.waitFor(() => expect(user.unfollow).toHaveBeenCalledWith("alice"));
  });

  // Two people with one display name are two toasts, each with its own Undo.
  it("keeps the toasts for two people with the same name apart", async () => {
    await setFollowing("alice-1", "Alice", true);
    await setFollowing("alice-2", "Alice", true);
    expect(messages()).toEqual(["Following Alice.", "Following Alice."]);
    toasts()[0].action?.run();
    await vi.waitFor(() => expect(user.unfollow).toHaveBeenCalledWith("alice-1"));
    expect(user.unfollow).not.toHaveBeenCalledWith("alice-2");
  });

  // "I followed from the wrong account": switch, then press Undo. It would
  // have unfollowed for the account now signed in.
  it("Undo does nothing, and says so, once the account has changed", async () => {
    await setFollowing("alice", "Alice", true);
    const undo = toasts()[0].action;
    setCurrentAccount("someone-else");
    undo?.run();
    await Promise.resolve();
    expect(user.unfollow).not.toHaveBeenCalled();
    expect(messages()).toContain("That was for another account, so nothing was done.");
  });
});

describe("setMuted", () => {
  it("mutes at once, and says so with a way back", () => {
    setMuted("alice", "Alice", true);
    expect(mutes.mute).toHaveBeenCalledWith("alice");
    expect(messages()).toEqual(["Muted Alice."]);
    expect(toasts()[0].action?.label).toBe("Undo");
  });

  it("unmutes, and says so with a way back", () => {
    setMuted("alice", "Alice", false);
    expect(mutes.unmute).toHaveBeenCalledWith("alice");
    expect(messages()).toEqual(["Unmuted Alice."]);
    expect(toasts()[0].action?.label).toBe("Undo");
  });

  it("Undo does the reverse, says so in the same toast, and offers no undo of the undo", () => {
    setMuted("alice", "Alice", true);
    toasts()[0].action?.run();
    expect(mutes.unmute).toHaveBeenCalledWith("alice");
    expect(messages()).toEqual(["Unmuted Alice."]);
    expect(toasts()[0].action).toBeUndefined();
  });

  it("keeps the toasts for two people with the same name apart", () => {
    setMuted("alice-1", "Alice", true);
    setMuted("alice-2", "Alice", true);
    expect(toasts()).toHaveLength(2);
    toasts()[0].action?.run();
    expect(mutes.unmute).toHaveBeenCalledWith("alice-1");
    expect(mutes.unmute).not.toHaveBeenCalledWith("alice-2");
  });

  it("Undo does nothing, and says so, once the account has changed", () => {
    setMuted("alice", "Alice", true);
    const undo = toasts()[0].action;
    setCurrentAccount(null);
    undo?.run();
    expect(mutes.unmute).not.toHaveBeenCalled();
    expect(messages()).toContain("That was for another account, so nothing was done.");
  });
});

describe("someone else's name in a sentence of ours", () => {
  // A display name can be any length. Two thousand characters covered the window.
  it("is cut to a length that fits", () => {
    setMuted("long", "A".repeat(2000), true);
    expect(messages()[0]).toBe(`Muted ${"A".repeat(39)}…`);
    expect(messages()[0].length).toBeLessThan(50);
  });

  // The fallback for someone with no name ends in an ellipsis already.
  it("does not end in an ellipsis and a full stop", async () => {
    await setFollowing("pk", "1a2b3c4d…", true);
    expect(messages()).toEqual(["Following 1a2b3c4d…"]);
  });

  it("trims the name", () => {
    setMuted("alice", "  Alice  ", false);
    expect(messages()).toEqual(["Unmuted Alice."]);
  });
});
