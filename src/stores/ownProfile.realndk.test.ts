// The account's own profile, with real NDK.
//
// What NDK takes for "the profile the relays hold" is decided inside NDK: it
// ends a fetch once most relays have answered, and hands a published event
// to open subscriptions before any relay has it. Stand-ins for NDK agree with
// whatever the code assumes, so these run the real `core.ts`, `social.ts`,
// `user.ts` and `useProfile.ts` on real NDK. The only stand-ins are the
// WebSocket (relays inside this process: no ports, no network), Tauri's
// `invoke` (a profiles table in memory) and the stores that have nothing to
// do with profiles.
//
// The relay model came out of the independent review of this change, which
// used it to show the store taking an older profile.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../lib/notificationPoller", () => ({ startNotificationPoller: vi.fn(), stopNotificationPoller: vi.fn() }));
vi.mock("./mute", () => ({ useMuteStore: { getState: () => ({ fetchMuteList: vi.fn() }) } }));
vi.mock("./lightning", () => ({ useLightningStore: { getState: () => ({ loadNwcForAccount: vi.fn() }) } }));
vi.mock("./ui", () => ({ useUIStore: { getState: () => ({ setView: vi.fn() }) } }));
vi.mock("./feed", () => ({ useFeedStore: { getState: () => ({ loadFeed: vi.fn() }) } }));
vi.mock("./notifications", () => ({ useNotificationsStore: { getState: () => ({ fetchNotifications: vi.fn() }) } }));
vi.mock("./podcast", () => ({ usePodcastStore: { getState: () => ({ setActiveAccount: vi.fn(), hydrateSubscriptions: vi.fn(), forgetAccount: vi.fn() }) } }));

type Raw = { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][]; sig: string };
type Filter = { ids?: string[]; kinds?: number[]; authors?: string[]; since?: number; until?: number } & Record<string, unknown>;

/** Whether an event answers a subscription, as far as a relay decides it: by id, kind, author, time and tag. */
function matchFilters(filters: Filter[], e: Raw): boolean {
  return filters.some((f) =>
    (!f.ids || f.ids.includes(e.id)) &&
    (!f.kinds || f.kinds.includes(e.kind)) &&
    (!f.authors || f.authors.includes(e.pubkey)) &&
    (f.since === undefined || e.created_at >= f.since) &&
    (f.until === undefined || e.created_at <= f.until) &&
    Object.entries(f).every(([key, values]) => !key.startsWith("#") || e.tags.some((t) => t[0] === key.slice(1) && (values as string[]).includes(t[1]))));
}
/** How a relay behaves: slow to answer a question, deaf to everything, or refusing what is published to it. */
interface RelayOpts { answerMs?: number; deaf?: boolean; refuses?: boolean }

class RelayModel {
  events = new Map<string, Raw>();
  open = new Map<FakeSocket, Map<string, Filter[]>>();
  constructor(public opts: RelayOpts) {}
  /** Take an event as a relay does: of a profile, only the newest is kept. */
  hold(e: Raw): void {
    for (const [id, old] of this.events) {
      if (old.kind === e.kind && old.pubkey === e.pubkey && e.kind === 0) {
        if (old.created_at >= e.created_at) return;
        this.events.delete(id);
      }
    }
    this.events.set(e.id, e);
  }
  name(pubkey: string): string | null {
    const held = Array.from(this.events.values()).find((e) => e.kind === 0 && e.pubkey === pubkey);
    return held ? (JSON.parse(held.content) as { name: string }).name : null;
  }
}
const relays = new Map<string, RelayModel>();
const host = (url: string) => new URL(url).host;

class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0;
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  model: RelayModel | undefined;
  constructor(public url: string) {
    this.model = relays.get(host(url));
    setTimeout(() => {
      if (!this.model) { this.readyState = 3; this.onerror?.({}); this.onclose?.({}); return; }
      this.readyState = 1; this.model.open.set(this, new Map()); this.onopen?.({});
    }, 5);
  }
  private say(msg: unknown[]) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(msg) }); }
  send(data: string) {
    const m = this.model;
    if (!m || m.opts.deaf) return;
    const msg = JSON.parse(data) as unknown[];
    if (msg[0] === "REQ") {
      const [, subId, ...filters] = msg as [string, string, ...Filter[]];
      // What the relay holds when the question reaches it. The answer takes `answerMs` to travel.
      const found = Array.from(m.events.values()).filter((e) => matchFilters(filters, e));
      m.open.get(this)?.set(subId, filters);
      setTimeout(() => { for (const e of found) this.say(["EVENT", subId, e]); this.say(["EOSE", subId]); }, m.opts.answerMs ?? 20);
    } else if (msg[0] === "CLOSE") {
      m.open.get(this)?.delete(msg[1] as string);
    } else if (msg[0] === "EVENT") {
      const e = msg[1] as Raw;
      setTimeout(() => {
        const ok = !m.opts.refuses;
        if (ok) m.hold(e);
        this.say(["OK", e.id, ok, ok ? "" : "blocked: not on this relay"]);
      }, 20);
    }
  }
  close() { this.readyState = 3; this.model?.open.delete(this); setTimeout(() => this.onclose?.({}), 0); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const profilesTable = new Map<string, string>();
const realWebSocket = (globalThis as unknown as { WebSocket: unknown }).WebSocket;

/** A fresh app with these relays in its list, all connected. */
async function freshApp(config: Record<string, RelayOpts>) {
  vi.resetModules();
  relays.clear();
  for (const [name, opts] of Object.entries(config)) relays.set(`${name}.test`, new RelayModel(opts));
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  localStorage.clear();
  localStorage.setItem("wrystr_vega_relay_added", "1");
  localStorage.setItem("wrystr_relays", JSON.stringify(Object.keys(config).map((name) => `wss://${name}.test`)));
  // Relay reach off, so nothing here reaches for relays that are not in the list.
  localStorage.setItem("wrystr_use_author_relays", "false");
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as { pubkey?: string; content?: string };
    if (cmd === "db_load_profile") return profilesTable.get(a.pubkey!) ?? null;
    if (cmd === "db_save_profile") { profilesTable.set(a.pubkey!, a.content!); return null; }
    return null;
  });
  const ndkLib = await import("@nostr-dev-kit/ndk");
  const core = await import("../lib/nostr/core");
  const social = await import("../lib/nostr/social");
  const { useUserStore } = await import("./user");
  const cache = await import("../hooks/useProfile");
  void core.getNDK().connect().catch(() => {});
  await sleep(200);
  const key = ndkLib.NDKPrivateKeySigner.generate();
  /** A signed profile of the account's, as a relay would hold it. */
  const profile = async (name: string, createdAt: number): Promise<Raw> => {
    const event = new ndkLib.NDKEvent(undefined, { kind: 0, content: JSON.stringify({ name }), created_at: createdAt, tags: [], pubkey: key.pubkey } as never);
    await event.sign(key);
    return event.rawEvent() as Raw;
  };
  const shown = () => ({
    profile: (useUserStore.getState().profile as { name?: string } | null)?.name ?? null,
    sidebar: useUserStore.getState().accounts.find((a) => a.pubkey === key.pubkey)?.name ?? null,
  });
  const onThisComputer = () => { const row = profilesTable.get(key.pubkey); return row ? (JSON.parse(row) as { name?: string }).name ?? null : null; };
  return { ndkLib, social, store: useUserStore, cache, key, profile, shown, onThisComputer, relay: (name: string) => relays.get(`${name}.test`)! };
}

beforeEach(() => { profilesTable.clear(); });
afterAll(() => { (globalThis as unknown as { WebSocket: unknown }).WebSocket = realWebSocket; });

/** A promise, and whether it has settled yet: to hold a test to the order of events it is about. */
function watched<T>(promise: Promise<T>) {
  const state = { settled: false };
  const done = promise.finally(() => { state.settled = true; });
  return { done, get settled() { return state.settled; } };
}

describe("the account's own profile, with real NDK", () => {
  // The profile was saved a minute ago and one relay has it. The three quick
  // ones still hold the one before it, and a single fetch over all four ends
  // once those three have answered. Nothing is on this computer to fall back
  // on, so only asking each relay on its own gets the newer one.
  it("the newest profile is the one shown, when only the slowest relay holds it", async () => {
    const app = await freshApp({ a: { answerMs: 1500 }, b: {}, c: {}, d: {} });
    const now = Math.floor(Date.now() / 1000);
    app.relay("a").hold(await app.profile("new name", now - 100));
    const older = await app.profile("old name", now - 5000);
    for (const name of ["b", "c", "d"]) app.relay(name).hold(older);

    await app.store.getState().loginWithNsec(app.key.nsec);
    await app.store.getState().fetchOwnProfile();
    expect(app.shown()).toEqual({ profile: "new name", sidebar: "new name" });
    expect(app.onThisComputer()).toBe("new name");
  }, 30000);

  it("shows what the quick relays hold without waiting for the slow one", async () => {
    const app = await freshApp({ a: { answerMs: 2500 }, b: {}, c: {} });
    const now = Math.floor(Date.now() / 1000);
    const only = await app.profile("the name", now - 100);
    for (const name of ["b", "c"]) app.relay(name).hold(only);
    await app.store.getState().loginWithNsec(app.key.nsec);
    const reading = watched(app.store.getState().fetchOwnProfile());
    await sleep(600);
    expect(reading.settled, "the slow relay has not answered yet").toBe(false);
    expect(app.shown()).toEqual({ profile: "the name", sidebar: "the name" });
    await reading.done;
  }, 30000);

  it("an older profile on every relay does not replace a newer copy on this computer", async () => {
    const app = await freshApp({ a: {}, b: {} });
    const now = Math.floor(Date.now() / 1000);
    const older = await app.profile("old name", now - 5000);
    const newer = await app.profile("new name", now - 100);
    for (const name of ["a", "b"]) app.relay(name).hold(older);
    profilesTable.set(app.key.pubkey, JSON.stringify(app.ndkLib.profileFromEvent(new app.ndkLib.NDKEvent(undefined, newer as never))));
    await app.store.getState().loginWithNsec(app.key.nsec);
    await app.store.getState().fetchOwnProfile();
    expect(app.shown().profile).toBe("new name");
    expect(app.onThisComputer()).toBe("new name");
  }, 30000);

  // One relay is connected and never answers, so a read is out for seconds.
  // The user edits their profile meanwhile. When the read came back it put
  // the profile from before the edit back on screen.
  it("a profile saved while a read is out is not replaced when the read comes back", async () => {
    const app = await freshApp({ a: {}, b: { deaf: true } });
    const now = Math.floor(Date.now() / 1000);
    app.relay("a").hold(await app.profile("old name", now - 5000));
    await app.store.getState().loginWithNsec(app.key.nsec);
    const reading = watched(app.store.getState().fetchOwnProfile());
    await sleep(300);
    expect(app.shown().profile, "what the relay that answered holds").toBe("old name");
    await app.store.getState().saveProfile({ name: "new name" }, app.key.pubkey);
    expect(reading.settled, "the read is still waiting for the deaf relay").toBe(false);
    expect(app.shown()).toEqual({ profile: "new name", sidebar: "new name" });
    expect(app.relay("a").name(app.key.pubkey)).toBe("new name");
    await reading.done;
    expect(app.shown()).toEqual({ profile: "new name", sidebar: "new name" });
    expect((await app.cache.peekCachedProfile(app.key.pubkey))?.name).toBe("new name");
    expect(app.onThisComputer()).toBe("new name");
  }, 30000);

  // A new account's name that every relay refused was said to be not
  // published, and was in the sidebar ten seconds later all the same: NDK
  // had handed the unpublished event to the read that was out.
  it("a name no relay took is not shown, at once or when the read that was out comes back", async () => {
    const app = await freshApp({ a: { refuses: true, answerMs: 1500 }, b: { refuses: true, answerMs: 1500 } });
    await app.store.getState().loginWithNsec(app.key.nsec);
    const reading = watched(app.store.getState().fetchOwnProfile());
    await sleep(200);
    await expect(app.store.getState().saveProfile({ name: "Ana", display_name: "Ana" }, app.key.pubkey)).rejects.toThrow(/Not enough relays/);
    expect(reading.settled, "the read was out while the name was published").toBe(false);
    expect(app.shown()).toEqual({ profile: null, sidebar: null });
    await reading.done;
    expect(app.shown()).toEqual({ profile: null, sidebar: null });
    expect(app.onThisComputer()).toBeNull();
  }, 30000);

  it("a name the relays took is shown at once, and stays", async () => {
    const app = await freshApp({ a: {}, b: {} });
    await app.store.getState().loginWithNsec(app.key.nsec);
    await app.store.getState().saveProfile({ name: "Ana", display_name: "Ana" }, app.key.pubkey);
    expect(app.shown()).toEqual({ profile: "Ana", sidebar: "Ana" });
    expect(app.relay("a").name(app.key.pubkey)).toBe("Ana");
    expect(app.relay("b").name(app.key.pubkey)).toBe("Ana");
    await app.store.getState().fetchOwnProfile();
    expect(app.shown()).toEqual({ profile: "Ana", sidebar: "Ana" });
    expect(app.onThisComputer()).toBe("Ana");
  }, 30000);
});
