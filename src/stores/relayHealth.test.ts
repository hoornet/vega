import { describe, it, expect, vi, beforeEach } from "vitest";

// A check runs over the stored list as it was when it started. A relay removed
// while it runs must not come back with its result, and a check asked for in
// that time must still happen: the Relays view asks for one after every remove.

const stored = vi.hoisted(() => ({ urls: [] as string[] }));
const probe = vi.hoisted(() => ({ calls: 0, resolve: (_: unknown) => {} }));
vi.mock("../lib/nostr", () => ({ getStoredRelayUrls: () => stored.urls }));
vi.mock("../lib/nostr/relayHealth", () => ({
  checkAllRelays: (urls: string[]) => {
    probe.calls += 1;
    return new Promise((resolve) => { probe.resolve = (r) => resolve(r ?? urls.map((url) => ({ url, status: "online", latencyMs: 10, checkedAt: 1, nip11: null, error: null }))); });
  },
}));

import { useRelayHealthStore } from "./relayHealth";

beforeEach(() => {
  stored.urls = ["wss://a.example", "wss://b.example"];
  probe.calls = 0;
  useRelayHealthStore.setState({ results: [], checking: false, lastChecked: null });
});

describe("useRelayHealthStore.checkAll", () => {
  it("keeps results only for relays still in the list when the check ends", async () => {
    const run = useRelayHealthStore.getState().checkAll();
    stored.urls = ["wss://a.example"];
    probe.resolve(undefined);
    await run;
    expect(useRelayHealthStore.getState().results.map((r) => r.url)).toEqual(["wss://a.example"]);
    expect(useRelayHealthStore.getState().checking).toBe(false);
  });

  it("runs a check asked for while one is running, once that one is done", async () => {
    const first = useRelayHealthStore.getState().checkAll();
    expect(useRelayHealthStore.getState().checking).toBe(true);
    await useRelayHealthStore.getState().checkAll();
    expect(probe.calls).toBe(1);
    probe.resolve(undefined);
    await first;
    await vi.waitFor(() => expect(probe.calls).toBe(2));
    probe.resolve(undefined);
    await vi.waitFor(() => expect(useRelayHealthStore.getState().checking).toBe(false));
  });
});
