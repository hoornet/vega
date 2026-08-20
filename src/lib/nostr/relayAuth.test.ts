import { describe, it, expect, vi } from "vitest";
import type { NDKRelay } from "@nostr-dev-kit/ndk";
import { pruneOrphanRelaySubscriptions } from "./relayAuth";
import { isLocalRelayUrl } from "./core";

/** NDKRelaySubscriptionStatus, which NDK does not export at runtime. */
const INITIAL = 0;
const PENDING = 1;
const RUNNING = 3;
const CLOSED = 4;

function relaySub(subId: string, status: number, itemCount: number) {
  const items = new Map<string, unknown>();
  for (let i = 0; i < itemCount; i++) items.set(`${subId}-item-${i}`, {});
  return { subId, status, items, cleanup: vi.fn() };
}

/**
 * Only the surface `pruneOrphanRelaySubscriptions` touches: the subscription
 * manager's grouped map, and `relay.close(subId)` — the public route to a CLOSE
 * frame, since `NDKRelaySubscription.close` is TS-private.
 */
function fakeRelay(subs: ReturnType<typeof relaySub>[]) {
  return {
    url: "wss://relay.example.invalid/",
    close: vi.fn(),
    subs: { subscriptions: new Map([["fingerprint-a", subs]]) },
  };
}

describe("pruneOrphanRelaySubscriptions", () => {
  it("prunes a RUNNING subscription that holds no items", () => {
    const ghost = relaySub("ghost", RUNNING, 0);
    const relay = fakeRelay([ghost]);

    const pruned = pruneOrphanRelaySubscriptions(relay as unknown as NDKRelay);

    expect(pruned).toBe(1);
    // CLOSE must actually reach the wire — NDK's removeItem skips it, which is
    // half the bug this exists for.
    expect(relay.close).toHaveBeenCalledWith("ghost");
    // cleanup() is what detaches the `authed` listener that would otherwise
    // re-REQ with an empty filter set.
    expect(ghost.cleanup).toHaveBeenCalledTimes(1);
  });

  it("leaves a RUNNING subscription that still has items", () => {
    const live = relaySub("live", RUNNING, 2);
    const relay = fakeRelay([live]);

    expect(pruneOrphanRelaySubscriptions(relay as unknown as NDKRelay)).toBe(0);
    expect(relay.close).not.toHaveBeenCalled();
    expect(live.cleanup).not.toHaveBeenCalled();
  });

  it.each([
    ["INITIAL", INITIAL],
    ["PENDING", PENDING],
    ["CLOSED", CLOSED],
  ])("leaves an empty subscription in %s alone", (_name, status) => {
    // INITIAL/PENDING are mid-setup and may still receive their items; pruning
    // them would race subscription creation. CLOSED is already done.
    const sub = relaySub("pending", status, 0);
    const relay = fakeRelay([sub]);

    expect(pruneOrphanRelaySubscriptions(relay as unknown as NDKRelay)).toBe(0);
    expect(relay.close).not.toHaveBeenCalled();
  });

  it("prunes only the ghosts when a relay holds a mix", () => {
    const ghostA = relaySub("ghost-a", RUNNING, 0);
    const ghostB = relaySub("ghost-b", RUNNING, 0);
    const live = relaySub("live", RUNNING, 1);
    const relay = fakeRelay([ghostA, live, ghostB]);

    expect(pruneOrphanRelaySubscriptions(relay as unknown as NDKRelay)).toBe(2);
    expect(relay.close).toHaveBeenCalledWith("ghost-a");
    expect(relay.close).toHaveBeenCalledWith("ghost-b");
    expect(relay.close).not.toHaveBeenCalledWith("live");
  });

  it("survives a relay with no subscription manager", () => {
    expect(pruneOrphanRelaySubscriptions({ url: "wss://x.invalid/" } as unknown as NDKRelay)).toBe(0);
  });

  it("keeps pruning after one subscription throws", () => {
    const bad = relaySub("bad", RUNNING, 0);
    bad.cleanup.mockImplementation(() => { throw new Error("boom"); });
    const good = relaySub("good", RUNNING, 0);
    const relay = fakeRelay([bad, good]);

    // One failure must not strand the rest — these discharge as malformed REQs.
    expect(pruneOrphanRelaySubscriptions(relay as unknown as NDKRelay)).toBe(1);
    expect(relay.close).toHaveBeenCalledWith("good");
  });
});

describe("isLocalRelayUrl", () => {
  // Deliberately NOT normalizing both sides before comparing: NDKRelay.url
  // always carries a trailing slash while stored URLs never do, and a helper
  // that strips both is exactly what hid the pruner bug (CLAUDE.md).
  it("matches the embedded relay in both URL forms", () => {
    expect(isLocalRelayUrl("ws://127.0.0.1:4869")).toBe(true);
    expect(isLocalRelayUrl("ws://127.0.0.1:4869/")).toBe(true);
    expect(isLocalRelayUrl("ws://localhost:4869")).toBe(true);
    expect(isLocalRelayUrl("ws://localhost:4869/")).toBe(true);
  });

  it("does not match public relays", () => {
    expect(isLocalRelayUrl("wss://relay.damus.io")).toBe(false);
    expect(isLocalRelayUrl("wss://nos.lol/")).toBe(false);
  });

  it("does not match a remote host that merely mentions localhost", () => {
    expect(isLocalRelayUrl("wss://localhost.example.com/")).toBe(false);
    expect(isLocalRelayUrl("wss://127.0.0.1.example.com/")).toBe(false);
  });
});
