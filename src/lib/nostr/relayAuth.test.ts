import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NDKRelay } from "@nostr-dev-kit/ndk";
import {
  describeAuthFailure,
  looksLikeSignerRefusal,
  watchRelayAuthFailures,
  getRelayAuthScope,
  setRelayAuthScope,
  shouldAuthenticate,
  pruneOrphanRelaySubscriptions,
} from "./relayAuth";
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

describe("getRelayAuthScope", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to configured-only on a clean install", () => {
    expect(getRelayAuthScope()).toBe("configured");
  });

  it("round-trips both values", () => {
    setRelayAuthScope("any");
    expect(getRelayAuthScope()).toBe("any");
    setRelayAuthScope("configured");
    expect(getRelayAuthScope()).toBe("configured");
  });

  it("fails closed on a corrupt value", () => {
    // Opposite polarity to Relay reach's default-on `!== "false"`: anything but
    // the literal "any" keeps the user's identity on their own relays.
    localStorage.setItem("wrystr_relay_auth_scope", "yes");
    expect(getRelayAuthScope()).toBe("configured");
    localStorage.setItem("wrystr_relay_auth_scope", "");
    expect(getRelayAuthScope()).toBe("configured");
  });
});

describe("shouldAuthenticate", () => {
  const CONFIGURED = new Set(["wss://relay.damus.io", "wss://private.example.invalid"]);

  it("authenticates to a relay in the stored list", () => {
    expect(shouldAuthenticate("wss://relay.damus.io", "configured", CONFIGURED, false)).toBe(true);
  });

  it("matches NDK's trailing-slash form against the stripped stored form", () => {
    // NDKRelay.url ALWAYS carries a trailing slash; storage never does. This
    // assertion deliberately does not normalize the expectation side — a
    // helper that strips both is what hid the pruner bug in v0.15.3.
    expect(shouldAuthenticate("wss://relay.damus.io/", "configured", CONFIGURED, false)).toBe(true);
    expect(shouldAuthenticate("wss://private.example.invalid/", "configured", CONFIGURED, false)).toBe(true);
  });

  it("declines a relay the user never added", () => {
    expect(shouldAuthenticate("wss://nostr.wine/", "configured", CONFIGURED, false)).toBe(false);
  });

  it("authenticates to anything when the scope is any", () => {
    expect(shouldAuthenticate("wss://nostr.wine/", "any", CONFIGURED, false)).toBe(true);
    expect(shouldAuthenticate("wss://nostr.wine/", "any", new Set(), false)).toBe(true);
  });

  it("always authenticates to the embedded relay, which is never in the list", () => {
    expect(shouldAuthenticate("ws://127.0.0.1:4869/", "configured", CONFIGURED, true)).toBe(true);
    expect(shouldAuthenticate("ws://127.0.0.1:4869/", "configured", new Set(), true)).toBe(true);
  });

  it("declines everything when the stored list is empty and scope is configured", () => {
    expect(shouldAuthenticate("wss://relay.damus.io/", "configured", new Set(), false)).toBe(false);
  });
});

describe("describeAuthFailure", () => {
  // The payload is not reliably an Error: signing rejections carry the signer's
  // message, relay OK-false carries a reason string, and NDK's own signIn policy
  // rejects with the event object.
  it("reads a plain string", () => {
    expect(describeAuthFailure("auth-required: identify yourself")).toBe("auth-required: identify yourself");
  });

  it("reads an Error", () => {
    expect(describeAuthFailure(new Error("Permission denied for sign_event kind:22242")))
      .toBe("Permission denied for sign_event kind:22242");
  });

  it("reads a bare object carrying a message", () => {
    expect(describeAuthFailure({ message: "restricted" })).toBe("restricted");
  });

  it("returns empty rather than [object Object] for anything else", () => {
    expect(describeAuthFailure(undefined)).toBe("");
    expect(describeAuthFailure(null)).toBe("");
    expect(describeAuthFailure({ kind: 22242 })).toBe("");
  });
});

describe("looksLikeSignerRefusal", () => {
  it("recognises the message Bunker46 sends for an ungranted kind", () => {
    // Its default permission set is kinds 0/1/3/4/7 — 22242 is not among them,
    // so this is what a fresh bunker connection actually returns.
    expect(looksLikeSignerRefusal("Permission denied for sign_event kind:22242")).toBe(true);
  });

  it("recognises other refusal phrasings", () => {
    expect(looksLikeSignerRefusal("not allowed")).toBe(true);
    expect(looksLikeSignerRefusal("unauthorized")).toBe(true);
  });

  it("does not claim a relay-side failure is the signer's fault", () => {
    expect(looksLikeSignerRefusal("relay closed the connection")).toBe(false);
    expect(looksLikeSignerRefusal("")).toBe(false);
  });
});

describe("watchRelayAuthFailures", () => {
  function fakeRelayWithEvents(url: string) {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    return {
      url,
      on(ev: string, cb: (...a: unknown[]) => void) { (handlers[ev] ??= []).push(cb); },
      emit(ev: string, ...args: unknown[]) { for (const cb of handlers[ev] ?? []) cb(...args); },
      handlers,
    };
  }

  function fakeInstance(relays: ReturnType<typeof fakeRelayWithEvents>[]) {
    const poolHandlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    return {
      pool: {
        relays: new Map(relays.map((r) => [r.url, r])),
        on(ev: string, cb: (...a: unknown[]) => void) { (poolHandlers[ev] ??= []).push(cb); },
        emit(ev: string, ...args: unknown[]) { for (const cb of poolHandlers[ev] ?? []) cb(...args); },
      },
    };
  }

  it("reports a failure on a relay already in the pool", () => {
    const relay = fakeRelayWithEvents("wss://a.invalid/");
    const instance = fakeInstance([relay]);
    const onFailure = vi.fn();

    watchRelayAuthFailures(instance as never, onFailure);
    relay.emit("auth:failed", new Error("Permission denied for sign_event kind:22242"));

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0]).toBe(relay);
  });

  it("reports a failure on a relay that joins later", () => {
    const instance = fakeInstance([]);
    const onFailure = vi.fn();
    watchRelayAuthFailures(instance as never, onFailure);

    const late = fakeRelayWithEvents("wss://late.invalid/");
    instance.pool.emit("relay:connect", late);
    late.emit("auth:failed", "nope");

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("attaches once even when a relay fires both pool events", () => {
    // Relays can sit in the pool before connecting, so attach runs from more
    // than one event — double-attaching would double every notice.
    const instance = fakeInstance([]);
    watchRelayAuthFailures(instance as never, vi.fn());

    const relay = fakeRelayWithEvents("wss://twice.invalid/");
    instance.pool.emit("relay:connecting", relay);
    instance.pool.emit("relay:connect", relay);

    expect(relay.handlers["auth:failed"]?.length ?? 0).toBe(1);
  });
});
