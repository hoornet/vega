// @vitest-environment node
//
// Node, not jsdom: real keys and real signatures, and a relay that lives in
// this process behind the WebSocket.
//
// What a relay can make NDK take is decided inside NDK, so these run real NDK
// against a relay that says whatever the test tells it to. Each attack is run
// twice: against NDK as it comes, where it must get through (if that ever
// stops being so, NDK has changed and this file wants a look), and against
// NDK as the app builds it, where it must not.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import NDK, { NDKEvent, NDKPrivateKeySigner, NDKRelay, type NDKFilter } from "@nostr-dev-kit/ndk";

type Raw = { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string };

/** What each relay answers a subscription with. */
const says = new Map<string, (filters: NDKFilter[]) => Raw[]>();
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0;
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 5); }
  send(data: string) {
    const msg = JSON.parse(data) as unknown[];
    if (msg[0] !== "REQ") return;
    const [, subId, ...filters] = msg as [string, string, ...NDKFilter[]];
    const answer = says.get(new URL(this.url).host)?.(filters) ?? [];
    setTimeout(() => {
      for (const e of answer) this.onmessage?.({ data: JSON.stringify(["EVENT", subId, e]) });
      this.onmessage?.({ data: JSON.stringify(["EOSE", subId]) });
    }, 5);
  }
  close() { this.readyState = 3; setTimeout(() => this.onclose?.({}), 0); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const realWebSocket = (globalThis as unknown as { WebSocket: unknown }).WebSocket;
/** NDK's own rule for whether a relay's event gets its signature checked, taken before the app replaces it. */
const ndksOwnRule = NDKRelay.prototype.shouldValidateEvent;
let authentic: typeof import("./authentic");

const victim = NDKPrivateKeySigner.generate();
const attacker = NDKPrivateKeySigner.generate();
const MADE_UP_FOLLOW = "f".repeat(64);

/** An event really signed by `signer`. */
async function signed(signer: NDKPrivateKeySigner, kind: number, content: string, createdAt = now()): Promise<Raw> {
  const event = new NDKEvent(undefined, { kind, content, created_at: createdAt, tags: [], pubkey: signer.pubkey } as never);
  await event.sign(signer);
  return event.rawEvent() as Raw;
}
/** A follow list in the victim's name, dated tomorrow, that the victim never signed. */
function forgedFollowList(id?: string): Raw {
  const event = new NDKEvent(undefined, { kind: 3, content: "", created_at: now() + 86400, tags: [["p", MADE_UP_FOLLOW]], pubkey: victim.pubkey } as never);
  return { ...(event.rawEvent() as Raw), id: id ?? event.getEventHash(), sig: "0".repeat(128) };
}
/** Everything a subscription is handed before the relays say they are done. */
function ask(ndk: NDK, filter: NDKFilter): Promise<Raw[]> {
  return new Promise((resolve) => {
    const got: Raw[] = [];
    const sub = ndk.subscribe(filter, { closeOnEose: true, groupable: false });
    sub.on("event", (e: NDKEvent) => got.push(e.rawEvent() as Raw));
    sub.on("eose", () => resolve(got));
    setTimeout(() => resolve(got), 1500);
  });
}
/** NDK with one relay in its list, connected. `guarded`: as the app builds it. */
async function start({ guarded }: { guarded: boolean }): Promise<NDK> {
  const ndk = new NDK({ explicitRelayUrls: ["wss://listed.test"], enableOutboxModel: false });
  if (guarded) authentic.guardIncomingEvents(ndk);
  void ndk.connect();
  await sleep(50);
  return ndk;
}
/** A relay that came into use after the instance was made: added in the Relays view, or reached for someone's notes. */
async function addLater(ndk: NDK): Promise<NDKRelay> {
  const relay = new NDKRelay("wss://later.test", undefined, ndk);
  ndk.pool.addRelay(relay, true);
  await sleep(50);
  return relay;
}

/** What NDK does for each relay every thirty seconds: work out anew what share of its events to check. */
const tick = (relay: NDKRelay) => (relay as unknown as { updateValidationRatio(): void }).updateValidationRatio();

beforeAll(async () => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  authentic = await import("./authentic");
});
beforeEach(() => { says.clear(); });
afterAll(() => { (globalThis as unknown as { WebSocket: unknown }).WebSocket = realWebSocket; });

describe("hasItsOwnId", () => {
  let real: Raw;
  beforeAll(async () => {
    const event = new NDKEvent(undefined, { kind: 1, content: "a real note", created_at: 1760000000, tags: [["t", "nostr"]], pubkey: victim.pubkey } as never);
    await event.sign(victim);
    real = event.rawEvent() as Raw;
  });

  it("is true for an event as its author signed it", () => {
    expect(authentic.hasItsOwnId(real)).toBe(true);
  });

  it("is false when anything the id is made from was changed", () => {
    expect(authentic.hasItsOwnId({ ...real, content: "a forged note" })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, pubkey: attacker.pubkey })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, created_at: real.created_at + 1 })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, kind: 3 })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, tags: [["t", "bitcoin"]] })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, tags: [] })).toBe(false);
  });

  it("is false for an id that is not the event's own", () => {
    expect(authentic.hasItsOwnId({ ...real, id: "ab".repeat(32) })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, id: real.id.toUpperCase() })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, id: real.id.slice(0, 62) })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, id: undefined })).toBe(false);
  });

  it("is false without something that could be a signature", () => {
    expect(authentic.hasItsOwnId({ ...real, sig: undefined })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, sig: "" })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, sig: "zz".repeat(64) })).toBe(false);
  });

  it("is false for what is not an event at all", () => {
    for (const not of [null, undefined, "event", 42, [], {}]) expect(authentic.hasItsOwnId(not)).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, content: 5 })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, kind: "1" })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, tags: [{ t: "nostr" }] })).toBe(false);
    expect(authentic.hasItsOwnId({ ...real, pubkey: "not a key" })).toBe(false);
  });

  it("does not check the signature: that is NDK's part", () => {
    expect(authentic.hasItsOwnId({ ...real, sig: "0".repeat(128) })).toBe(true);
  });
});

describe("an event the author really signed", () => {
  it("is delivered, from a relay in the list and from one added later", async () => {
    const ndk = await start({ guarded: true });
    await addLater(ndk);
    const note = await signed(victim, 1, "a real note");
    says.set("listed.test", () => [note]);
    says.set("later.test", () => [note]);
    const got = await ask(ndk, { kinds: [1], authors: [victim.pubkey] });
    expect(got.map((e) => e.id)).toEqual([note.id]);
  });

  it("is handed to this app's own subscriptions as it is published", async () => {
    const ndk = await start({ guarded: true });
    const got: string[] = [];
    const sub = ndk.subscribe({ kinds: [1], authors: [victim.pubkey] }, { closeOnEose: false, groupable: false });
    sub.on("event", (e: NDKEvent) => got.push(e.id));
    const note = await signed(victim, 1, "on its way out");
    ndk.subManager.dispatchEvent(note as never, undefined, true);
    sub.stop();
    expect(got).toEqual([note.id]);
  });
});

describe("an event with no signature to speak of", () => {
  for (const guarded of [false, true]) {
    it(`is dropped from a relay in the list, ${guarded ? "as the app builds NDK" : "by NDK as it comes"}`, async () => {
      const ndk = await start({ guarded });
      says.set("listed.test", () => [forgedFollowList()]);
      expect(await ask(ndk, { kinds: [3], authors: [victim.pubkey] })).toEqual([]);
    });
  }
});

// NDK keeps a record of signatures it has checked, by the id the event
// claims, and never compares that id with the event. One honest signature
// under a made-up id is enough to make the record say "checked" for it.
describe("a forged event that borrows the id of one that was checked", () => {
  /** The relay sends the attacker's own honestly signed note under an id of its choosing, then the forgery under the same id. */
  async function attack(ndk: NDK, relay: string) {
    const X = "ab".repeat(32);
    const primer = { ...(await signed(attacker, 1, "nothing to see")), id: X };
    says.set(relay, (filters) => (filters.some((f) => f.kinds?.includes(1)) ? [primer] : [forgedFollowList(X)]));
    await ask(ndk, { kinds: [1], authors: [attacker.pubkey] });
    return ask(ndk, { kinds: [3], authors: [victim.pubkey] });
  }

  it("is taken by NDK as it comes, from a relay in the list", async () => {
    const got = await attack(await start({ guarded: false }), "listed.test");
    expect(got).toHaveLength(1);
    expect(got[0].pubkey).toBe(victim.pubkey);
    expect(got[0].tags).toEqual([["p", MADE_UP_FOLLOW]]);
  });

  it("is dropped as the app builds NDK", async () => {
    expect(await attack(await start({ guarded: true }), "listed.test")).toEqual([]);
  });

  it("is dropped from a relay added later too", async () => {
    const ndk = await start({ guarded: true });
    await addLater(ndk);
    expect(await attack(ndk, "later.test")).toEqual([]);
  });

  // The other way round: a real, checked event's true id, borrowed by a forgery.
  it("is dropped when the id it borrows is a real event's", async () => {
    const ndk = await start({ guarded: true });
    const real = await signed(attacker, 1, "a real note");
    says.set("listed.test", (filters) => (filters.some((f) => f.kinds?.includes(1)) ? [real] : [forgedFollowList(real.id)]));
    expect(await ask(ndk, { kinds: [1], authors: [attacker.pubkey] })).toHaveLength(1);
    expect(await ask(ndk, { kinds: [3], authors: [victim.pubkey] })).toEqual([]);
  });
});

// NDK stops checking a relay's events once it has "proved itself". For a
// relay created after the NDK instance that means: ten good events, the next
// thirty-second tick, and then nothing it sends is checked.
describe("a relay that came into use later, once it has sent ten good events", () => {
  /** Ten honest notes, the tick, then the forgery with no signature. */
  async function attack(ndk: NDK) {
    const relay = await addLater(ndk);
    const notes = await Promise.all(Array.from({ length: 10 }, (_, i) => signed(attacker, 1, `honest note ${i}`)));
    says.set("later.test", (filters) => (filters.some((f) => f.kinds?.includes(1)) ? notes : [forgedFollowList()]));
    expect(await ask(ndk, { kinds: [1], authors: [attacker.pubkey] })).toHaveLength(10);
    tick(relay);
    return ask(ndk, { kinds: [3], authors: [victim.pubkey] });
  }

  it("has an unsigned event taken by NDK as it comes", async () => {
    const appsRule = NDKRelay.prototype.shouldValidateEvent;
    NDKRelay.prototype.shouldValidateEvent = ndksOwnRule;
    try {
      const got = await attack(await start({ guarded: false }));
      expect(got).toHaveLength(1);
      expect(got[0].pubkey).toBe(victim.pubkey);
    } finally {
      NDKRelay.prototype.shouldValidateEvent = appsRule;
    }
  });

  it("has it dropped as the app builds NDK", async () => {
    expect(await attack(await start({ guarded: true }))).toEqual([]);
  });

  it("is checked every time, whatever NDK has worked out for it", async () => {
    const ndk = await start({ guarded: true });
    const relay = await addLater(ndk);
    relay.validatedEventCount = 500;
    tick(relay);
    relay.trusted = true;
    for (let i = 0; i < 200; i++) expect(relay.shouldValidateEvent()).toBe(true);
  });
});

describe("an NDK instance that verifies in the background", () => {
  // The check would then pass an event with a correct id over a forged
  // signature, and NDK would show it before the signature came back.
  it("is refused", () => {
    const ndk = new NDK({ explicitRelayUrls: ["wss://listed.test"], signatureVerificationWorker: {} as never });
    expect(ndk.asyncSigVerification).toBe(true);
    expect(() => authentic.guardIncomingEvents(ndk)).toThrow(/synchronous/);
  });

  it("is not what the app makes", async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem("wrystr_vega_relay_added", "1");
    localStorage.setItem("wrystr_relays", JSON.stringify(["wss://listed.test"]));
    const core = await import("./core");
    expect(core.getNDK().asyncSigVerification).toBe(false);
  });
});

describe("the app's own NDK", () => {
  /** A fresh app with one relay in its list. */
  async function freshApp() {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem("wrystr_vega_relay_added", "1");
    localStorage.setItem("wrystr_relays", JSON.stringify(["wss://listed.test"]));
    localStorage.setItem("wrystr_use_author_relays", "false");
    return import("./core");
  }
  const attack = async (ndk: NDK) => {
    const X = "cd".repeat(32);
    const primer = { ...(await signed(attacker, 1, "nothing to see")), id: X };
    says.set("listed.test", (filters) => (filters.some((f) => f.kinds?.includes(1)) ? [primer] : [forgedFollowList(X)]));
    await ask(ndk, { kinds: [1], authors: [attacker.pubkey] });
    return ask(ndk, { kinds: [3], authors: [victim.pubkey] });
  };

  it("drops the forgery", async () => {
    const core = await freshApp();
    const ndk = core.getNDK();
    void ndk.connect();
    await sleep(50);
    expect(await attack(ndk)).toEqual([]);
  });

  it("drops it after the connection was rebuilt, too", async () => {
    const core = await freshApp();
    const first = core.getNDK();
    await core.resetNDK();
    const ndk = core.getNDK();
    expect(ndk).not.toBe(first);
    expect(await attack(ndk)).toEqual([]);
  }, 20000);
});

// The check is put in front of an instance when it is made. One made without
// it takes whatever a relay sends.
describe("every NDK instance in the app", () => {
  const sources = import.meta.glob(["../../**/*.ts", "../../**/*.tsx", "!../../**/*.test.*"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

  // A lint, not a proof: it looks for `new NDK(` and wants `guardIncomingEvents(`
  // right in front of it. An instance made another way (a helper, an alias,
  // the wrap on a later line) gets past it. Keep the five sites in this shape.
  it("is made with the check in front of it", () => {
    const made: string[] = [];
    const bare: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      // Comments and strings out, so one that mentions it does not count.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      code.split("\n").forEach((line, i) => {
        if (!/\bnew\s+NDK\s*\(/.test(line)) return;
        made.push(file);
        if (!/guardIncomingEvents\(\s*new\s+NDK\s*\(/.test(line)) bare.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    // The main instance and the one that replaces it, the two wallet connections, the search relays.
    expect(made.length).toBeGreaterThanOrEqual(5);
    expect(bare).toEqual([]);
  });
});
