import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The gift-wrap fetch is where issue #48 was actually visible: kind 1059 is the
 * kind a relay is most likely to gate behind NIP-42, and before this the fetch
 * resolved on a bare timer with no `closed` handler — so "the relay refused
 * until you identify yourself" and "your inbox is empty" produced the same
 * empty array after 8 seconds.
 */

const addToast = vi.fn();

// Stubbed rather than real: dms.ts reaches for a signer, the DB and the relay
// pool on every path, none of which is under test here.
const stopSubscription = vi.fn();
vi.mock("./core", () => ({
  getNDK: () => ({ subscribe: (...args: unknown[]) => subscribeImpl(...args) }),
  fetchWithTimeout: vi.fn(async () => new Set()),
  getStoredRelayUrls: () => ["wss://mine.example.invalid"],
  isLocalRelayUrl: (url: string) => /^ws:\/\/(127\.0\.0\.1|localhost):/.test(url),
  stopSubscription: (...args: unknown[]) => stopSubscription(...args),
  FEED_TIMEOUT: 8000,
}));
vi.mock("../../stores/toast", () => ({
  useToastStore: { getState: () => ({ addToast }) },
}));

import { fetchGiftWraps } from "./dms";

type Handler = (...args: unknown[]) => void;

/** Minimal stand-in for an NDKSubscription: only the three events dms.ts binds. */
function makeSub() {
  const handlers: Record<string, Handler[]> = {};
  return {
    on(event: string, cb: Handler) { (handlers[event] ??= []).push(cb); },
    emit(event: string, ...args: unknown[]) { for (const cb of handlers[event] ?? []) cb(...args); },
  };
}

let currentSub: ReturnType<typeof makeSub>;
let subscribeImpl: (...args: unknown[]) => unknown;

const MY_RELAY = { url: "wss://mine.example.invalid/" };
const STRANGER = { url: "wss://stranger.example.invalid/" };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  addToast.mockClear();
  stopSubscription.mockClear();
  currentSub = makeSub();
  subscribeImpl = () => currentSub;
});

afterEach(() => vi.useRealTimers());

describe("fetchGiftWraps", () => {
  it("resolves with the events it collected on EOSE", async () => {
    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("event", { id: "wrap-1" });
    currentSub.emit("eose");
    await expect(promise).resolves.toEqual([{ id: "wrap-1" }]);
  });

  it("resolves on the deadline when no EOSE ever arrives", async () => {
    const promise = fetchGiftWraps("abcd", 20, 8000);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(promise).resolves.toEqual([]);
  });

  it("always stops the subscription — never a bare sub.stop()", async () => {
    // A bare stop on a RUNNING, never-EOSEd sub is what strands the `authed`
    // listener that later re-REQs with an empty filter set.
    const promise = fetchGiftWraps("abcd", 20, 8000);
    await vi.advanceTimersByTimeAsync(8000);
    await promise;
    expect(stopSubscription).toHaveBeenCalledTimes(1);
  });

  it("waits past the normal deadline when a relay we will authenticate to asks for AUTH", async () => {
    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", MY_RELAY, "auth-required: we can't serve DMs to unauthenticated users");

    // The original deadline must no longer settle it: the handshake, which on a
    // bunker is a remote round-trip, is still in flight.
    await vi.advanceTimersByTimeAsync(8000);
    let settled = false;
    void promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    // NDK re-issues the REQ itself once the relay authenticates; we only have
    // to still be listening when the events land.
    currentSub.emit("event", { id: "wrap-after-auth" });
    currentSub.emit("eose");
    await expect(promise).resolves.toEqual([{ id: "wrap-after-auth" }]);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("gives up on the extended deadline too, rather than hanging", async () => {
    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", MY_RELAY, "auth-required: identify yourself");
    await vi.advanceTimersByTimeAsync(8000 + 12000);
    await expect(promise).resolves.toEqual([]);
  });

  it("explains the empty inbox when scope says we will not identify ourselves", async () => {
    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", STRANGER, "auth-required: identify yourself");

    expect(addToast).toHaveBeenCalledTimes(1);
    const [message, type] = addToast.mock.calls[0];
    // Host in the message so the toast store's message-dedup distinguishes
    // relays rather than collapsing them into one notice.
    expect(message).toContain("stranger.example.invalid");
    expect(type).toBe("warning");

    // And it must not stall: we are not waiting for a handshake we declined.
    await vi.advanceTimersByTimeAsync(8000);
    await expect(promise).resolves.toEqual([]);
  });

  it("does not re-explain the same relay twice in a session", async () => {
    // A relay no other test has used: the "already explained" set is
    // module-level and deliberately outlives individual fetches, so reusing
    // STRANGER here would be suppressed before this test even started.
    const repeater = { url: "wss://repeater.example.invalid/" };

    const first = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", repeater, "auth-required: identify yourself");
    await vi.advanceTimersByTimeAsync(8000);
    await first;
    expect(addToast).toHaveBeenCalledTimes(1);

    // Opening Messages again must not scold the user a second time.
    currentSub = makeSub();
    const second = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", repeater, "auth-required: identify yourself");
    await vi.advanceTimersByTimeAsync(8000);
    await second;

    expect(addToast).toHaveBeenCalledTimes(1);
  });

  it("ignores a CLOSED that has nothing to do with auth", async () => {
    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", MY_RELAY, "rate-limited: slow down");
    await vi.advanceTimersByTimeAsync(8000);
    await expect(promise).resolves.toEqual([]);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("authenticates to any relay once the scope is widened", async () => {
    localStorage.setItem("wrystr_relay_auth_scope", "any");
    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", STRANGER, "auth-required: identify yourself");

    // Now a stranger is in scope, so this waits for the handshake instead of
    // apologising for an empty screen.
    expect(addToast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8000);
    currentSub.emit("eose");
    await expect(promise).resolves.toEqual([]);
  });
});
