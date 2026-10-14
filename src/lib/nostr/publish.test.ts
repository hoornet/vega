import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NDKEvent, NDKRelay } from "@nostr-dev-kit/ndk";

// What counts as published is decided here from what NDK reports, and what
// NDK reports is checked against real NDK and real relays in
// `publish.live.test.ts`. That file needs two relays running and is skipped
// in CI. This one plays NDK's part with stand-ins, so that the rule itself
// (the network first, the built-in relay's copy afterwards, and its word
// only when it is the only relay the user has) cannot change unnoticed.

// The set NDK would publish to is NDK's to work out. Here it is whatever the test says.
const ndkSet = vi.hoisted(() => ({ relays: [] as unknown[] }));
vi.mock("@nostr-dev-kit/ndk", async (original) => {
  const real = await original<typeof import("@nostr-dev-kit/ndk")>();
  return { ...real, calculateRelaySetFromEvent: vi.fn(async (ndk: never) => new real.NDKRelaySet(new Set(ndkSet.relays as NDKRelay[]), ndk)) };
});

import { NDKRelaySet } from "@nostr-dev-kit/ndk";
import { publishToNetwork } from "./core";

// Avoids a dev-dependency on @types/node just for this.
declare const process: {
  on(event: "unhandledRejection", handler: (reason: unknown) => void): void;
  off(event: "unhandledRejection", handler: (reason: unknown) => void): void;
};

const BUILT_IN = "ws://127.0.0.1:4869/";
const DAMUS = "wss://relay.damus.io/";
const NOS = "wss://nos.lol/";
const SOMEONES = "wss://relay.of-someone-we-read.example/";
const NO_RELAYS = new Error("Not enough relays received the event (0 published, 1 required)");

type FakeRelay = NDKRelay & { publish: ReturnType<typeof vi.fn> };
/** NDK's relay status: 1 is disconnected, 5 connected, 8 signed in. */
const relay = (url: string, connected: boolean | number = true) =>
  ({ url, status: typeof connected === "number" ? connected : connected ? 5 : 1, publish: vi.fn().mockResolvedValue(true) }) as unknown as FakeRelay;
const urls = (relays: Iterable<NDKRelay>) => Array.from(relays).map((r) => r.url).sort();

/**
 * An app with these relays in its pool.
 * `ndkWouldUse` is the set NDK works out for the event: by default, as NDK
 * does without outbox data, the relays that are connected and not held only
 * for a while. `temporary` are relays held to read other people from.
 */
function app(pool: FakeRelay[], { ndkWouldUse, temporary = [] as FakeRelay[] }: { ndkWouldUse?: FakeRelay[]; temporary?: FakeRelay[] } = {}) {
  const all = [...pool, ...temporary];
  ndkSet.relays = ndkWouldUse ?? pool.filter((r) => r.status >= 5);
  const ndk = {
    debug: { extend: () => () => {} },
    pool: { relays: new Map(all.map((r) => [r.url, r])), temporaryRelayTimers: new Map(temporary.map((r) => [r.url, 1])) },
  } as unknown as NonNullable<NDKEvent["ndk"]>;
  /** Every publish of the event: which relays it was sent to. */
  const sentTo: string[][] = [];
  const event = {
    id: "e1",
    sig: "signed",
    ndk,
    sign: vi.fn(),
    // As NDK: with no set of its own, the set NDK works out.
    publish: vi.fn(async (set?: NDKRelaySet) => {
      const relays = set && set.size > 0 ? set.relays : new Set(ndkSet.relays as NDKRelay[]);
      sentTo.push(urls(relays));
      return relays;
    }),
  };
  return { event: event as unknown as NDKEvent & { publish: ReturnType<typeof vi.fn>; sign: ReturnType<typeof vi.fn> }, sentTo, ndk };
}
/** The user's own list, as stored. */
const configured = (list: string[]) => {
  localStorage.setItem("wrystr_vega_relay_added", "1");
  localStorage.setItem("wrystr_relays", JSON.stringify(list));
};
/** The network takes nothing. */
const refuse = (made: ReturnType<typeof app>) => made.event.publish.mockImplementation(async (set?: NDKRelaySet) => {
  made.sentTo.push(urls(set && set.size > 0 ? set.relays : new Set(ndkSet.relays as NDKRelay[])));
  throw NO_RELAYS;
});

beforeEach(() => { localStorage.clear(); });

describe("publishToNetwork: the network first", () => {
  it("publishes to the network's relays, and reports their answer alone", async () => {
    configured([DAMUS, NOS]);
    const { event, sentTo } = app([relay(DAMUS), relay(NOS), relay(BUILT_IN)]);
    const accepted = await publishToNetwork(event);
    expect(sentTo).toEqual([[NOS, DAMUS]]);
    expect(urls(accepted)).toEqual([NOS, DAMUS]);
  });

  it("gives the built-in relay its copy once the network has the event, and not through the event's own publish", async () => {
    configured([DAMUS]);
    const builtIn = relay(BUILT_IN);
    const { event } = app([relay(DAMUS), builtIn]);
    await publishToNetwork(event);
    expect(builtIn.publish).toHaveBeenCalledTimes(1);
    expect(builtIn.publish.mock.calls[0][0]).toBe(event);
    expect(event.publish).toHaveBeenCalledTimes(1);
  });

  // The bug: with the network gone the built-in relay was the whole of NDK's
  // set, it accepted, and the note was "Posted.".
  it("does not call it published when only the built-in relay could take it, and does not give it the event", async () => {
    configured([DAMUS, NOS]);
    const builtIn = relay(BUILT_IN);
    const made = app([relay(DAMUS, false), relay(NOS, false), builtIn]);
    refuse(made);
    await expect(publishToNetwork(made.event)).rejects.toThrow(/Not enough relays received the event/);
    expect(builtIn.publish).not.toHaveBeenCalled();
    // Not to the built-in relay: to the user's own relays, which NDK left out because none is connected.
    expect(made.sentTo).toEqual([[NOS, DAMUS]]);
  });

  it("does not give the built-in relay an event the network refused", async () => {
    configured([DAMUS]);
    const builtIn = relay(BUILT_IN);
    const made = app([relay(DAMUS), builtIn]);
    refuse(made);
    await expect(publishToNetwork(made.event)).rejects.toBe(NO_RELAYS);
    expect(made.sentTo).toEqual([[DAMUS]]);
    expect(builtIn.publish).not.toHaveBeenCalled();
  });

  it("works without a built-in relay", async () => {
    configured([DAMUS]);
    const { event, sentTo } = app([relay(DAMUS)]);
    expect(urls(await publishToNetwork(event))).toEqual([DAMUS]);
    expect(sentTo).toEqual([[DAMUS]]);
  });

  it("a failed copy to the built-in relay is not the event's failure, and is not left for nobody to catch", async () => {
    configured([DAMUS]);
    const builtIn = relay(BUILT_IN);
    // A plain function, not a mock: a mock looks at the promises it hands
    // out, and a rejection that has been looked at is no longer "uncaught".
    (builtIn as unknown as { publish: () => Promise<never> }).publish = () => Promise.reject(new Error("the built-in relay is restarting"));
    const { event } = app([relay(DAMUS), builtIn]);
    const uncaught = vi.fn();
    process.on("unhandledRejection", uncaught);
    try {
      expect(urls(await publishToNetwork(event))).toEqual([DAMUS]);
      // A rejection nobody handles is reported a turn later.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(uncaught).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", uncaught);
    }
  });
});

describe("publishToNetwork: which relays are tried", () => {
  // NDK's set is worked out per event and holds what is connected. With a
  // relay of the network connected in it, that set is used as it is.
  it("leaves NDK's set alone when a relay in it is connected", async () => {
    configured([DAMUS, NOS]);
    const { event, sentTo } = app([relay(DAMUS), relay(NOS, false), relay(BUILT_IN)]);
    await publishToNetwork(event);
    expect(sentTo).toEqual([[DAMUS]]);
  });

  // A relay that asked for a sign-in and got one is past "connected" in
  // NDK's numbering. It is connected all the same.
  it("counts a relay that is signed in to as connected", async () => {
    configured([DAMUS, NOS]);
    const { event, sentTo } = app([relay(DAMUS, 8), relay(NOS, false), relay(BUILT_IN)]);
    await publishToNetwork(event);
    expect(sentTo).toEqual([[DAMUS]]);
  });

  // A reply to someone whose relays are dead, with our own not connected
  // either: NDK's set has relays in it, and none of them is ours.
  it("tries the user's own relays as well when nothing in NDK's set is connected", async () => {
    configured([DAMUS]);
    const theirs = relay(SOMEONES, false);
    const { event, sentTo } = app([relay(DAMUS, false), relay(BUILT_IN)], { ndkWouldUse: [theirs, relay(BUILT_IN)] });
    await publishToNetwork(event);
    expect(sentTo).toEqual([[SOMEONES, DAMUS].sort()]);
  });

  // Relays NDK holds for a while to read other people's notes from. A note
  // of ours has no business there just because nothing else is connected.
  it("does not try relays that are only held to read someone else from", async () => {
    configured([DAMUS]);
    const made = app([relay(DAMUS, false), relay(BUILT_IN)], { temporary: [relay(SOMEONES)] });
    refuse(made);
    await expect(publishToNetwork(made.event)).rejects.toBe(NO_RELAYS);
    expect(made.sentTo).toEqual([[DAMUS]]);
  });

  // NDK never takes a relay off its list of borrowed ones. One it once held
  // to read someone from, and that the user then added to their list, still
  // reads as borrowed, and NDK leaves it out of the set it works out. It was
  // not published to, and with no other relay "Posted." was the built-in one's.
  it("counts a relay in the user's list as theirs although NDK once borrowed it", async () => {
    configured([DAMUS]);
    const damus = relay(DAMUS);
    const builtIn = relay(BUILT_IN);
    const { event, sentTo } = app([builtIn], { temporary: [damus], ndkWouldUse: [builtIn] });
    expect(urls(await publishToNetwork(event))).toEqual([DAMUS]);
    expect(sentTo).toEqual([[DAMUS]]);
  });

  // The message wraps go to a set of their own, with a longer time limit.
  it("applies the same rule to a set of its own, and passes the time limit on", async () => {
    configured([DAMUS]);
    const builtIn = relay(BUILT_IN);
    const nos = relay(NOS);
    const { event, sentTo, ndk } = app([relay(DAMUS), builtIn]);
    await publishToNetwork(event, new NDKRelaySet(new Set<NDKRelay>([nos, builtIn]), ndk), 9000);
    expect(sentTo).toEqual([[NOS]]);
    expect(event.publish.mock.calls[0][1]).toBe(9000);
    expect(builtIn.publish).toHaveBeenCalledWith(event, 9000);
  });

  it("a developer's write set is used as it is, as in NDK", async () => {
    configured([DAMUS]);
    const builtIn = relay(BUILT_IN);
    const { event, sentTo, ndk } = app([relay(DAMUS), builtIn]);
    (ndk as unknown as { devWriteRelaySet: NDKRelaySet }).devWriteRelaySet = new NDKRelaySet(new Set<NDKRelay>([builtIn]), ndk);
    await publishToNetwork(event);
    expect(sentTo).toEqual([[BUILT_IN]]);
  });
});

describe("publishToNetwork: when the built-in relay's word counts", () => {
  // Someone who has removed every other relay has chosen to keep their notes here.
  it("takes it when it is the only relay the user has", async () => {
    configured([]);
    const builtIn = relay(BUILT_IN);
    const { event, sentTo } = app([builtIn]);
    expect(urls(await publishToNetwork(event))).toEqual([BUILT_IN]);
    expect(sentTo).toEqual([[BUILT_IN]]);
    expect(builtIn.publish).not.toHaveBeenCalled(); // once, through the event: not a second copy
  });

  it("takes it when the only other relays are held to read someone else from", async () => {
    configured([]);
    const { event, sentTo } = app([relay(BUILT_IN)], { temporary: [relay(SOMEONES)] });
    expect(urls(await publishToNetwork(event))).toEqual([BUILT_IN]);
    expect(sentTo).toEqual([[BUILT_IN]]);
  });

  // Relays that are merely down do not make the built-in one the network.
  it("does not take it because the user's relays are down", async () => {
    configured([DAMUS]);
    const { event, sentTo } = app([relay(DAMUS, false), relay(BUILT_IN)]);
    await publishToNetwork(event);
    expect(sentTo).toEqual([[DAMUS]]);
  });

  // The list here is empty, and the user's relays are the ones from their
  // published relay list, which NDK added at sign-in (Relay reach on). They
  // are down. Only here, not in the live test, which keeps Relay reach off.
  it("does not take it when the user's relays come from their published list and are down", async () => {
    configured([]);
    const builtIn = relay(BUILT_IN);
    const made = app([relay(NOS, false), builtIn]);
    refuse(made);
    await expect(publishToNetwork(made.event)).rejects.toBe(NO_RELAYS);
    expect(made.sentTo).toEqual([[NOS]]);
    expect(builtIn.publish).not.toHaveBeenCalled();
  });
});

// A relay at a local address that the user put in their list: their own
// strfry, or the local end of an SSH or Tor tunnel to a relay elsewhere.
describe("publishToNetwork: a relay of the user's at a local address", () => {
  const TUNNEL = "ws://localhost:7777/";

  it("is the network: it is published to, and its answer counts", async () => {
    configured(["ws://localhost:7777", DAMUS]);
    const tunnel = relay(TUNNEL);
    const builtIn = relay(BUILT_IN);
    const { event, sentTo } = app([tunnel, relay(DAMUS, false), builtIn]);
    expect(urls(await publishToNetwork(event))).toEqual([TUNNEL]);
    expect(sentTo).toEqual([[TUNNEL]]);
    // And the built-in relay, which is in nobody's list, still gets only its copy.
    expect(builtIn.publish).toHaveBeenCalledTimes(1);
    expect(tunnel.publish).not.toHaveBeenCalled();
  });

  it("is tried with the user's other relays when nothing is connected", async () => {
    configured(["ws://localhost:7777", DAMUS]);
    const made = app([relay(TUNNEL, false), relay(DAMUS, false), relay(BUILT_IN)]);
    refuse(made);
    await expect(publishToNetwork(made.event)).rejects.toBe(NO_RELAYS);
    expect(made.sentTo).toEqual([[TUNNEL, DAMUS].sort()]);
  });
});

describe("publishToNetwork: signing", () => {
  // As NDK does it: the relays are worked out from the author, so the event is signed first.
  it("signs an unsigned event before anything else, and leaves a signed one alone", async () => {
    configured([DAMUS]);
    const signed = app([relay(DAMUS)]);
    await publishToNetwork(signed.event);
    expect(signed.event.sign).not.toHaveBeenCalled();

    const unsigned = app([relay(DAMUS)]);
    (unsigned.event as unknown as { sig?: string }).sig = undefined;
    const order: string[] = [];
    unsigned.event.sign.mockImplementation(async () => { order.push("sign"); });
    unsigned.event.publish.mockImplementation(async (set: NDKRelaySet) => { order.push("publish"); return set.relays; });
    await publishToNetwork(unsigned.event);
    expect(order).toEqual(["sign", "publish"]);
  });
});

// "Borrowed" is read from a field NDK keeps to itself. If an upgrade renames
// it, every relay in the pool reads as the user's own and nothing here fails,
// so this asks a real pool for it.
describe("what the rule reads from NDK", () => {
  it("a real NDK pool has the map of relays it holds on a timer", async () => {
    const { default: NDK } = await vi.importActual<typeof import("@nostr-dev-kit/ndk")>("@nostr-dev-kit/ndk");
    const pool = new NDK({ explicitRelayUrls: [] }).pool as unknown as { temporaryRelayTimers?: unknown };
    expect(pool.temporaryRelayTimers).toBeInstanceOf(Map);
  });
});

// Every publish of the user's goes through `publishToNetwork`. One call to
// an event's own publish beside it is one place where "Posted." can be said
// of a note only this computer has.
describe("nothing publishes around it", () => {
  const sources = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  // core.ts is where the rule lives. The wallet connection has an NDK of its
  // own, with no built-in relay in it, and its requests are not the user's notes.
  const ALLOWED = ["/lib/nostr/core.ts", "/lib/lightning/nwc.ts"];
  // NDK's own ways of publishing an event: directly, or through a shortcut
  // that builds one and publishes it. A match that is not NDK's (something
  // else with a method of that name) belongs in ALLOWED with a reason.
  // Not seen by this: `event.delete()` and `NDKUser.follow()`, which publish
  // too and whose names are too common to look for. Vega uses neither.
  const PUBLISHES = /\.(publish|publishReplaceable|react|repost)\(/;
  const direct = (src: string) => src.split("\n").filter((line) => PUBLISHES.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));

  it("reads the source files", () => {
    expect(Object.keys(sources)).toContain("/src/lib/nostr/notes.ts");
    expect(Object.keys(sources)).toContain("/src/stores/user.ts");
  });

  it("knows a direct publish when it sees one", () => {
    expect(direct("  await event.publish();")).toHaveLength(1);
    expect(direct("  const relays = await note.publish(set, 5000);")).toHaveLength(1);
    expect(direct("  await event.publishReplaceable();")).toHaveLength(1);
    expect(direct("  await event.react(\"+\");")).toHaveLength(1);
    expect(direct("  await event.repost();")).toHaveLength(1);
    expect(direct("  await publishToNetwork(event);")).toHaveLength(0);
    expect(direct("  // never event.publish() by itself")).toHaveLength(0);
    expect(direct("   * `event.publish()` resolves as soon as any relay accepts")).toHaveLength(0);
  });

  it("no file calls an event's own publish", () => {
    const found = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path) && !ALLOWED.some((ok) => path.endsWith(ok)))
      .flatMap(([path, src]) => direct(src).map((line) => `${path}: ${line.trim()}`));
    expect(found).toEqual([]);
  });

  it("the modules that publish use it", () => {
    for (const name of ["articles", "dms", "engagement", "lists", "notes", "podcasts", "polls", "relays", "social"]) {
      expect(sources[`/src/lib/nostr/${name}.ts`], name).toContain("publishToNetwork(");
    }
  });
});
