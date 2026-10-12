// @vitest-environment node
//
// Node, not jsdom: a real relay connection uses undici's WebSocket, whose
// Event objects jsdom rejects. No relay is reached: the addresses never
// resolve, which is the point.
import { describe, it, expect, vi, beforeEach } from "vitest";

// A relay list where nothing connects. `.invalid` never resolves.
const DEAD = ["wss://relay-a.invalid", "wss://relay-b.invalid"];

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("wrystr_vega_relay_added", "1");
  localStorage.setItem("wrystr_relays", JSON.stringify(DEAD));
  localStorage.setItem("wrystr_use_author_relays", "false");
});

// Behind the Relay reach switch and "Try again". NDK's `connect()` resolves
// only once every relay in the list has connected, so with one relay down
// it never did, and the switch stayed busy for the rest of the session.
describe("resetNDK", () => {
  it("settles within seconds when no relay in the list can be reached", async () => {
    const core = await import("./core");
    const before = core.getNDK();
    const started = Date.now();
    await core.resetNDK();
    const took = Date.now() - started;
    expect(took).toBeLessThan(12_000);
    expect(core.getNDK()).not.toBe(before);
  }, 20_000);

  it("keeps the signer across the reset", async () => {
    const core = await import("./core");
    const { NDKPrivateKeySigner } = await import("@nostr-dev-kit/ndk");
    const signer = NDKPrivateKeySigner.generate();
    core.getNDK().signer = signer;
    await core.resetNDK();
    expect(core.getNDK().signer).toBe(signer);
  }, 20_000);
});
