import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { NDKRelay } from "@nostr-dev-kit/ndk";
import {
  getNDK, addRelay, removeRelay, getStoredRelayUrls, RELAY_STORAGE_KEY, RETIRED_VEGA_RELAY,
  isRelayAllowed, isOutboxRelaysEnabled, setOutboxRelaysEnabled,
} from "./core";

const PUBLIC_RELAY = "wss://relay.damus.io";
const VEGA_RELAY = "wss://relay.veganostr.com";
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

  it("lets a fresh install remove the Vega relay as its first change", () => {
    // No stored list and no migration flags: the defaults. The one-time steps for
    // existing users must not read the first saved list as one of theirs.
    localStorage.removeItem("wrystr_vega_relay_added");
    localStorage.removeItem("wrystr_vega_relay_strfry_added");
    localStorage.removeItem(RELAY_STORAGE_KEY);
    expect(getStoredRelayUrls()).toContain(VEGA_RELAY);
    expect(getStoredRelayUrls()).not.toContain(RETIRED_VEGA_RELAY);
    removeRelay(VEGA_RELAY);
    expect(hasUrl(getStoredRelayUrls(), VEGA_RELAY)).toBe(false);
    expect(hasUrl(getStoredRelayUrls(), VEGA_RELAY)).toBe(false);
  });

  it("removes a relay from the stored list whatever form of its address it is given", () => {
    // The pool's URL carries a trailing slash and the stored one does not. A row
    // drawn from the pool passed the pool's form: the relay left the pool and
    // stayed in the list, back at the next check, under a toast that said "Removed".
    addRelay("wss://nos.lol");
    expect(hasUrl(getStoredRelayUrls(), "wss://nos.lol")).toBe(true);
    removeRelay("wss://nos.lol/");
    expect(hasUrl(getStoredRelayUrls(), "wss://nos.lol")).toBe(false);
    expect(poolHas("wss://nos.lol")).toBe(false);
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
  // Most of these test the opted-out path, so don't depend on test ordering for it.
  beforeEach(() => setOutboxRelaysEnabled(false));
  afterEach(() => setOutboxRelaysEnabled(false));

  it("defaults to outbox ON — it was silently on for the app's whole history", () => {
    localStorage.removeItem("wrystr_use_author_relays");
    expect(isOutboxRelaysEnabled()).toBe(true);
    // Everything below tests the opted-out path.
    setOutboxRelaysEnabled(false);
    expect(isOutboxRelaysEnabled()).toBe(false);
  });

  it("is installed on the NDK instance so NDK actually consults it", () => {
    // Without this wiring the filter is dead code: NDK only prunes
    // outbox-discovered author relays when ndk.relayConnectionFilter is set.
    expect(typeof getNDK().relayConnectionFilter).toBe("function");
  });

  it("installs the NIP-42 auth policy on the NDK instance", () => {
    // Same failure mode as the filter above, and the most likely way a NIP-42
    // feature silently no-ops: the policy exists and is never consulted.
    // NDK resolves `ndkRelay.authPolicy ?? ndk.relayAuthDefaultPolicy`, so the
    // instance-level field is the one that must be set.
    expect(typeof getNDK().relayAuthDefaultPolicy).toBe("function");
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


// The Vega relay moved from the Go relay (relay2.veganostr.com, retired) to strfry
// (relay.veganostr.com) in October 2026. Lists that hold the retired relay get the
// new one in front of it and keep the old one: until the server makes relay2 an
// alias of strfry, it is the only relay holding some of what Vega users published.
describe("the Vega relay moves to strfry", () => {
  const stored = () => JSON.parse(localStorage.getItem(RELAY_STORAGE_KEY) ?? "null");
  beforeEach(() => {
    localStorage.setItem("wrystr_vega_relay_added", "1");
    localStorage.removeItem("wrystr_vega_relay_strfry_added");
  });

  it("puts the strfry relay in front of the retired one, keeps the retired one, and saves the list", () => {
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([PUBLIC_RELAY, RETIRED_VEGA_RELAY, "wss://nos.lol"]));
    expect(getStoredRelayUrls()).toEqual([PUBLIC_RELAY, VEGA_RELAY, RETIRED_VEGA_RELAY, "wss://nos.lol"]);
    expect(stored()).toEqual([PUBLIC_RELAY, VEGA_RELAY, RETIRED_VEGA_RELAY, "wss://nos.lol"]);
    expect(localStorage.getItem("wrystr_vega_relay_strfry_added")).toBe("1");
  });

  it("leaves a list alone that the user took the Vega relay out of", () => {
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([PUBLIC_RELAY]));
    expect(getStoredRelayUrls()).toEqual([PUBLIC_RELAY]);
    expect(stored()).toEqual([PUBLIC_RELAY]);
    expect(localStorage.getItem("wrystr_vega_relay_strfry_added")).toBe("1");
  });

  it("leaves a list alone that already has both, in the order the user keeps them", () => {
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([RETIRED_VEGA_RELAY, VEGA_RELAY]));
    expect(getStoredRelayUrls()).toEqual([RETIRED_VEGA_RELAY, VEGA_RELAY]);
  });

  it("runs once: the strfry relay removed afterwards stays removed", () => {
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([RETIRED_VEGA_RELAY]));
    expect(getStoredRelayUrls()).toEqual([VEGA_RELAY, RETIRED_VEGA_RELAY]);
    removeRelay(VEGA_RELAY);
    expect(getStoredRelayUrls()).toEqual([RETIRED_VEGA_RELAY]);
    expect(getStoredRelayUrls()).toEqual([RETIRED_VEGA_RELAY]);
  });

  it("a list from before the Vega relay existed gets the strfry relay, not the retired one", () => {
    localStorage.removeItem("wrystr_vega_relay_added");
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify([PUBLIC_RELAY]));
    expect(getStoredRelayUrls()).toEqual([VEGA_RELAY, PUBLIC_RELAY]);
  });
});
