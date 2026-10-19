import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The search relays have connections of their own, so a search does not go
// through `fetchWithTimeout`. With the network gone it used to leave the
// answered and unanswered totals untouched, and the view said "No results".

/** What each search relay does when asked: resolve with events, never answer, or throw. */
const relays = vi.hoisted(() => ({ behaviour: new Map<string, "empty" | "silent" | "throws" | "found">() }));

vi.mock("@nostr-dev-kit/ndk", async (original) => {
  const real = await original<typeof import("@nostr-dev-kit/ndk")>();
  class FakeSearchNDK {
    private url: string;
    // What the app's incoming-event check reads off an instance (see authentic.ts).
    subManager = { dispatchEvent() { /* no relay events here */ } };
    asyncSigVerification = false;
    constructor(opts: { explicitRelayUrls: string[] }) { this.url = opts.explicitRelayUrls[0]; }
    async connect() { /* connected at once */ }
    fetchEvents() {
      const how = relays.behaviour.get(this.url) ?? "silent";
      if (how === "throws") return Promise.reject(new Error("socket closed"));
      if (how === "silent") return new Promise(() => { /* never */ });
      if (how === "found") return Promise.resolve(new Set([{ id: `from-${this.url}`, created_at: 1000 }]));
      return Promise.resolve(new Set());
    }
  }
  return { ...real, default: FakeSearchNDK };
});

import { fetchMark, unansweredSince } from "./fetchTotals";
import { searchUsers } from "./search";

const URLS = ["wss://relay.nostr.band", "wss://search.nos.today", "wss://nostr.wine"];
const all = (how: "empty" | "silent" | "throws" | "found") => URLS.forEach((url) => relays.behaviour.set(url, how));

/** One people search, run past the relays' time limit. */
const search = async () => {
  const mark = fetchMark();
  const done = searchUsers("vega");
  await vi.advanceTimersByTimeAsync(9000);
  return { found: await done, unanswered: unansweredSince(mark) };
};

beforeEach(() => { vi.useFakeTimers(); relays.behaviour.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe("search relays and the answered totals", () => {
  it("no search relay finishing is unanswered: the search was not carried out", async () => {
    all("silent");
    const { found, unanswered } = await search();
    expect(found).toEqual([]);
    expect(unanswered).toBe(true);
  });

  it("every search relay failing is unanswered", async () => {
    all("throws");
    expect((await search()).unanswered).toBe(true);
  });

  it("a search relay that finished with nothing is an answer: there are no results", async () => {
    all("empty");
    const { found, unanswered } = await search();
    expect(found).toEqual([]);
    expect(unanswered).toBe(false);
  });

  it("one search relay finishing is enough", async () => {
    all("silent");
    relays.behaviour.set(URLS[1], "empty");
    expect((await search()).unanswered).toBe(false);
  });

  it("results are an answer", async () => {
    all("silent");
    relays.behaviour.set(URLS[2], "found");
    const { found, unanswered } = await search();
    expect(found).toHaveLength(1);
    expect(unanswered).toBe(false);
  });
});
