import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { NDKRelay } from "@nostr-dev-kit/ndk";
import {
  getNDK, addRelay, removeRelay, getStoredRelayUrls, RELAY_STORAGE_KEY,
  isRelayAllowed, isOutboxRelaysEnabled, setOutboxRelaysEnabled,
} from "./core";

const PUBLIC_RELAY = "wss://relay.damus.io";
const PRIVATE_RELAY = "wss://private.example.invalid";
const LOCAL_RELAY = "ws://127.0.0.1:4848";

/** NDK stores its own normalized form (trailing slash); ours is stripped. */
function hasUrl(urls: string[], url: string): boolean {
  return urls.some((u) => u.replace(/\/+$/, "") === url.replace(/\/+$/, ""));
}

function poolHas(url: string): boolean {
  const relays = getNDK().pool?.relays;
  if (!relays) return false;
  return [...relays.keys()].some((u) => u.replace(/\/+$/, "") === url.replace(/\/+$/, ""));
}

describe("relay configuration (issue #35)", () => {
  beforeAll(() => {
    // Seed before the first getNDK() — NDK reads explicitRelayUrls at construction.
    localStorage.setItem("wrystr_vega_relay_added", "1");
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([PUBLIC_RELAY]));
  });

  it("removes the relay from NDK's explicitRelayUrls, not just the pool", () => {
    const instance = getNDK();
    expect(hasUrl(instance.explicitRelayUrls, PUBLIC_RELAY)).toBe(true);

    removeRelay(PUBLIC_RELAY);

    // The pool entry going away was never the problem — NDK rebuilds the relay
    // set from explicitRelayUrls on the next subscription and brings it back.
    expect(poolHas(PUBLIC_RELAY)).toBe(false);
    expect(hasUrl(instance.explicitRelayUrls, PUBLIC_RELAY)).toBe(false);
    expect(hasUrl(getStoredRelayUrls(), PUBLIC_RELAY)).toBe(false);
  });

  it("adds a new relay to explicitRelayUrls so subscriptions actually reach it", () => {
    const instance = getNDK();
    addRelay(PRIVATE_RELAY);

    expect(hasUrl(instance.explicitRelayUrls, PRIVATE_RELAY)).toBe(true);
    expect(poolHas(PRIVATE_RELAY)).toBe(true);
    expect(hasUrl(getStoredRelayUrls(), PRIVATE_RELAY)).toBe(true);
  });

  it("does not add duplicate entries when a relay is added twice", () => {
    const instance = getNDK();
    addRelay(PRIVATE_RELAY);

    const matches = instance.explicitRelayUrls.filter(
      (u) => u.replace(/\/+$/, "") === PRIVATE_RELAY,
    );
    expect(matches).toHaveLength(1);
    expect(getStoredRelayUrls().filter((u) => u === PRIVATE_RELAY)).toHaveLength(1);
  });

  it("keeps the embedded local relay in the pool across relay-list edits", () => {
    const instance = getNDK();
    // localRelay.ts adds this to the pool but deliberately never to the stored
    // list. Assigning instance.explicitRelayUrls would clear the pool and drop it.
    instance.pool?.addRelay(new NDKRelay(LOCAL_RELAY, undefined, instance), false);
    expect(poolHas(LOCAL_RELAY)).toBe(true);

    addRelay("wss://nos.lol");
    removeRelay("wss://nos.lol");

    expect(poolHas(LOCAL_RELAY)).toBe(true);
    expect(hasUrl(getStoredRelayUrls(), LOCAL_RELAY)).toBe(false);
  });
});

describe("relayConnectionFilter (issue #35 — outbox expansion)", () => {
  afterEach(() => setOutboxRelaysEnabled(false));

  it("defaults to outbox off", () => {
    localStorage.removeItem("wrystr_use_author_relays");
    expect(isOutboxRelaysEnabled()).toBe(false);
  });

  it("is installed on the NDK instance so NDK actually consults it", () => {
    // Without this wiring the filter is dead code: NDK only prunes
    // outbox-discovered author relays when ndk.relayConnectionFilter is set.
    expect(typeof getNDK().relayConnectionFilter).toBe("function");
  });

  it("rejects a relay that is not in the configured list", () => {
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([PRIVATE_RELAY]));
    expect(isRelayAllowed(PRIVATE_RELAY)).toBe(true);
    // This is the follows'-relay case: 29 of these showed up on the Following tab.
    expect(isRelayAllowed("wss://relay.damus.io")).toBe(false);
    expect(isRelayAllowed("wss://some.random.relay")).toBe(false);
  });

  it("always allows the embedded local relay, which is never in the list", () => {
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([PRIVATE_RELAY]));
    expect(isRelayAllowed("ws://127.0.0.1:4869")).toBe(true);
    expect(isRelayAllowed("ws://localhost:4869")).toBe(true);
  });

  it("matches regardless of trailing slash", () => {
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([PRIVATE_RELAY]));
    expect(isRelayAllowed(PRIVATE_RELAY + "/")).toBe(true);
  });

  it("allows everything once the user opts into authors' relays", () => {
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([PRIVATE_RELAY]));
    setOutboxRelaysEnabled(true);
    expect(isRelayAllowed("wss://relay.damus.io")).toBe(true);
  });

  it("picks up relay-list edits without a restart", () => {
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([PRIVATE_RELAY]));
    expect(isRelayAllowed("wss://added.example.invalid")).toBe(false);
    addRelay("wss://added.example.invalid");
    // A stale allowlist cache here would keep rejecting a relay the user just added.
    expect(isRelayAllowed("wss://added.example.invalid")).toBe(true);
    removeRelay("wss://added.example.invalid");
    expect(isRelayAllowed("wss://added.example.invalid")).toBe(false);
  });
});
