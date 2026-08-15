import { describe, it, expect } from "vitest";
import { summarizeRelays, classifyRelay } from "./useRelayStatus";

/**
 * Regression cover for the relay badge reading "6/6 relays" while the user's
 * configured list held three (issue #36). The pool is not the relay list: it
 * also holds the embedded strfry relay and anything NIP-65 pulled in, either
 * from follows (outbox) or from the user's own *published* list via NDK's
 * `autoConnectUserRelays`.
 */
const CONFIGURED = ["wss://nos.lol", "wss://nostr.oxtr.dev", "wss://premium.primal.net"];

/** The pool exactly as measured in the running app on 2026-08-15. */
const MEASURED_POOL = [
  { url: "wss://nos.lol/", connected: true },
  { url: "wss://nostr.oxtr.dev/", connected: true },
  { url: "wss://premium.primal.net/", connected: true },
  { url: "ws://127.0.0.1:4869/", connected: true },
  { url: "wss://relay.primal.net/", connected: true },
  { url: "wss://nostr.wine/", connected: true },
];

describe("relay badge origin split (issue #36)", () => {
  it("counts only the user's own relays in the headline, not the whole pool", () => {
    const s = summarizeRelays(MEASURED_POOL, CONFIGURED);

    // Previously this read 6/6 — three of which the user never configured.
    expect(s.totalCount).toBe(3);
    expect(s.connectedCount).toBe(3);
    expect(s.discoveredCount).toBe(2); // primal.net + nostr.wine, via NIP-65
  });

  it("excludes the embedded relay from both the headline and the extra count", () => {
    const s = summarizeRelays(MEASURED_POOL, CONFIGURED);
    const local = s.relays.filter((r) => r.origin === "local");

    // It is deliberately never in the stored list, so counting it as either
    // "yours" or "extra reach" would misreport in both directions.
    expect(local).toHaveLength(1);
    expect(s.totalCount + s.discoveredCount).toBe(MEASURED_POOL.length - 1);
  });

  it("reports zero extra reach when confined to the configured list", () => {
    // What Relay reach OFF should look like: the signal a privacy-focused user
    // needs is the *absence* of a +N, so it must actually reach zero.
    const s = summarizeRelays(
      [
        { url: "wss://nos.lol/", connected: true },
        { url: "ws://127.0.0.1:4869/", connected: true },
      ],
      ["wss://nos.lol"],
    );
    expect(s.discoveredCount).toBe(0);
    expect(s.connectedCount).toBe(1);
    expect(s.totalCount).toBe(1);
  });

  it("matches configured relays regardless of NDK's trailing slash", () => {
    // NDK normalizes relay.url with a trailing slash; the stored list strips it.
    // Comparing raw would classify every configured relay as 'discovered'.
    expect(classifyRelay("wss://nos.lol/", new Set(["wss://nos.lol"]))).toBe("configured");
    expect(classifyRelay("wss://nos.lol", new Set(["wss://nos.lol"]))).toBe("configured");
  });

  it("keeps a configured relay missing from the pool in the denominator", () => {
    // A relay that failed to connect must drag the ratio down, not disappear
    // and leave a falsely healthy 1/1.
    const s = summarizeRelays([{ url: "wss://nos.lol/", connected: true }], [
      "wss://nos.lol",
      "wss://offline.example.invalid",
    ]);
    expect(s.connectedCount).toBe(1);
    expect(s.totalCount).toBe(2);
  });

  it("treats localhost and 127.0.0.1 alike as the embedded relay", () => {
    const c = new Set<string>();
    expect(classifyRelay("ws://localhost:4869/", c)).toBe("local");
    expect(classifyRelay("ws://127.0.0.1:4869/", c)).toBe("local");
  });
});
