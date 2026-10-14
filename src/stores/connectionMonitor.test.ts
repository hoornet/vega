import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const net = vi.hoisted(() => ({ relays: [] as { url: string; connected: boolean }[], silent: false }));
vi.mock("../lib/nostr", () => ({
  getNDK: () => ({ pool: { relays: new Map(net.relays.map((r) => [r.url, r])) }, connect: async () => {} }),
  isLocalRelayUrl: (url: string) => url.startsWith("ws://127."),
  isPoolSilent: () => net.silent,
  resetNDK: vi.fn(async () => {}),
  connectToRelays: vi.fn(), ensureConnected: vi.fn(), fetchGlobalFeed: vi.fn(), fetchBatchEngagement: vi.fn(), fetchTrendingCandidates: vi.fn(),
}));
vi.mock("../lib/feedDiagnostics", () => ({ diagWrapFetch: (f: unknown) => f, logDiag: vi.fn(), startRelaySnapshots: vi.fn(), startDiagFileFlusher: vi.fn(), getRelayStates: () => [] }));
vi.mock("../lib/db", () => ({ dbLoadFeed: vi.fn(), dbSaveNotes: vi.fn() }));

import { startConnectionMonitor, useFeedStore, CONNECTION_LOST, CONNECTION_RESET } from "./feed";
import { useToastStore } from "./toast";

const toasts = () => useToastStore.getState().toasts.map((t) => t.message);
const tick = async (n = 1) => { for (let i = 0; i < n; i++) await vi.advanceTimersByTimeAsync(5000); };

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
  net.relays = [{ url: "wss://a.example/", connected: false }];
  net.silent = false;
  useFeedStore.setState({ connected: true, startLiveFeed: () => {} });
});
afterEach(() => { vi.useRealTimers(); });

// "Connection lost — reconnecting…" used to sit beside "Back online".
describe("the connection monitor's toasts", () => {
  it("takes 'Connection lost' down when the relays are back", async () => {
    startConnectionMonitor((patch) => useFeedStore.setState(patch), () => useFeedStore.getState());
    await tick(3);
    expect(toasts()).toEqual(["Connection lost — reconnecting…"]);
    expect(useToastStore.getState().toasts[0].key).toBe(CONNECTION_LOST);
    expect(useFeedStore.getState().connected).toBe(false);
    net.relays[0].connected = true;
    await tick();
    expect(toasts()).toEqual(["Back online"]);
    expect(useFeedStore.getState().connected).toBe(true);
  });

  it("takes 'Resetting relay connections' down too", async () => {
    startConnectionMonitor((patch) => useFeedStore.setState(patch), () => useFeedStore.getState());
    await tick(6);
    expect(toasts()).toContain("Resetting relay connections…");
    expect(useToastStore.getState().toasts.find((t) => t.message.startsWith("Resetting"))?.key).toBe(CONNECTION_RESET);
    net.relays[0].connected = true;
    await tick();
    expect(toasts()).toEqual(["Back online"]);
  });

  it("stays quiet while nothing changed", async () => {
    net.relays[0].connected = true;
    startConnectionMonitor((patch) => useFeedStore.setState(patch), () => useFeedStore.getState());
    await tick(4);
    expect(toasts()).toEqual([]);
  });
});
