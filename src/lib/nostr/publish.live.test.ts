// @vitest-environment node
//
// Must be node, not the suite's default jsdom: a real relay connection uses
// undici's WebSocket, whose Event objects jsdom rejects.
//
// "Posted." is true only if a relay on the network has the note. What NDK
// reports as published is decided inside NDK, so this runs `publishToNetwork`
// against real NDK and real relays, and asks the relays themselves what they
// hold afterwards. A stand-in for NDK once agreed with the code about a case
// NDK decides differently (see `fetchTotals.live.test.ts`).
//
// Two throwaway relays. One stands in for the built-in relay and must be on
// localhost, which is what `isLocalRelayUrl` goes by. The other is "remote":
// 127.0.0.2 is still this machine, but not the built-in relay by that test.
//
//   nak serve --port 28547 &
//   nak serve --hostname 127.0.0.2 --port 28548 &
//   VEGA_TOTALS_BUILTIN=ws://localhost:28547 VEGA_TOTALS_REMOTE=ws://127.0.0.2:28548 \
//     npx vitest run publish.live
//
// The dead relays are `.invalid` names, which never resolve.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NDKEvent, NDKPrivateKeySigner, NDKRelay } from "@nostr-dev-kit/ndk";

// Avoids a dev-dependency on @types/node just for env.
declare const process: { env: Record<string, string | undefined> };

const BUILTIN = process.env.VEGA_TOTALS_BUILTIN;
const REMOTE = process.env.VEGA_TOTALS_REMOTE;
const ready = !!BUILTIN && !!REMOTE;
const DEAD = ["wss://relay-a.invalid", "wss://relay-b.invalid"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask a relay itself, over a socket of our own, whether it holds an event.
 * "unreachable" is its own answer: a relay that could not be asked has not
 * said that it does not hold the event.
 */
function holds(url: string, id: string): Promise<"yes" | "no" | "unreachable"> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const done = (answer: "yes" | "no" | "unreachable") => { clearTimeout(timer); try { ws.close(); } catch { /* closed already */ } resolve(answer); };
    const timer = setTimeout(() => done("unreachable"), 3000);
    ws.onopen = () => ws.send(JSON.stringify(["REQ", "holds", { ids: [id] }]));
    ws.onmessage = (message) => {
      const [kind] = JSON.parse(String(message.data)) as [string];
      if (kind === "EVENT") done("yes");
      if (kind === "EOSE") done("no");
    };
    ws.onerror = () => done("unreachable");
  });
}

/** A fresh app: its own NDK, signed in with a throwaway key, with these relays configured. */
async function start(configured: string[], { builtIn, connect = true }: { builtIn: boolean; connect?: boolean }) {
  vi.resetModules();
  localStorage.setItem("wrystr_vega_relay_added", "1");
  localStorage.setItem("wrystr_relays", JSON.stringify(configured));
  // Relay reach off, so nothing here reaches for an author's own relays on the real network.
  localStorage.setItem("wrystr_use_author_relays", "false");
  const core = await import("./core");
  const ndk = core.getNDK();
  ndk.signer = NDKPrivateKeySigner.generate();
  if (connect) void ndk.connect().catch(() => {});
  if (builtIn) {
    // Exactly what connectLocalRelay() does: into the pool, never into the stored list.
    ndk.pool.addRelay(new NDKRelay(BUILTIN!, undefined, ndk), true);
  }
  await sleep(1500);
  const note = () => {
    const event = new NDKEvent(ndk);
    event.kind = 1;
    event.content = `publish.live ${Date.now()} ${Math.random()}`;
    return event;
  };
  const urls = (relays: Set<NDKRelay>) => Array.from(relays).map((relay) => relay.url).sort();
  return { core, ndk, note, urls };
}

describe.skipIf(!ready)("what counts as published, with real NDK and real relays", () => {
  beforeEach(() => { localStorage.clear(); });

  // The fact this file exists for. NDK's own publish, network down, built-in
  // relay on: it resolves, having reached nobody but this computer.
  it("NDK's own publish calls a note published when only the built-in relay took it", async () => {
    const { ndk, note, urls } = await start(DEAD, { builtIn: true });
    const event = note();
    const t0 = Date.now();
    const accepted = urls(await event.publish());
    console.log(`[publish] NDK's own, network down, built-in on: resolved with ${JSON.stringify(accepted)} in ${Date.now() - t0} ms`);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].startsWith(BUILTIN!)).toBe(true);
    expect(ndk.pool.relays.size).toBe(3);
  }, 30000);

  it("network down, built-in relay on: not published, and the built-in relay is not given the note", async () => {
    const { core, note } = await start(DEAD, { builtIn: true });
    const event = note();
    const t0 = Date.now();
    const outcome = await core.publishToNetwork(event).then((relays) => `resolved with ${relays.size}`, (err: Error) => err.message);
    console.log(`[publish] network down, built-in on: ${outcome} in ${Date.now() - t0} ms`);
    expect(outcome).toMatch(/^Not enough relays received the event/);
    await sleep(500);
    expect(await holds(BUILTIN!, event.id), "nothing only this computer has").toBe("no");
  }, 30000);

  it("network down, no built-in relay: not published", async () => {
    const { core, note } = await start(DEAD, { builtIn: false });
    await expect(core.publishToNetwork(note())).rejects.toThrow(/Not enough relays received the event/);
  }, 30000);

  it("network up, built-in relay on: published to the network, and the built-in relay gets its copy", async () => {
    const { core, note, urls } = await start([REMOTE!], { builtIn: true });
    const event = note();
    const accepted = urls(await core.publishToNetwork(event));
    console.log(`[publish] network up, built-in on: ${JSON.stringify(accepted)}`);
    // What is reported is the network's answer alone.
    expect(accepted).toHaveLength(1);
    expect(accepted[0].startsWith(REMOTE!)).toBe(true);
    expect(await holds(REMOTE!, event.id)).toBe("yes");
    await sleep(500);
    expect(await holds(BUILTIN!, event.id), "the copy this computer keeps").toBe("yes");
  }, 30000);

  it("network up, no built-in relay: published", async () => {
    const { core, note } = await start([REMOTE!], { builtIn: false });
    const event = note();
    expect((await core.publishToNetwork(event)).size).toBe(1);
    expect(await holds(REMOTE!, event.id)).toBe("yes");
  }, 30000);

  it("one relay up and one dead: published", async () => {
    const { core, note } = await start([REMOTE!, DEAD[0]], { builtIn: true });
    const event = note();
    expect((await core.publishToNetwork(event)).size).toBe(1);
    expect(await holds(REMOTE!, event.id)).toBe("yes");
  }, 30000);

  // Someone who has removed every other relay has chosen to keep their notes here.
  it("no relay but the built-in one: its word counts", async () => {
    const { core, note, urls } = await start([], { builtIn: true });
    const event = note();
    const accepted = urls(await core.publishToNetwork(event));
    expect(accepted).toHaveLength(1);
    expect(accepted[0].startsWith(BUILTIN!)).toBe(true);
    expect(await holds(BUILTIN!, event.id)).toBe("yes");
  }, 30000);

  // Not here: an empty list with relays of the user's in the pool that came
  // from their published relay list. That needs Relay reach on, and with it
  // on this file would go looking for relay lists on the real network.
  // `publish.test.ts` has the case, with stand-ins.

  // A relay at a local address that the user put in their list is theirs:
  // their own strfry, or the local end of a tunnel. Here the relay on
  // localhost plays that part, and there is no built-in relay at all.
  it("a relay of the user's at a local address is the network", async () => {
    const { core, note, urls } = await start([BUILTIN!, DEAD[0]], { builtIn: false });
    const event = note();
    const accepted = urls(await core.publishToNetwork(event));
    expect(accepted).toHaveLength(1);
    expect(accepted[0].startsWith(BUILTIN!)).toBe(true);
    expect(await holds(BUILTIN!, event.id)).toBe("yes");
  }, 30000);

  // NDK's set holds only what is connected right now. With none of the
  // network's relays connected yet, the user's own list is tried.
  it("a relay of the user's that is not connected yet is connected to, and published to", async () => {
    const { core, ndk, note } = await start([REMOTE!], { builtIn: true, connect: false });
    const remote = Array.from(ndk.pool.relays.values()).find((relay) => relay.url.startsWith(REMOTE!));
    expect(remote?.connected ?? false, "not connected before the publish").toBe(false);
    const event = note();
    expect((await core.publishToNetwork(event)).size).toBe(1);
    expect(await holds(REMOTE!, event.id)).toBe("yes");
  }, 30000);

  // NDK never takes a relay off its list of borrowed ones, and leaves a
  // relay on that list out of the set it works out. A relay it once held to
  // read someone from, which the user then added to their list, was therefore
  // not published to, and "Posted." was the built-in relay's word.
  it("a relay in the user's list that NDK once borrowed is still published to", async () => {
    const { core, ndk, note, urls } = await start([REMOTE!], { builtIn: true });
    const remote = Array.from(ndk.pool.relays.values()).find((relay) => relay.url.startsWith(REMOTE!))!;
    const borrowed = (ndk.pool as unknown as { temporaryRelayTimers: Map<string, unknown> }).temporaryRelayTimers;
    expect(borrowed, "the field this rule reads from NDK").toBeInstanceOf(Map);
    borrowed.set(remote.url, 0);
    expect(ndk.pool.permanentAndConnectedRelays().map((relay) => relay.url), "NDK itself now leaves it out").not.toContain(remote.url);
    const event = note();
    const accepted = urls(await core.publishToNetwork(event));
    expect(accepted).toHaveLength(1);
    expect(accepted[0].startsWith(REMOTE!)).toBe(true);
    expect(await holds(REMOTE!, event.id)).toBe("yes");
  }, 30000);

  // NDK hands an event to every open subscription it matches the moment it
  // is published, before any relay has answered. A reply no relay took was
  // in the replies that were loading at the time.
  it("a note no relay took is not in a fetch that was on its way", async () => {
    const { core, ndk, note } = await start(DEAD, { builtIn: true });
    const event = note();
    const me = (await ndk.signer!.user()).pubkey;
    // What NDK does when not told otherwise: a subscription of our own sees the note at once.
    const seen: string[] = [];
    const plain = ndk.subscribe({ kinds: [1], authors: [me] }, { closeOnEose: false, groupable: false });
    plain.on("event", (e: NDKEvent) => seen.push(e.id));
    const loading = core.fetchWithTimeout(ndk, { kinds: [1], authors: [me] }, 4000);
    await sleep(200);
    await expect(core.publishToNetwork(event)).rejects.toThrow(/Not enough relays/);
    const loaded = await loading;
    plain.stop();
    expect(seen, "NDK's own behaviour, which is why the option is needed").toContain(event.id);
    expect(Array.from(loaded).map((e) => e.id)).not.toContain(event.id);
  }, 30000);

  // The message wraps go to a set of their own. The same rule holds for it.
  it("a set of its own: the network's answer, not the built-in relay's", async () => {
    const { core, ndk, note } = await start(DEAD, { builtIn: true });
    const { NDKRelaySet } = await import("@nostr-dev-kit/ndk");
    const dead = note();
    await expect(core.publishToNetwork(dead, NDKRelaySet.fromRelayUrls([BUILTIN!, DEAD[0]], ndk), 2000)).rejects.toThrow(/Not enough relays/);
    expect(await holds(BUILTIN!, dead.id)).toBe("no");
    const live = note();
    expect((await core.publishToNetwork(live, NDKRelaySet.fromRelayUrls([BUILTIN!, REMOTE!], ndk), 4000)).size).toBe(1);
    expect(await holds(REMOTE!, live.id)).toBe("yes");
  }, 30000);

  // The podcast list is "the relays' list wins", and a change is published
  // on top of what the relays hold. So what counts as "the relays' list"
  // decides what every device ends up with.
  describe("the podcast list, read from the user's relays", () => {
    const podcastList = (ndk: Awaited<ReturnType<typeof start>>["ndk"], names: string[]) => {
      const event = new NDKEvent(ndk);
      event.kind = 30003;
      event.content = "";
      event.tags = [["d", "podcasts"], ...names.map((name) => ["r", `https://example.com/${name}.xml`])];
      return event;
    };
    const titles = (read: { status: string; shows?: { feedUrl: string }[] }) => read.shows?.map((show) => show.feedUrl.replace(/^.*\/(\w+)\.xml$/, "$1"));

    it("is the list the network holds", async () => {
      const { core, ndk } = await start([REMOTE!], { builtIn: true });
      const podcasts = await import("./podcasts");
      const me = (await ndk.signer!.user()).pubkey;
      await core.publishToNetwork(podcastList(ndk, ["a", "b", "c"]));
      const read = await podcasts.fetchPodcastList(me);
      expect(read.status).toBe("found");
      expect(titles(read)).toEqual(["a", "b", "c"]);
    }, 30000);

    it("is 'none' when the network answers that there is no list", async () => {
      const { ndk } = await start([REMOTE!], { builtIn: true });
      const podcasts = await import("./podcasts");
      expect(await podcasts.fetchPodcastList((await ndk.signer!.user()).pubkey)).toEqual({ status: "none" });
    }, 30000);

    // The built-in relay holds this device's own last publish and answers at
    // once. With the user's relay out of reach it was the only answer, it was
    // taken for the relays' list, and a change was published on top of it:
    // what another device had done since was gone.
    it("cannot tell when only the built-in relay answers, although it holds a list", async () => {
      const { ndk } = await start(DEAD, { builtIn: true });
      const podcasts = await import("./podcasts");
      const me = (await ndk.signer!.user()).pubkey;
      const mine = podcastList(ndk, ["a", "b"]);
      await mine.sign();
      const builtIn = Array.from(ndk.pool.relays.values()).find((relay) => relay.url.startsWith(BUILTIN!))!;
      await builtIn.publish(mine);
      expect(await holds(BUILTIN!, mine.id), "the built-in relay does hold this device's copy").toBe("yes");
      const t0 = Date.now();
      const read = await podcasts.fetchPodcastList(me);
      console.log(`[publish] podcast list, only the built-in relay in reach: ${JSON.stringify(read)} in ${Date.now() - t0} ms`);
      expect(read).toEqual({ status: "unknown" });
    }, 30000);
  });
});
