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
// Relay reach, flipped per test. Off by default: most of these tests predate
// #49 and assert the pool-only path, which reach off pins us to.
const reach = vi.hoisted(() => ({ on: false }));
// What fetchUserDMRelayList's fetch returns — i.e. the kind 10050 on the wire.
const fetchWithTimeout = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => new Set()));
vi.mock("./core", () => ({
  getNDK: () => ({ subscribe: (...args: unknown[]) => subscribeImpl(...args) }),
  fetchWithTimeout,
  getStoredRelayUrls: () => ["wss://mine.example.invalid"],
  isLocalRelayUrl: (url: string) => /^ws:\/\/(127\.0\.0\.1|localhost):/.test(url),
  isOutboxRelaysEnabled: () => reach.on,
  stopSubscription: (...args: unknown[]) => stopSubscription(...args),
  withTimeout: async <T,>(p: Promise<T>) => p,
  FEED_TIMEOUT: 8000,
  SINGLE_TIMEOUT: 5000,
}));
// The real fromRelayUrls constructs NDKRelay objects and connects them — the
// exact behaviour the unit tests must not exercise. Capture the URLs instead.
const fromRelayUrls = vi.hoisted(() => vi.fn((urls: string[]) => ({ relayUrls: urls })));
vi.mock("@nostr-dev-kit/ndk", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NDKRelaySet: { fromRelayUrls },
}));
vi.mock("../../stores/toast", () => ({
  useToastStore: { getState: () => ({ addToast }) },
}));

import { fetchGiftWraps, clearDMRelayListCache } from "./dms";
import { setOwnDMRelayUrls } from "./relayAuth";

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
  fetchWithTimeout.mockClear();
  fromRelayUrls.mockClear();
  reach.on = false;
  clearDMRelayListCache();
  setOwnDMRelayUrls([]);
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

/**
 * Issue #49: kind 10050 (the NIP-17 DM relay list) was ignored entirely — the
 * gift-wrap fetch went to the pool alone, so a dedicated DM relay kept out of
 * the configured list was never read from.
 */
describe("fetchGiftWraps — NIP-17 DM relay routing (#49)", () => {
  /** A kind 10050 on the wire, as the mocked fetch hands it back. */
  const dmRelayListEvent = (urls: string[]) =>
    new Set([{ created_at: 100, tags: urls.map((u) => ["relay", u]) }]);

  /** Run fetchGiftWraps to completion once the 10050 resolution has settled. */
  async function fetchSettled(): Promise<unknown[]> {
    const promise = fetchGiftWraps("abcd", 20, 8000);
    await vi.advanceTimersByTimeAsync(0); // let the relay-list fetch resolve
    currentSub.emit("eose");
    return promise;
  }

  it("targets the user's published DM relays merged with the configured list", async () => {
    reach.on = true;
    fetchWithTimeout.mockResolvedValueOnce(dmRelayListEvent(["wss://dm.example.invalid"]));
    let relaySetArg: unknown = "unset";
    subscribeImpl = (...args: unknown[]) => { relaySetArg = args[2]; return currentSub; };

    await fetchSettled();

    // The 10050 was actually asked for…
    expect(fetchWithTimeout.mock.calls[0]?.[1]).toMatchObject({ kinds: [10050], authors: ["abcd"] });
    // …and the subscription got a relay set of DM relays ∪ configured relays.
    // Merged, not DM-only: every prior release delivered DMs via the pool, so
    // that is where existing conversations live.
    expect(fromRelayUrls).toHaveBeenCalledTimes(1);
    expect(fromRelayUrls.mock.calls[0][0]).toEqual(
      ["wss://dm.example.invalid", "wss://mine.example.invalid"],
    );
    expect(relaySetArg).toEqual({ relayUrls: ["wss://dm.example.invalid", "wss://mine.example.invalid"] });
  });

  it("drops non-websocket entries and honours at most four relays from one 10050", async () => {
    reach.on = true;
    fetchWithTimeout.mockResolvedValueOnce(dmRelayListEvent([
      "https://not-a-relay.example.invalid",
      "wss://one.example.invalid",
      "wss://two.example.invalid",
      "wss://three.example.invalid",
      "wss://four.example.invalid",
      "wss://five.example.invalid",
    ]));

    await fetchSettled();

    const merged = fromRelayUrls.mock.calls[0][0] as string[];
    expect(merged).not.toContain("https://not-a-relay.example.invalid");
    expect(merged).not.toContain("wss://five.example.invalid");
    expect(merged).toContain("wss://four.example.invalid");
  });

  it("asks for the 10050 once and reuses it on later fetches", async () => {
    reach.on = true;
    fetchWithTimeout.mockResolvedValue(dmRelayListEvent(["wss://dm.example.invalid"]));

    await fetchSettled();
    currentSub = makeSub();
    await fetchSettled();

    // The 60s notification poller lands here every minute; without the cache
    // that is a relay round-trip per poll for a list that changes never.
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fromRelayUrls).toHaveBeenCalledTimes(2);
  });

  it("never resolves a 10050 with Relay reach off — the pool alone, as before", async () => {
    // reach.on stays false. NDKRelaySet.fromRelayUrls bypasses
    // relayConnectionFilter, so reaching the DM relays here would quietly undo
    // the opt-out — the same hazard as #35.
    let relaySetArg: unknown = "unset";
    subscribeImpl = (...args: unknown[]) => { relaySetArg = args[2]; return currentSub; };

    const promise = fetchGiftWraps("abcd", 20, 8000);
    currentSub.emit("eose");
    await promise;

    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(fromRelayUrls).not.toHaveBeenCalled();
    expect(relaySetArg).toBeUndefined();
  });

  it("treats the user's own DM relay as in scope for AUTH", async () => {
    // A dedicated DM inbox relay is exactly the relay that will demand NIP-42
    // before serving kind 1059, and exactly the relay a privacy-minded user
    // keeps out of the configured list. The user published it as theirs in a
    // signed 10050, so the default "My relays only" scope covers it — without
    // this, the routing above reaches the relay only to refuse its challenge.
    reach.on = true;
    fetchWithTimeout.mockResolvedValueOnce(dmRelayListEvent(["wss://dm.example.invalid"]));

    const promise = fetchGiftWraps("abcd", 20, 8000);
    await vi.advanceTimersByTimeAsync(0);
    const dmRelay = fakeRelay("wss://dm.example.invalid/");
    currentSub.emit("closed", dmRelay, "auth-required: identify yourself");

    // No apology toast — we are authenticating, not declining…
    expect(addToast).not.toHaveBeenCalled();

    // …and the fetch waits for the handshake past the normal deadline.
    await vi.advanceTimersByTimeAsync(8000);
    let settled = false;
    void promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    currentSub.emit("event", { id: "wrap-from-dm-relay" });
    currentSub.emit("eose");
    await expect(promise).resolves.toEqual([{ id: "wrap-from-dm-relay" }]);
  });
});
