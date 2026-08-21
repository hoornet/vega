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

/** Enough of NDKRelay for the auth wait: an emitter and a mutable status. */
function fakeRelay(url: string) {
  const handlers: Record<string, Handler[]> = {};
  return {
    url,
    status: 5, // CONNECTED
    on(ev: string, cb: Handler) { (handlers[ev] ??= []).push(cb); },
    off(ev: string, cb: Handler) { handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== cb); },
    emit(ev: string, ...args: unknown[]) { for (const cb of [...(handlers[ev] ?? [])]) cb(...args); },
    listenerCount(ev: string) { return (handlers[ev] ?? []).length; },
  };
}

const AUTHENTICATED = 8;
let MY_RELAY: ReturnType<typeof fakeRelay>;
const STRANGER = fakeRelay("wss://stranger.example.invalid/");

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  addToast.mockClear();
  stopSubscription.mockClear();
  currentSub = makeSub();
  subscribeImpl = () => currentSub;
  MY_RELAY = fakeRelay("wss://mine.example.invalid/");
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

  it("ignores the premature authed emit and waits for the relay's real state", async () => {
    // NDK emits `authed` twice: once synchronously before the event has even
    // been signed (status still CONNECTED), and once for real after the relay
    // acknowledges. Measured [5, 5, 8, 8] against a live relay. Acting on the
    // first is invisible with a local key and broken with a remote signer,
    // which is the only configuration this whole feature exists for.
    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", MY_RELAY, "auth-required: identify yourself");

    let settled = false;
    void promise.then(() => { settled = true; });

    MY_RELAY.emit("authed"); // premature: status is still CONNECTED
    await vi.advanceTimersByTimeAsync(7000);
    await Promise.resolve();
    expect(settled).toBe(false);

    MY_RELAY.status = AUTHENTICATED;
    MY_RELAY.emit("authed"); // the real one
    currentSub.emit("event", { id: "wrap-after-auth" });
    currentSub.emit("eose");

    await expect(promise).resolves.toEqual([{ id: "wrap-after-auth" }]);
  });

  it("stops waiting a bounded time after the relay authenticates", async () => {
    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", MY_RELAY, "auth-required: identify yourself");

    MY_RELAY.status = AUTHENTICATED;
    MY_RELAY.emit("authed");

    // NDK re-issues the request itself; if nothing comes back we must not hang
    // on for the full handshake cap.
    await vi.advanceTimersByTimeAsync(6000);
    await expect(promise).resolves.toEqual([]);
  });

  it("gives up at the handshake cap when the relay never authenticates", async () => {
    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", MY_RELAY, "auth-required: identify yourself");

    let settled = false;
    void promise.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(20000);
    await Promise.resolve();
    expect(settled).toBe(false); // a flat 12s grace used to have given up here

    await vi.advanceTimersByTimeAsync(10000);
    await expect(promise).resolves.toEqual([]);
  });

  it("detaches its authed listener so a stalled handshake leaks nothing", async () => {
    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("closed", MY_RELAY, "auth-required: identify yourself");
    expect(MY_RELAY.listenerCount("authed")).toBe(1);

    await vi.advanceTimersByTimeAsync(30000);
    await promise;
    expect(MY_RELAY.listenerCount("authed")).toBe(0);
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
