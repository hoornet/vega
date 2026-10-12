import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PodcastShow } from "../../types/podcast";

const ME = "aa".repeat(32);
const SOMEONE_ELSE = "bb".repeat(32);
const BUILT_IN = "ws://127.0.0.1:4869/";
const DAMUS = "wss://relay.damus.io/";
const NOS = "wss://nos.lol/";

type Answer = { events: unknown[]; answered: boolean };
const publishToNetwork = vi.hoisted(() => vi.fn());
const fetchFromRelay = vi.hoisted(() => vi.fn());
const relaysToAsk = vi.hoisted(() => vi.fn());
const ndk = vi.hoisted(() => ({
  signer: undefined as { user: () => Promise<{ pubkey: string }>; sign: () => Promise<string> } | undefined,
  pool: { relays: new Map<string, { url: string }>() },
}));
vi.mock("./core", () => ({
  getNDK: () => ndk,
  publishToNetwork,
  fetchFromRelay,
  // The built-in relay: at a local address, and (here) never in the user's list.
  builtInRelayTest: () => (url: string) => /^ws:\/\/(127\.0\.0\.1|localhost):/.test(url),
}));
vi.mock("./social", () => ({ relaysToAsk }));

import { fetchPodcastList, publishPodcastList } from "./podcasts";

const show = (name: string): PodcastShow => ({ feedUrl: `https://example.com/${name}.xml`, title: name }) as PodcastShow;
const signerOf = (pubkey: string) => ({ user: async () => ({ pubkey }), sign: vi.fn(async () => "sig") });
/** A podcast list as a relay holds it. */
const listEvent = (names: string[], createdAt: number, pubkey = ME) => ({
  kind: 30003,
  pubkey,
  created_at: createdAt,
  content: JSON.stringify(Object.fromEntries(names.map((name) => [`https://example.com/${name}.xml`, { title: name }]))),
  tags: [["d", "podcasts"], ...names.map((name) => ["r", `https://example.com/${name}.xml`])],
});
/** The relays in the pool, which of them are up, and what each says when asked. */
function relays(says: Record<string, Answer | "down">) {
  const all = Object.keys(says).map((url) => ({ url }));
  ndk.pool.relays = new Map(all.map((relay) => [relay.url, relay]));
  relaysToAsk.mockResolvedValue(all.filter((relay) => says[relay.url] !== "down"));
  fetchFromRelay.mockImplementation(async (_ndk: unknown, relay: { url: string }) => says[relay.url]);
}
const holds = (...events: unknown[]): Answer => ({ events, answered: true });
const HAS_NONE: Answer = { events: [], answered: true };
const SILENT: Answer = { events: [], answered: false };
const asked = () => fetchFromRelay.mock.calls.map(([, relay]) => (relay as { url: string }).url).sort();

beforeEach(() => {
  publishToNetwork.mockReset().mockResolvedValue(new Set(["a relay"]));
  fetchFromRelay.mockReset();
  relaysToAsk.mockReset();
  ndk.signer = signerOf(ME);
});

// What is published next is worked out from this. A wrong "none", or a
// stale list, costs the user their subscriptions on every device.
describe("fetchPodcastList", () => {
  it("is the list a relay holds, with each show's details", async () => {
    relays({ [DAMUS]: holds(listEvent(["a", "b"], 100)) });
    const read = await fetchPodcastList(ME);
    expect(read).toMatchObject({ status: "found", createdAt: 100 });
    expect(read.status === "found" && read.shows.map((s) => [s.feedUrl, s.title])).toEqual([["https://example.com/a.xml", "a"], ["https://example.com/b.xml", "b"]]);
  });

  it("is the newest list when the relays hold different ones", async () => {
    relays({ [DAMUS]: holds(listEvent(["a"], 100)), [NOS]: holds(listEvent(["a", "c"], 200)) });
    const read = await fetchPodcastList(ME);
    expect(read.status === "found" && read.shows.map((s) => s.title)).toEqual(["a", "c"]);
  });

  // One fetch over several relays is cut short by NDK once most have
  // answered. Each relay is asked on its own, so the slow one is waited for.
  it("asks each relay on its own", async () => {
    relays({ [DAMUS]: HAS_NONE, [NOS]: holds(listEvent(["a"], 100)) });
    expect((await fetchPodcastList(ME)).status).toBe("found");
    expect(asked()).toEqual([NOS, DAMUS].sort());
    for (const [, , filter] of fetchFromRelay.mock.calls) expect(filter).toMatchObject({ kinds: [30003], authors: [ME], "#d": ["podcasts"] });
  });

  it("is a list although another relay did not answer", async () => {
    relays({ [DAMUS]: holds(listEvent(["a"], 100)), [NOS]: SILENT });
    expect((await fetchPodcastList(ME)).status).toBe("found");
  });

  it("is 'none' only when every relay answered and none holds a list", async () => {
    relays({ [DAMUS]: HAS_NONE, [NOS]: HAS_NONE });
    expect(await fetchPodcastList(ME)).toEqual({ status: "none" });
  });

  // The relay that did not answer may be the one that holds it.
  it("cannot tell when nothing came back and a relay did not answer", async () => {
    relays({ [DAMUS]: HAS_NONE, [NOS]: SILENT });
    expect(await fetchPodcastList(ME)).toEqual({ status: "unknown" });
  });

  it("cannot tell when no relay of the network is up", async () => {
    relays({ [DAMUS]: "down", [NOS]: "down" });
    expect(await fetchPodcastList(ME)).toEqual({ status: "unknown" });
    expect(fetchFromRelay).not.toHaveBeenCalled();
  });

  // The built-in relay holds this device's own last publish and answers at
  // once with the network gone. Taken for "the relays' list", a change was
  // published on top of it, and what another device had done was undone.
  it("does not ask the built-in relay, and does not take its copy for the network's", async () => {
    relays({ [BUILT_IN]: holds(listEvent(["a", "b"], 100)), [DAMUS]: "down" });
    expect(await fetchPodcastList(ME)).toEqual({ status: "unknown" });
    expect(fetchFromRelay).not.toHaveBeenCalled();
  });

  it("does not let the built-in relay's copy stand in for a relay that did not answer", async () => {
    relays({ [BUILT_IN]: holds(listEvent(["a", "b"], 300)), [DAMUS]: SILENT });
    expect(await fetchPodcastList(ME)).toEqual({ status: "unknown" });
    expect(asked()).toEqual([DAMUS]);
  });

  // Someone who has removed every other relay keeps their list here.
  it("asks the built-in relay when it is the only relay there is", async () => {
    relays({ [BUILT_IN]: holds(listEvent(["a"], 100)) });
    expect((await fetchPodcastList(ME)).status).toBe("found");
    expect(asked()).toEqual([BUILT_IN]);
  });

  it("takes no list that is not this account's, or not the podcast list", async () => {
    relays({ [DAMUS]: holds(listEvent(["x"], 500, SOMEONE_ELSE), { ...listEvent(["y"], 600), tags: [["d", "bookmarks"]] }) });
    expect(await fetchPodcastList(ME)).toEqual({ status: "none" });
  });

  it("an emptied list is a list", async () => {
    relays({ [DAMUS]: holds(listEvent([], 100)) });
    expect(await fetchPodcastList(ME)).toEqual({ status: "found", shows: [], createdAt: 100 });
  });
});

describe("publishPodcastList", () => {
  it("publishes the list through the rule for what counts as published, and says it went out", async () => {
    expect(await publishPodcastList([show("a"), show("b")], ME)).toBe(true);
    expect(publishToNetwork).toHaveBeenCalledTimes(1);
    const event = publishToNetwork.mock.calls[0][0] as { tags: string[][] };
    expect(event.tags.filter((tag) => tag[0] === "r").map((tag) => tag[1])).toEqual(["https://example.com/a.xml", "https://example.com/b.xml"]);
  });

  // The store keeps its record of unpublished changes unless something went
  // out. With no key, nothing does: said as "published", the record was
  // cleared and the change was lost at the next start.
  it("says nothing went out when there is no key to sign with", async () => {
    ndk.signer = undefined;
    expect(await publishPodcastList([show("a")], ME)).toBe(false);
    expect(publishToNetwork).not.toHaveBeenCalled();
  });

  // The list is signed by whatever key NDK holds, and that has not always
  // been the key of the account on screen: a read-only account added while
  // signed in with a key left that key in place, and its list went out
  // signed by, and so in place of, the other account's.
  it("sends nothing when the key there is belongs to another account", async () => {
    ndk.signer = signerOf(SOMEONE_ELSE);
    expect(await publishPodcastList([show("a")], ME)).toBe(false);
    expect(publishToNetwork).not.toHaveBeenCalled();
  });

  // One reading of the key: the one that was checked is the one that signs.
  it("signs with the key it checked, before the event is handed on", async () => {
    const mine = signerOf(ME);
    ndk.signer = mine;
    publishToNetwork.mockImplementation(async (event: { sig?: string }) => { expect(event.sig).toBe("sig"); return new Set(["a relay"]); });
    await publishPodcastList([show("a")], ME);
    expect(mine.sign).toHaveBeenCalledTimes(1);
  });

  it("fails with the publish's own error when no relay took it", async () => {
    const refused = new Error("Not enough relays received the event (0 published, 1 required)");
    publishToNetwork.mockRejectedValue(refused);
    await expect(publishPodcastList([show("a")], ME)).rejects.toBe(refused);
  });
});
