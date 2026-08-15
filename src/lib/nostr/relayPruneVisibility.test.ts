import { describe, it, expect, beforeAll } from "vitest";
import { getNDK, addRelay, RELAY_STORAGE_KEY } from "./core";

/**
 * NDK's temporary-relay pruner decides whether a relay is disposable with an
 * exact string comparison (`NDKPool.useTemporaryRelay`):
 *
 *     if (this.ndk.explicitRelayUrls?.includes(relay.url)) return;
 *     this.removeRelay(relay.url);
 *
 * So these assertions deliberately do NOT normalize before comparing — the
 * helper in relayConfig.test.ts strips trailing slashes from both sides, which
 * is precisely what hid this. Compare the way NDK compares, or the test cannot
 * see the bug.
 *
 * Lives in its own file because getNDK() is a module singleton and reads
 * explicitRelayUrls once, at construction.
 */
const CONFIGURED = ["wss://relay.damus.io", "wss://nos.lol"];

/** The pruner's literal condition, for the relay objects actually in the pool. */
function survivesPruner(url: string): boolean {
  const ndk = getNDK();
  const relay = [...(ndk.pool?.relays.values() ?? [])].find(
    (r) => r.url.replace(/\/+$/, "") === url.replace(/\/+$/, ""),
  );
  if (!relay) throw new Error(`${url} is not in the pool`);
  return ndk.explicitRelayUrls?.includes(relay.url) ?? false;
}

describe("configured relays are visible to NDK's pruner (issue #36)", () => {
  beforeAll(() => {
    localStorage.setItem("wrystr_vega_relay_added", "1");
    localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify(CONFIGURED));
  });

  it("keeps explicitRelayUrls in NDK's normalized form, not our stored form", () => {
    // NDK's constructor assigns opts.explicitRelayUrls verbatim; only its setter
    // normalizes. Storage keeps the stripped form, so the conversion has to
    // happen at the handoff.
    for (const url of getNDK().explicitRelayUrls) {
      expect(url.endsWith("/")).toBe(true);
    }
  });

  it("recognises relays configured at startup as explicit", () => {
    // These read as disposable before the fix — every one of them.
    for (const url of CONFIGURED) {
      expect(survivesPruner(url)).toBe(true);
    }
  });

  it("treats a relay added at runtime the same as one configured at startup", () => {
    // The asymmetry is the tell: addRelay() went through syncExplicitRelayUrl
    // and survived, while the startup list did not. Both must agree, or a relay
    // behaves differently depending on which session you added it in.
    const added = "wss://runtime.example.invalid";
    addRelay(added);
    expect(survivesPruner(added)).toBe(true);
    expect(survivesPruner(CONFIGURED[0])).toBe(true);
  });
});
