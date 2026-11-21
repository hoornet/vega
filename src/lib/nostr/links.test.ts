import { describe, it, expect, vi, beforeEach } from "vitest";

// A link's relay hints were chosen by whoever made the link: only public wss:// relays, at most
// three, and asked only with Relay reach on, each on its own.

const core = vi.hoisted(() => ({
  reach: true,
  own: [] as unknown[],
  fromHint: [] as unknown[],
  fetchWithTimeout: vi.fn(),
  fetchFromRelay: vi.fn(),
  fromRelayUrls: vi.fn(),
}));

vi.mock("./core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core")>();
  return {
    ...actual,
    ensureConnected: vi.fn(async () => true),
    getNDK: () => ({}),
    isOutboxRelaysEnabled: () => core.reach,
    fetchWithTimeout: core.fetchWithTimeout,
    fetchFromRelay: core.fetchFromRelay,
  };
});

vi.mock("@nostr-dev-kit/ndk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nostr-dev-kit/ndk")>();
  return { ...actual, NDKRelaySet: { fromRelayUrls: core.fromRelayUrls } };
});

import { safeHintRelays, fetchLinkedEvent, MAX_HINT_RELAYS } from "./links";

beforeEach(() => {
  core.reach = true;
  core.fetchWithTimeout.mockReset().mockImplementation(async () => new Set(core.own));
  core.fetchFromRelay.mockReset().mockImplementation(async () => ({ events: core.fromHint, answered: true }));
  core.fromRelayUrls.mockReset().mockImplementation((urls: string[]) => ({ relays: new Set(urls.map((url) => ({ url }))) }));
  core.own = [];
  core.fromHint = [];
});

describe("safeHintRelays", () => {
  it("keeps public wss:// relays, each once, without a trailing slash", () => {
    expect(safeHintRelays(["wss://relay.example.com/", "wss://relay.example.com", "wss://nos.lol:443/path"]))
      .toEqual(["wss://relay.example.com", "wss://nos.lol/path"]);
    expect(safeHintRelays(["wss://8.8.8.8"])).toEqual(["wss://8.8.8.8"]);
    expect(safeHintRelays(undefined)).toEqual([]);
  });

  it("drops anything on this computer or its network, plain ws://, and addresses with a password", () => {
    expect(safeHintRelays([
      "ws://relay.example.com",
      "https://relay.example.com",
      "wss://localhost:4869",
      "wss://127.0.0.1",
      "wss://2130706433", // 127.0.0.1 written as one number
      "wss://0x7f.1",
      "wss://10.1.2.3",
      "wss://172.20.0.1",
      "wss://192.168.1.10",
      "wss://169.254.169.254",
      "wss://100.100.1.1",
      "wss://[::1]",
      "wss://[fd00::1]",
      "wss://router",
      "wss://printer.example.local",
      "wss://relay.example.internal",
      "wss://nas.home.arpa",
      "wss://user:secret@relay.example.com",
      "not a url",
      // A trailing dot is the same host to DNS, and `URL` keeps it.
      "wss://localhost.",
      "wss://printer.example.local.",
      "wss://127.0.0.1.",
      "wss://192.168.1.10..",
      // Short, numeric and hex IPv4 with empty labels: not an address to `URL` until the dots go.
      "wss://127.1..:8443",
      "wss://0x7f.1..",
      "wss://2130706433..",
      "wss://10.1..",
      "wss://192.168.1..",
    ])).toEqual([]);
  });

  it("reads a public host with a trailing dot as the same relay", () => {
    expect(safeHintRelays(["wss://relay.example.com.", "wss://relay.example.com"])).toEqual(["wss://relay.example.com"]);
    expect(safeHintRelays(["wss://relay.example.com.:7777/inbox"])).toEqual(["wss://relay.example.com:7777/inbox"]);
  });

  it("asks at most three", () => {
    const many = ["a", "b", "c", "d", "e"].map((host) => `wss://${host}.example.com`);
    expect(safeHintRelays(many)).toHaveLength(MAX_HINT_RELAYS);
    expect(MAX_HINT_RELAYS).toBe(3);
  });
});

describe("fetchLinkedEvent", () => {
  const filter = { ids: ["x"], limit: 1 };

  it("asks only the user's relays while Relay reach is off", async () => {
    core.reach = false;
    core.own = [{ id: "x", created_at: 5 }];
    expect(await fetchLinkedEvent(filter, ["wss://relay.example.com"])).toEqual({ id: "x", created_at: 5 });
    expect(core.fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(core.fromRelayUrls).not.toHaveBeenCalled();
    expect(core.fetchFromRelay).not.toHaveBeenCalled();
  });

  it("with Relay reach on, also asks each hint relay on its own, and takes the newest answer", async () => {
    core.own = [{ id: "a", created_at: 5 }];
    core.fromHint = [{ id: "a", created_at: 9 }];
    const found = await fetchLinkedEvent(filter, ["wss://one.example.com", "wss://two.example.com"]);
    expect(core.fromRelayUrls).toHaveBeenCalledWith(["wss://one.example.com", "wss://two.example.com"], expect.anything());
    expect(core.fetchFromRelay).toHaveBeenCalledTimes(2);
    expect(found).toEqual({ id: "a", created_at: 9 });
  });

  it("asks no extra relay for a link with no hints, and finds nothing when no relay has it", async () => {
    expect(await fetchLinkedEvent(filter, [])).toBeNull();
    expect(core.fromRelayUrls).not.toHaveBeenCalled();
  });
});
