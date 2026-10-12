// @vitest-environment node
//
// Must be node, not the suite's default jsdom: a real relay connection uses
// undici's WebSocket, whose Event objects jsdom rejects.
//
// "A list is empty only when a relay said so" rests on what `fetchWithTimeout`
// counts as an answer, and that rests on what NDK does: where it sends a
// subscription, which relays it records as finished, when it calls the whole
// subscription done. `fetchTotals.test.ts` plays those through a stand-in.
// This runs the same questions against real NDK and real relays, because the
// stand-in once agreed with the code about a case NDK decides differently.
//
// Two throwaway relays. One stands in for the built-in relay and must be on
// localhost, which is what `isLocalRelayUrl` goes by. The other is "remote":
// 127.0.0.2 is still this machine, but not the built-in relay by that test.
//
//   nak serve --port 28547 &
//   nak serve --hostname 127.0.0.2 --port 28548 &
//   VEGA_TOTALS_BUILTIN=ws://localhost:28547 VEGA_TOTALS_REMOTE=ws://127.0.0.2:28548 \
//     npx vitest run fetchTotals.live
//
// The dead relays are `.invalid` names, which never resolve: a network that is
// cleanly down, as opposed to the half-open one in connectionLiveness.live.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NDKRelay } from "@nostr-dev-kit/ndk";

// Avoids a dev-dependency on @types/node just for env.
declare const process: { env: Record<string, string | undefined> };

const BUILTIN = process.env.VEGA_TOTALS_BUILTIN;
const REMOTE = process.env.VEGA_TOTALS_REMOTE;
const ready = !!BUILTIN && !!REMOTE;
const DEAD = ["wss://relay-a.invalid", "wss://relay-b.invalid"];
const AUTHOR = "a".repeat(64);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fresh app: its own NDK and its own totals, with these relays configured. */
async function start(configured: string[], { builtIn }: { builtIn: boolean }) {
  vi.resetModules();
  localStorage.setItem("wrystr_vega_relay_added", "1");
  localStorage.setItem("wrystr_relays", JSON.stringify(configured));
  // Relay reach off, so nothing here reaches for an author's own relays on the real network.
  localStorage.setItem("wrystr_use_author_relays", "false");
  const core = await import("./core");
  const totals = await import("./fetchTotals");
  const listLoad = await import("../listLoad");
  const ndk = core.getNDK();
  void ndk.connect().catch(() => {});
  if (builtIn) {
    // Exactly what connectLocalRelay() does: into the pool, never into the stored list.
    ndk.pool.addRelay(new NDKRelay(BUILTIN!, undefined, ndk), true);
  }
  await sleep(1500);
  /** One fetch, and whether the totals call it unanswered. */
  const ask = async (filter: Parameters<typeof core.fetchWithTimeout>[1], timeoutMs = 2000) => {
    const mark = totals.fetchMark();
    const t0 = Date.now();
    const events = await core.fetchWithTimeout(ndk, filter, timeoutMs);
    return { events: events.size, ms: Date.now() - t0, unanswered: totals.unansweredSince(mark) };
  };
  return { core, listLoad, ndk, ask };
}

describe.skipIf(!ready)("what counts as an answer, with real NDK and real relays", () => {
  beforeEach(() => { localStorage.clear(); });

  // The case the stand-in got wrong. For a filter with authors and no outbox
  // data NDK asks the relays connected right now: here, the built-in one
  // alone. It answers in milliseconds, and was believed.
  it("network down, built-in relay on: a fetch by author is unanswered", async () => {
    const { ask, ndk } = await start(DEAD, { builtIn: true });
    const builtIn = Array.from(ndk.pool.relays.values()).find((r) => r.url.startsWith(BUILTIN!));
    expect(builtIn?.connected, "the built-in relay is up").toBe(true);
    const byAuthor = await ask({ kinds: [1], authors: [AUTHOR], limit: 5 });
    console.log(`[totals] network down, by author: ${JSON.stringify(byAuthor)}`);
    expect(byAuthor.events).toBe(0);
    expect(byAuthor.unanswered, "the built-in relay's empty answer is not the network's").toBe(true);
  }, 30000);

  it("network down, built-in relay on: a fetch without authors is unanswered", async () => {
    const { ask } = await start(DEAD, { builtIn: true });
    const plain = await ask({ kinds: [1], "#t": ["zzzznothing"], limit: 5 });
    console.log(`[totals] network down, no authors: ${JSON.stringify(plain)}`);
    expect(plain.unanswered).toBe(true);
  }, 30000);

  it("network down, no built-in relay: unanswered", async () => {
    const { ask } = await start(DEAD, { builtIn: false });
    expect((await ask({ kinds: [1], authors: [AUTHOR], limit: 5 })).unanswered).toBe(true);
  }, 30000);

  // One relay of two is not NDK's quorum, so the subscription never ends on
  // its own and every such fetch runs to its timeout. The silent-pool streak
  // counts those as unanswered and calls the pool silent after three. A list
  // that asked the streak then said "couldn't reach your relays" of a relay
  // that had answered every time.
  it("one relay answers with nothing and one is dead: an answer, every time, and the list is empty", async () => {
    const { ask, core, listLoad, ndk } = await start([REMOTE!, DEAD[1]], { builtIn: false });
    for (let i = 1; i <= 3; i++) {
      const plain = await ask({ kinds: [1], "#t": ["zzzznothing"], limit: 5 });
      console.log(`[totals] one of two, fetch ${i}: ${JSON.stringify(plain)} isPoolSilent=${core.isPoolSilent()}`);
      expect(plain.events).toBe(0);
      expect(plain.unanswered, `fetch ${i}: a relay answered`).toBe(false);
    }
    const loaded = await listLoad.loadList(async () => Array.from(await core.fetchWithTimeout(ndk, { kinds: [1], "#t": ["zzzznothing"], limit: 5 }, 2000)));
    expect(loaded).toEqual({ status: "loaded", items: [] });
  }, 60000);

  it("a remote relay answering with nothing, built-in relay on: an answer", async () => {
    const { ask } = await start([REMOTE!], { builtIn: true });
    const byAuthor = await ask({ kinds: [1], authors: [AUTHOR], limit: 5 });
    console.log(`[totals] remote up, by author: ${JSON.stringify(byAuthor)}`);
    expect(byAuthor.unanswered).toBe(false);
    expect((await ask({ kinds: [1], "#t": ["zzzznothing"], limit: 5 })).unanswered).toBe(false);
  }, 30000);

  // Someone who runs on the built-in relay alone has no other relay to hear
  // from. Its answer is the answer, or every list would be unreachable forever.
  it("the built-in relay is the only relay there is: its answer counts", async () => {
    const { ask } = await start([BUILTIN!], { builtIn: false });
    const byAuthor = await ask({ kinds: [1], authors: [AUTHOR], limit: 5 });
    console.log(`[totals] built-in only: ${JSON.stringify(byAuthor)}`);
    expect(byAuthor.unanswered).toBe(false);
  }, 30000);
});
