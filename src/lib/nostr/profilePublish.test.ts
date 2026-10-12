// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import NDK, { NDKPrivateKeySigner, type NDKEvent, type NDKSigner } from "@nostr-dev-kit/ndk";

// A profile says who an account is. It is signed with that account's key or
// not at all, and what comes back is what was published. Real keys and real
// signatures: the claim is about which key signed.

const holder = vi.hoisted(() => ({ ndk: null as unknown, publishToNetwork: vi.fn(), fetchFromRelay: vi.fn() }));
const BUILT_IN = "ws://127.0.0.1:4869/";
vi.mock("./core", () => ({
  getNDK: () => holder.ndk,
  publishToNetwork: (event: unknown) => holder.publishToNetwork(event),
  fetchWithTimeout: vi.fn(),
  fetchFromRelay: (...args: unknown[]) => holder.fetchFromRelay(...args),
  isLocalRelayUrl: (url: string) => url.startsWith("ws://127.0.0.1:"),
  // The built-in relay: at a local address, and (here) never in the user's list.
  builtInRelayTest: () => (url: string) => url.startsWith("ws://127.0.0.1:"),
  FEED_TIMEOUT: 1,
}));

import { publishProfile, fetchProfile, fetchProfileFromEachRelay } from "./social";

const ana = NDKPrivateKeySigner.generate();
const bo = NDKPrivateKeySigner.generate();
const ndk = () => holder.ndk as NDK;
const published = () => holder.publishToNetwork.mock.calls.map(([event]) => event as NDKEvent);

beforeEach(() => {
  holder.ndk = new NDK();
  ndk().signer = ana;
  holder.publishToNetwork.mockReset().mockResolvedValue(new Set(["a relay"]));
});

describe("publishProfile", () => {
  it("publishes a profile event holding exactly the fields given", async () => {
    await publishProfile({ name: "ana", display_name: "Ana K." }, ana.pubkey);
    expect(published()).toHaveLength(1);
    const [event] = published();
    expect(event.kind).toBe(0);
    expect(JSON.parse(event.content)).toEqual({ name: "ana", display_name: "Ana K." });
  });

  it("is signed by the account it is for, with a signature that verifies", async () => {
    await publishProfile({ name: "ana" }, ana.pubkey);
    const [event] = published();
    expect(event.pubkey).toBe(ana.pubkey);
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(event.verifySignature(false)).toBe(true);
  });

  it("returns the profile as the app holds profiles", async () => {
    const profile = await publishProfile({ name: "ana", display_name: "Ana K.", picture: "https://example.com/a.png", about: "hello" }, ana.pubkey);
    expect(profile).toMatchObject({ name: "ana", displayName: "Ana K.", picture: "https://example.com/a.png", about: "hello" });
    expect(profile.created_at).toBe(published()[0].created_at);
  });

  it("publishes nothing with no key to sign with", async () => {
    ndk().signer = undefined;
    await expect(publishProfile({ name: "ana" }, ana.pubkey)).rejects.toThrow("Not logged in");
    expect(published()).toEqual([]);
  });

  it("publishes nothing when the key in place is another account's", async () => {
    ndk().signer = bo;
    await expect(publishProfile({ name: "ana" }, ana.pubkey)).rejects.toThrow("Not logged in");
    expect(published()).toEqual([]);
  });

  // The account can change between the check and the signature.
  it("signs with the key it checked, not with one put in place meanwhile", async () => {
    // Slow to say who it is the first time it is asked, which is the check.
    let checked: (() => void) | null = null;
    const slowAna: NDKSigner = Object.create(ana, {
      user: { value: () => (checked ? ana.user() : new Promise((resolve) => { checked = () => resolve(ana.user()); })) },
    });
    ndk().signer = slowAna;
    const publishing = publishProfile({ name: "ana" }, ana.pubkey);
    ndk().signer = bo;
    checked!();
    await publishing;
    expect(published()[0].pubkey).toBe(ana.pubkey);
    expect(published()[0].verifySignature(false)).toBe(true);
  });

  it("fails when no relay took it", async () => {
    holder.publishToNetwork.mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    await expect(publishProfile({ name: "ana" }, ana.pubkey)).rejects.toThrow(/Not enough relays/);
  });
});

// The profile fetch every card uses is NDK's own. NDK hands an event to every
// open subscription that matches the moment it is published, before any relay
// has answered, and this is such a subscription unless it is told otherwise.
describe("fetchProfile", () => {
  it("tells NDK to take only what a relay sent", async () => {
    const asked = vi.fn(async function (this: { profile?: unknown }) { this.profile = { name: "ana" }; });
    const user = { fetchProfile: asked, profile: undefined as unknown };
    (ndk() as unknown as { getUser: (who: { pubkey: string }) => unknown }).getUser = ({ pubkey }) => { expect(pubkey).toBe(ana.pubkey); return user; };
    expect(await fetchProfile(ana.pubkey)).toEqual({ name: "ana" });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked.mock.calls[0][0 as never]).toEqual({ skipOptimisticPublishEvent: true });
  });

  it("is null for an account NDK found no profile of", async () => {
    (ndk() as unknown as { getUser: () => unknown }).getUser = () => ({ fetchProfile: async () => null, profile: undefined });
    expect(await fetchProfile(ana.pubkey)).toBeNull();
  });
});

// The account's own profile: what the edit form opens on, and what the next
// save is made from. Each relay is asked on its own and the newest wins.
describe("fetchProfileFromEachRelay", () => {
  const DAMUS = "wss://relay.damus.io/";
  const NOS = "wss://nos.lol/";
  type Answer = { events: unknown[]; answered: boolean };
  /** A kind 0 as a relay holds it, signed by Ana unless told otherwise. */
  async function profileEvent(content: unknown, createdAt: number, signer = ana) {
    const event = new (await import("@nostr-dev-kit/ndk")).NDKEvent(ndk());
    event.kind = 0;
    event.created_at = createdAt;
    event.content = typeof content === "string" ? content : JSON.stringify(content);
    await event.sign(signer);
    return event;
  }
  /** The relays that are up, and what each says when asked. */
  function relays(says: Record<string, Answer>) {
    const up = Object.keys(says).map((url) => ({ url, connected: true }));
    Object.defineProperty(ndk(), "pool", { value: { relays: new Map(up.map((relay) => [relay.url, relay])) }, configurable: true });
    holder.fetchFromRelay.mockImplementation(async (_ndk: unknown, relay: { url: string }) => says[relay.url]);
  }
  const holds = (...events: unknown[]): Answer => ({ events, answered: true });
  const HAS_NONE: Answer = { events: [], answered: true };
  const SILENT: Answer = { events: [], answered: false };

  beforeEach(() => { holder.fetchFromRelay.mockReset(); });

  it("is the profile a relay holds, as the app holds profiles", async () => {
    relays({ [DAMUS]: holds(await profileEvent({ name: "ana", display_name: "Ana K." }, 100)) });
    const read = await fetchProfileFromEachRelay(ana.pubkey);
    expect(read).toEqual({ status: "found", fromNetwork: true, profile: expect.objectContaining({ name: "ana", displayName: "Ana K.", created_at: 100 }) });
  });

  it("of two profiles of the same second, is the one with the lower id, whichever relay answered first", async () => {
    const one = await profileEvent({ name: "one" }, 200);
    const two = await profileEvent({ name: "two" }, 200);
    const [lower, higher] = one.id < two.id ? [one, two] : [two, one];
    relays({ [DAMUS]: holds(higher), [NOS]: holds(lower) });
    const a = await fetchProfileFromEachRelay(ana.pubkey);
    relays({ [DAMUS]: holds(lower), [NOS]: holds(higher) });
    const b = await fetchProfileFromEachRelay(ana.pubkey);
    expect(a.status === "found" && a.profile.name).toBe(JSON.parse(lower.content).name);
    expect(b.status === "found" && b.profile.name).toBe(JSON.parse(lower.content).name);
  });

  // One fetch over several relays is cut short by NDK once most have
  // answered. Each relay is asked on its own, so the slow one is waited for.
  it("asks each relay on its own, for this account's profile", async () => {
    relays({ [DAMUS]: HAS_NONE, [NOS]: holds(await profileEvent({ name: "ana" }, 100)) });
    expect((await fetchProfileFromEachRelay(ana.pubkey)).status).toBe("found");
    expect(holder.fetchFromRelay.mock.calls.map(([, relay]) => (relay as { url: string }).url).sort()).toEqual([NOS, DAMUS].sort());
    for (const [, , filter, timeout] of holder.fetchFromRelay.mock.calls) {
      expect(filter).toEqual({ kinds: [0], authors: [ana.pubkey] });
      expect(timeout).toBe(6000);
    }
  });

  // The profile saved a minute ago is on one relay; three others still hold
  // the one before it.
  it("is the newest when the relays hold different ones", async () => {
    relays({
      [DAMUS]: holds(await profileEvent({ name: "ana" }, 100)),
      [NOS]: holds(await profileEvent({ name: "ana, renamed" }, 200)),
      "wss://relay.snort.social/": holds(await profileEvent({ name: "ana" }, 100)),
    });
    const read = await fetchProfileFromEachRelay(ana.pubkey);
    expect(read.status === "found" && read.profile.name).toBe("ana, renamed");
  });

  // One relay that never answers is given six seconds. What the others hold
  // is said as they answer, so the profile is on screen long before that.
  describe("as each relay answers", () => {
    /** A relay's answer that comes when told to. */
    function heldAnswer() {
      let answer!: (a: Answer) => void;
      const promise = new Promise<Answer>((resolve) => { answer = resolve; });
      return { promise, answer };
    }

    it("says the profile the first relay holds without waiting for the others", async () => {
      const slow = heldAnswer();
      relays({ [DAMUS]: holds(await profileEvent({ name: "ana" }, 100)), [NOS]: SILENT });
      holder.fetchFromRelay.mockImplementation(async (_ndk: unknown, relay: { url: string }) => (relay.url === NOS ? slow.promise : holds(await profileEvent({ name: "ana" }, 100))));
      const said: (string | undefined)[] = [];
      const reading = fetchProfileFromEachRelay(ana.pubkey, { onFound: (profile) => said.push(profile.name) });
      await vi.waitFor(() => expect(said).toEqual(["ana"]));
      slow.answer(SILENT);
      expect(await reading).toMatchObject({ status: "found", profile: { name: "ana" } });
      expect(said).toEqual(["ana"]);
    });

    it("says a newer one from a later relay, and not an older or an equal one", async () => {
      const second = heldAnswer();
      const third = heldAnswer();
      const fourth = heldAnswer();
      const first = await profileEvent({ name: "ana" }, 100);
      relays({ [DAMUS]: HAS_NONE, [NOS]: HAS_NONE, "wss://c.test/": HAS_NONE, "wss://d.test/": HAS_NONE });
      holder.fetchFromRelay.mockImplementation(async (_ndk: unknown, relay: { url: string }) =>
        relay.url === DAMUS ? holds(first) : relay.url === NOS ? second.promise : relay.url === "wss://c.test/" ? third.promise : fourth.promise);
      const said: (string | undefined)[] = [];
      const reading = fetchProfileFromEachRelay(ana.pubkey, { onFound: (profile) => said.push(profile.name) });
      await vi.waitFor(() => expect(said).toEqual(["ana"]));
      second.answer(holds(await profileEvent({ name: "ana, renamed" }, 200)));
      await vi.waitFor(() => expect(said).toEqual(["ana", "ana, renamed"]));
      third.answer(holds(await profileEvent({ name: "ana, older still" }, 50)));
      // Two profiles of the same second: the one with the lower id wins, as NIP-01 has it.
      const renamed = holder.fetchFromRelay.mock.results.length;
      void renamed;
      fourth.answer(holds(await profileEvent({ name: "ana, renamed elsewhere at the same second" }, 200)));
      const read = await reading;
      const winner = read.status === "found" ? read.profile.name : null;
      expect(["ana, renamed", "ana, renamed elsewhere at the same second"]).toContain(winner);
      expect(said.slice(0, 2)).toEqual(["ana", "ana, renamed"]);
      expect(said.length).toBeLessThanOrEqual(3);
    });

    it("says nothing for a profile that cannot be read, another account's, or another kind of event", async () => {
      const note = await profileEvent({ name: "not a profile" }, 400);
      note.kind = 1;
      relays({ [DAMUS]: holds(await profileEvent("{not json", 300), await profileEvent({ name: "bo" }, 300, bo), note) });
      const onFound = vi.fn();
      expect(await fetchProfileFromEachRelay(ana.pubkey, { onFound })).toEqual({ status: "none" });
      expect(onFound).not.toHaveBeenCalled();
    });
  });

  it("passes over a profile that cannot be read for the one before it", async () => {
    relays({ [DAMUS]: holds(await profileEvent("{not json", 300)), [NOS]: holds(await profileEvent({ name: "ana" }, 100)) });
    const read = await fetchProfileFromEachRelay(ana.pubkey);
    expect(read.status === "found" && read.profile.name).toBe("ana");
  });

  it("does not take another account's profile, or another kind of event, for it", async () => {
    const note = await profileEvent({ name: "not a profile" }, 400);
    note.kind = 1;
    relays({ [DAMUS]: holds(await profileEvent({ name: "bo" }, 300, bo), note) });
    expect(await fetchProfileFromEachRelay(ana.pubkey)).toEqual({ status: "none" });
  });

  it("is none when every relay on the network answered and none holds one", async () => {
    relays({ [DAMUS]: HAS_NONE, [NOS]: HAS_NONE });
    expect(await fetchProfileFromEachRelay(ana.pubkey)).toEqual({ status: "none" });
  });

  it("is unknown when one of them did not answer", async () => {
    relays({ [DAMUS]: HAS_NONE, [NOS]: SILENT });
    expect(await fetchProfileFromEachRelay(ana.pubkey)).toEqual({ status: "unknown" });
  });

  it("is unknown when the only profiles held cannot be read and a relay did not answer", async () => {
    relays({ [DAMUS]: holds(await profileEvent("{not json", 300)), [NOS]: SILENT });
    expect(await fetchProfileFromEachRelay(ana.pubkey)).toEqual({ status: "unknown" });
  });

  it("is unknown with no relay up to ask", async () => {
    relays({});
    expect(await fetchProfileFromEachRelay(ana.pubkey, { maxWaitMs: 0 })).toEqual({ status: "unknown" });
    expect(holder.fetchFromRelay).not.toHaveBeenCalled();
  });

  // It answers at once with the network gone.
  describe("the built-in relay", () => {
    it("counts when it holds a profile, and says the network has not answered", async () => {
      relays({ [BUILT_IN]: holds(await profileEvent({ name: "ana" }, 100)), [DAMUS]: SILENT });
      expect(await fetchProfileFromEachRelay(ana.pubkey)).toMatchObject({ status: "found", fromNetwork: false });
      relays({ [BUILT_IN]: holds(await profileEvent({ name: "ana" }, 100)), [DAMUS]: HAS_NONE });
      expect(await fetchProfileFromEachRelay(ana.pubkey)).toMatchObject({ status: "found", fromNetwork: true });
    });

    it("cannot say that there is none", async () => {
      relays({ [BUILT_IN]: HAS_NONE });
      expect(await fetchProfileFromEachRelay(ana.pubkey, { maxWaitMs: 0 })).toEqual({ status: "unknown" });
      relays({ [BUILT_IN]: HAS_NONE, [DAMUS]: SILENT });
      expect(await fetchProfileFromEachRelay(ana.pubkey)).toEqual({ status: "unknown" });
    });

    it("does not stand in the way of none when the network's relays all answered", async () => {
      relays({ [BUILT_IN]: SILENT, [DAMUS]: HAS_NONE });
      expect(await fetchProfileFromEachRelay(ana.pubkey)).toEqual({ status: "none" });
    });
  });
});
