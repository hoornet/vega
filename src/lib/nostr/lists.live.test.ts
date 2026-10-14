// @vitest-environment node
//
// The mute list, with real NDK and two real relays: the list held by one
// relay only is found, a mute is published on top of it with its content and
// other tags kept, and with that relay gone nothing is published at all.
// The stores are tested with the read and the publish stood in for; this is
// the check that the real read and the real publish behave as stood in.
//
//   nak serve --hostname 127.0.0.2 --port 28548 &
//   nak serve --hostname 127.0.0.3 --port 28549 &
//   VEGA_LISTS_A=ws://127.0.0.2:28548 VEGA_LISTS_B=ws://127.0.0.3:28549 VEGA_LISTS_B_PID=<pid of the second> npx vitest run lists.live
//
// Both are "remote" by `isLocalRelayUrl` (only localhost / 127.0.0.1 is the built-in relay).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NDKEvent, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";

declare const process: { env: Record<string, string | undefined>; kill: (pid: number, signal: string) => void };
const A = process.env.VEGA_LISTS_A;
const B = process.env.VEGA_LISTS_B;
const ready = !!A && !!B;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send a signed event to one relay over a socket of our own. */
function seed(url: string, raw: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`seeding ${url} timed out`)); }, 3000);
    ws.onopen = () => ws.send(JSON.stringify(["EVENT", raw]));
    ws.onmessage = (m) => { const [kind] = JSON.parse(String(m.data)) as [string]; if (kind === "OK") { clearTimeout(timer); ws.close(); resolve(); } };
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`could not reach ${url}`)); };
  });
}

/** What a relay holds for an author and kind: the newest event's tags and content, or null. */
function held(url: string, pubkey: string, kind: number): Promise<{ tags: string[][]; content: string } | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let newest: { tags: string[][]; content: string; created_at: number } | null = null;
    const done = () => { clearTimeout(timer); try { ws.close(); } catch { /* closed */ } resolve(newest ? { tags: newest.tags, content: newest.content } : null); };
    const timer = setTimeout(done, 3000);
    ws.onopen = () => ws.send(JSON.stringify(["REQ", "held", { kinds: [kind], authors: [pubkey] }]));
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data)) as [string, string, { tags: string[][]; content: string; created_at: number }];
      if (msg[0] === "EVENT" && (!newest || msg[2].created_at > newest.created_at)) newest = msg[2];
      if (msg[0] === "EOSE") done();
    };
    ws.onerror = done;
  });
}

async function start(configured: string[], secret: string) {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("wrystr_vega_relay_added", "1");
  localStorage.setItem("wrystr_relays", JSON.stringify(configured));
  localStorage.setItem("wrystr_use_author_relays", "false");
  const core = await import("./core");
  const ndk = core.getNDK();
  const signer = new NDKPrivateKeySigner(secret);
  ndk.signer = signer;
  const pubkey = (await signer.user()).pubkey;
  void ndk.connect().catch(() => {});
  const { setCurrentAccount } = await import("../currentAccount");
  setCurrentAccount(pubkey);
  const { useMuteStore } = await import("../../stores/mute");
  await sleep(1500);
  return { ndk, pubkey, signer, useMuteStore };
}

/** A list for the account of `secret` on one relay: content and a tag of another kind, from `agoSeconds` ago. */
async function seedList(secret: string, { url = B!, tags = [["p", "a".repeat(64)], ["t", "spam"]], agoSeconds = 5 }: { url?: string; tags?: string[][]; agoSeconds?: number } = {}): Promise<void> {
  vi.resetModules();
  const { getNDK } = await import("./core");
  const signer = new NDKPrivateKeySigner(secret);
  const event = new NDKEvent(getNDK());
  event.kind = 10000;
  event.content = "private-mutes";
  event.tags = tags;
  event.created_at = Math.floor(Date.now() / 1000) - agoSeconds;
  await event.sign(signer);
  await seed(url, event.rawEvent());
}

describe.skipIf(!ready)("the mute list, with real NDK and real relays", () => {
  beforeEach(() => { localStorage.clear(); });

  it("finds the list held by one relay only, and publishes a mute on top of it, everything else kept", async () => {
    // Each case its own account: the one before has published its list to A as well.
    const secret = "7".repeat(63) + Date.now().toString(16).slice(-1);
    await seedList(secret);
    const { pubkey, useMuteStore } = await start([A!, B!], secret);
    await useMuteStore.getState().fetchMuteList(pubkey);
    expect(useMuteStore.getState().mutedPubkeys).toEqual(["a".repeat(64)]);
    await useMuteStore.getState().mute("b".repeat(64));
    await sleep(4000);
    expect(useMuteStore.getState().mutedPubkeys).toEqual(["a".repeat(64), "b".repeat(64)]);
    for (const url of [A!, B!]) {
      const now = await held(url, pubkey, 10000);
      expect(now, url).toEqual({ tags: [["p", "a".repeat(64)], ["t", "spam"], ["p", "b".repeat(64)]], content: "private-mutes" });
    }
  }, 30000);

  // B frozen with SIGSTOP: its socket stays open and it answers nothing, the
  // half-open case of #65. The relays then could not tell, and nothing goes
  // out over the list B holds. (B simply down is the contact list's open gap:
  // only connected relays are asked, A answers "none", and a first list is
  // started. See CLAUDE.md.)
  it.skipIf(!process.env.VEGA_LISTS_B_PID)("publishes nothing while the relay holding the list does not answer, and keeps the mute here", async () => {
    const pid = Number(process.env.VEGA_LISTS_B_PID);
    const secret = "8".repeat(60) + Date.now().toString(16).slice(-4);
    await seedList(secret);
    const { pubkey, useMuteStore } = await start([A!, B!], secret);
    process.kill(pid, "SIGSTOP");
    try {
      await useMuteStore.getState().fetchMuteList(pubkey);
      await useMuteStore.getState().mute("c".repeat(64));
      await sleep(8000);
      expect(useMuteStore.getState().mutedPubkeys).toEqual(["c".repeat(64)]);
      expect(await held(A!, pubkey, 10000), "nothing published over the list B holds").toBeNull();
      expect(JSON.parse(localStorage.getItem(`wrystr_mute_changes_${pubkey}`)!)).toEqual({ p: { add: ["c".repeat(64)], remove: [] } });
    } finally {
      process.kill(pid, "SIGCONT");
    }
  }, 40000);

  // The gap that remains, pinned so that it is known and so that an
  // improvement shows up here: an answering relay holds an older copy, the
  // relay with the newer one stays silent. The newer one was never seen by
  // this device, so there is nothing to compare against; the change goes
  // out on the older copy, and the newer list loses to it once the silent
  // relay wakes. The contact list has the same gap. Fixing it means asking
  // what a silent relay holds, which cannot be done while it is silent.
  it.skipIf(!process.env.VEGA_LISTS_B_PID)("open gap: a newer list on a relay that stays silent loses to a change made on an older copy", async () => {
    const pid = Number(process.env.VEGA_LISTS_B_PID);
    const secret = "9".repeat(60) + Date.now().toString(16).slice(-4);
    await seedList(secret, { url: A!, tags: [["p", "a".repeat(64)]], agoSeconds: 100 });
    await seedList(secret, { url: B!, tags: [["p", "a".repeat(64)], ["p", "z".repeat(64)]], agoSeconds: 5 });
    const { pubkey, useMuteStore } = await start([A!, B!], secret);
    process.kill(pid, "SIGSTOP");
    try {
      await useMuteStore.getState().fetchMuteList(pubkey);
      expect(useMuteStore.getState().mutedPubkeys, "the older copy is all that answered").toEqual(["a".repeat(64)]);
      await useMuteStore.getState().mute("c".repeat(64));
      await sleep(8000);
      expect(await held(A!, pubkey, 10000), "published on the older copy").toEqual({ tags: [["p", "a".repeat(64)], ["p", "c".repeat(64)]], content: "private-mutes" });
    } finally {
      process.kill(pid, "SIGCONT");
    }
    await sleep(500);
    // B, awake again, now holds the newer event: z is gone.
    expect(await held(B!, pubkey, 10000)).toEqual({ tags: [["p", "a".repeat(64)], ["p", "c".repeat(64)]], content: "private-mutes" });
  }, 40000);
});
