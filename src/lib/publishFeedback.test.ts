import { describe, it, expect, beforeEach } from "vitest";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { tellPublish } from "./publishFeedback";
import { useToastStore } from "../stores/toast";
import { useUIStore } from "../stores/ui";
import { setCurrentAccount } from "./currentAccount";

const toasts = () => useToastStore.getState().toasts;
const NO_RELAYS = new Error("Not enough relays received the event (0 published, 1 required)");
const NOTE = { id: "n1", content: "a comment", kind: 1, pubkey: "me", tags: [] } as unknown as NDKEvent;

beforeEach(() => {
  setCurrentAccount("me");
  useToastStore.setState({ toasts: [] });
  useUIStore.setState({ currentView: "feed", selectedNote: null, viewStack: [] });
});

describe("tellPublish", () => {
  it("hands back what was published", async () => {
    expect(await tellPublish(async () => NOTE, { kept: "Your reply is still in the box." })).toEqual({ ok: true, value: NOTE });
  });

  // Where the result shows on screen by itself, a toast as well is noise.
  it("says nothing on success unless asked to", async () => {
    await tellPublish(async () => NOTE, { kept: "Your reply is still in the box." });
    expect(toasts()).toEqual([]);
  });

  it("says it worked when asked to", async () => {
    const told = await tellPublish(async () => undefined, { done: "Relay list published.", kept: "Your relays here are unchanged." });
    expect(told.ok).toBe(true);
    expect(toasts().map((t) => [t.type, t.message, t.action])).toEqual([["success", "Relay list published.", undefined]]);
  });

  it("offers to open what was published when it is a note", async () => {
    await tellPublish(async () => NOTE, { done: "Comment posted.", kept: "Your comment is still in the box.", view: (note) => note });
    expect(toasts()[0].action?.label).toBe("View");
    toasts()[0].action!.run();
    expect(useUIStore.getState().currentView).toBe("thread");
    expect(useUIStore.getState().selectedNote).toBe(NOTE);
  });

  // Merged on the words, the second "Comment posted." took the first one's
  // place, and its View opened the wrong comment.
  it("keeps two notes published in a row as two toasts, each opening its own", async () => {
    const second = { ...NOTE, id: "n2" } as unknown as NDKEvent;
    await tellPublish(async () => NOTE, { done: "Comment posted.", kept: "Kept.", view: (note) => note });
    await tellPublish(async () => second, { done: "Comment posted.", kept: "Kept.", view: (note) => note });
    expect(toasts().map((t) => t.key)).toEqual(["posted:n1", "posted:n2"]);
    toasts()[0].action!.run();
    expect(useUIStore.getState().selectedNote).toBe(NOTE);
    toasts()[1].action!.run();
    expect(useUIStore.getState().selectedNote).toBe(second);
  });

  it("is one toast for the same words when there is nothing to open", async () => {
    await tellPublish(async () => undefined, { done: "Relay list published.", kept: "Kept." });
    await tellPublish(async () => undefined, { done: "Relay list published.", kept: "Kept." });
    expect(toasts()).toHaveLength(1);
  });

  // The whole point: these failed in silence.
  it("says why, in plain words, when it failed, and what became of the work", async () => {
    const told = await tellPublish(async () => { throw NO_RELAYS; }, { done: "Comment posted.", kept: "Your comment is still in the box." });
    expect(told).toEqual({ ok: false });
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].type).toBe("error");
    expect(toasts()[0].message).toBe("Couldn't publish: none of your relays accepted it. Your comment is still in the box. Check your relays and try again.");
  });

  it("does not say it worked when it failed", async () => {
    await tellPublish(async () => { throw new Error("boom"); }, { done: "Relay list published.", kept: "Your relays here are unchanged." });
    expect(toasts().map((t) => t.message)).not.toContain("Relay list published.");
  });

  // A publish takes seconds. What comes back after an account switch is not
  // the new account's to hear: "Your vote was not counted." of a vote it never cast.
  it("says nothing to the next account when it fails after the account changed", async () => {
    let fail: (err: Error) => void = () => {};
    const told = tellPublish(() => new Promise<never>((_, reject) => { fail = reject; }), { kept: "Your vote was not counted." });
    setCurrentAccount("someone-else");
    fail(NO_RELAYS);
    expect(await told).toEqual({ ok: false });
    expect(toasts()).toEqual([]);
  });

  it("says nothing to the next account when it works after the account changed, and still hands back the result", async () => {
    let finish: (note: NDKEvent) => void = () => {};
    const told = tellPublish(() => new Promise<NDKEvent>((resolve) => { finish = resolve; }), { done: "Comment posted.", kept: "Kept.", view: (note) => note });
    setCurrentAccount("someone-else");
    finish(NOTE);
    expect(await told).toEqual({ ok: true, value: NOTE });
    expect(toasts()).toEqual([]);
  });

  it("never throws", async () => {
    await expect(tellPublish(() => Promise.reject("a string, not an Error"), { kept: "Nothing was lost." })).resolves.toEqual({ ok: false });
  });

  it("words the failure with the verb it is given", async () => {
    await tellPublish(async () => { throw NO_RELAYS; }, { kept: "Your vote was not counted.", verb: "send" });
    expect(toasts()[0].message).toBe("Couldn't send: none of your relays accepted it. Your vote was not counted. Check your relays and try again.");
  });
});
