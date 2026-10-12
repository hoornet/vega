import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type NDK from "@nostr-dev-kit/ndk";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { fetchWithTimeout, heardFromNetwork } from "./core";
import { fetchMark, unansweredSince, recordFetchOutcome } from "./fetchTotals";

// "The relays said there is nothing" and "nobody said anything" used to reach
// every list as the same empty array. These are the totals that tell them
// apart, driven here through a stand-in for an NDK subscription. The stand-in
// only plays sequences NDK really produces; `fetchTotals.live.test.ts` runs
// the same questions against real NDK and real relays.

const LOCAL = "ws://127.0.0.1:4869/";
const REMOTE = "wss://relay.example/";
const OTHER = "wss://other.example/";

type Handler = (...args: unknown[]) => void;

/**
 * One subscription. `pool` is every relay Vega knows, connected or not.
 * `sentTo` is where NDK sent this subscription, which is not the same thing:
 * for a filter with authors it is the relays connected at that moment.
 */
function fakeNdk({ pool, sentTo = pool }: { pool: string[]; sentTo?: string[] }) {
  const handlers = new Map<string, Handler[]>();
  const sub = {
    eosesSeen: new Set<{ url: string }>(),
    relayFilters: new Map(sentTo.map((url) => [url, []])),
    on(name: string, fn: Handler) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); return sub; },
    stop: vi.fn(),
  };
  const emit = (name: string, ...args: unknown[]) => (handlers.get(name) ?? []).forEach((fn) => fn(...args));
  const instance = { subscribe: () => sub, pool: { relays: new Map(pool.map((url) => [url, { url }])) } } as unknown as NDK;
  return {
    instance,
    /** A relay sends an event. */
    event: (url: string, id: string) => emit("event", { id } as unknown as NDKEvent, { url }),
    /** A relay sends something another relay already sent. */
    duplicate: (url: string, id: string) => emit("event:dup", { id }, { url }),
    /** A relay says it has nothing more. */
    relayDone: (url: string) => sub.eosesSeen.add({ url }),
    /** Every relay it was sent to is done, so NDK calls the whole subscription done. */
    allDone: () => { sentTo.forEach((url) => sub.eosesSeen.add({ url })); emit("eose"); },
  };
}

describe("the totals", () => {
  it("is not unanswered before any fetch has ended", () => {
    expect(unansweredSince(fetchMark())).toBe(false);
  });

  it("is unanswered once a fetch has ended without an answer", () => {
    const mark = fetchMark();
    recordFetchOutcome(false);
    expect(unansweredSince(mark)).toBe(true);
  });

  // Something else in the app heard from a relay in the same moment, so
  // relays are reachable and an empty result is taken at its word.
  it("is not unanswered when any fetch was answered since the mark, in either order", () => {
    let mark = fetchMark();
    recordFetchOutcome(false); recordFetchOutcome(true);
    expect(unansweredSince(mark)).toBe(false);
    mark = fetchMark();
    recordFetchOutcome(true); recordFetchOutcome(false);
    expect(unansweredSince(mark)).toBe(false);
  });

  it("an answer before the mark does not count for what comes after it", () => {
    recordFetchOutcome(true);
    const mark = fetchMark();
    recordFetchOutcome(false);
    expect(unansweredSince(mark)).toBe(true);
  });
});

describe("heardFromNetwork", () => {
  it("is false when nobody answered", () => {
    expect(heardFromNetwork([], [REMOTE, LOCAL])).toBe(false);
  });

  // The built-in relay being the only relay there is does not make silence an answer.
  it("is false when nobody answered and the built-in relay is the only relay there is", () => {
    expect(heardFromNetwork([], [LOCAL])).toBe(false);
    expect(heardFromNetwork([], [])).toBe(false);
  });

  it("is true when a remote relay answered", () => {
    expect(heardFromNetwork([REMOTE], [REMOTE, LOCAL])).toBe(true);
    expect(heardFromNetwork([LOCAL, REMOTE], [REMOTE, LOCAL])).toBe(true);
  });

  // The built-in relay answers at once with the network gone.
  it("is false when only the built-in relay answered and the pool has remote relays", () => {
    expect(heardFromNetwork([LOCAL], [REMOTE, LOCAL])).toBe(false);
  });

  it("takes the built-in relay's word when it is the only relay there is", () => {
    expect(heardFromNetwork([LOCAL], [LOCAL])).toBe(true);
    expect(heardFromNetwork(["ws://localhost:7777/"], ["ws://localhost:7777/"])).toBe(true);
  });
});

describe("what fetchWithTimeout counts", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const run = async (relays: ReturnType<typeof fakeNdk>, play: (relays: ReturnType<typeof fakeNdk>) => void) => {
    const mark = fetchMark();
    const done = fetchWithTimeout(relays.instance, { kinds: [1] }, 1000);
    play(relays);
    await vi.advanceTimersByTimeAsync(1100);
    return { events: await done, unanswered: unansweredSince(mark) };
  };

  it("a timeout with nothing collected is unanswered", async () => {
    const { events, unanswered } = await run(fakeNdk({ pool: [REMOTE, OTHER] }), () => {});
    expect(events.size).toBe(0);
    expect(unanswered).toBe(true);
  });

  it("every relay finishing with nothing is an answer", async () => {
    const { events, unanswered } = await run(fakeNdk({ pool: [REMOTE, OTHER] }), (r) => r.allDone());
    expect(events.size).toBe(0);
    expect(unanswered).toBe(false);
  });

  // One relay of two is not NDK's quorum, so it never calls the subscription
  // done and the fetch runs to its timeout. That relay did answer, though:
  // the list it has is empty. The silent-pool streak counts this fetch as
  // unanswered, which is why lists do not ask the streak.
  it("one remote relay that finished is an answer even though the fetch ran out of time", async () => {
    const { unanswered } = await run(fakeNdk({ pool: [REMOTE, OTHER] }), (r) => r.relayDone(REMOTE));
    expect(unanswered).toBe(false);
  });

  it("an event from a remote relay is an answer", async () => {
    const { events, unanswered } = await run(fakeNdk({ pool: [REMOTE, OTHER] }), (r) => r.event(REMOTE, "a"));
    expect(events.size).toBe(1);
    expect(unanswered).toBe(false);
  });

  it("a remote relay repeating what the built-in relay sent first is an answer", async () => {
    const { unanswered } = await run(fakeNdk({ pool: [REMOTE, LOCAL] }), (r) => { r.event(LOCAL, "a"); r.duplicate(REMOTE, "a"); });
    expect(unanswered).toBe(false);
  });

  it("the built-in relay finishing while a remote relay stays silent is unanswered", async () => {
    const { unanswered } = await run(fakeNdk({ pool: [REMOTE, LOCAL] }), (r) => r.relayDone(LOCAL));
    expect(unanswered).toBe(true);
  });

  // Network down, built-in relay on, and a filter with authors. NDK sends it
  // to the relays connected right now, which is the built-in relay alone, and
  // that relay finishing ends the subscription in milliseconds. It was "all
  // that was asked", was believed, and a profile's notes read as empty.
  it("the built-in relay is not the network just because NDK asked nobody else", async () => {
    const { unanswered } = await run(fakeNdk({ pool: [REMOTE, OTHER, LOCAL], sentTo: [LOCAL] }), (r) => r.allDone());
    expect(unanswered).toBe(true);
  });

  it("events from the built-in relay alone are returned, and still not an answer from the network", async () => {
    const { events, unanswered } = await run(fakeNdk({ pool: [REMOTE, LOCAL] }), (r) => r.event(LOCAL, "a"));
    expect(events.size).toBe(1);
    expect(unanswered).toBe(true);
  });

  it("the built-in relay is believed when it is the only relay there is", async () => {
    const { unanswered } = await run(fakeNdk({ pool: [LOCAL] }), (r) => r.allDone());
    expect(unanswered).toBe(false);
  });

  it("the built-in relay staying silent is unanswered, even when it is the only relay there is", async () => {
    const { unanswered } = await run(fakeNdk({ pool: [LOCAL] }), () => {});
    expect(unanswered).toBe(true);
  });

  it("is not unanswered when another fetch was answered meanwhile", async () => {
    const mark = fetchMark();
    const silent = fakeNdk({ pool: [REMOTE] });
    const talking = fakeNdk({ pool: [REMOTE] });
    const a = fetchWithTimeout(silent.instance, { kinds: [1] }, 1000);
    const b = fetchWithTimeout(talking.instance, { kinds: [1] }, 1000);
    talking.allDone();
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.all([a, b]);
    expect(unansweredSince(mark)).toBe(false);
  });

  it("each fetch is counted once", async () => {
    const before = fetchMark();
    await run(fakeNdk({ pool: [REMOTE] }), (r) => { r.event(REMOTE, "a"); r.allDone(); });
    await run(fakeNdk({ pool: [REMOTE] }), () => {});
    const after = fetchMark();
    expect(after.answered - before.answered).toBe(1);
    expect(after.unanswered - before.unanswered).toBe(1);
  });

  it("events that arrive after the fetch has ended are not added", async () => {
    const relays = fakeNdk({ pool: [REMOTE] });
    const done = fetchWithTimeout(relays.instance, { kinds: [1] }, 1000);
    relays.allDone();
    relays.event(REMOTE, "late");
    expect((await done).size).toBe(0);
  });
});
