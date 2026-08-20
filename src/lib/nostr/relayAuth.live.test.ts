// @vitest-environment node
//
// Must be node, not the suite's default jsdom: a real relay connection uses
// undici's WebSocket, whose Event objects jsdom rejects.
//
// Drives the real NIP-42 handshake against a real AUTH-requiring relay, through
// the same `getNDK()` the app uses. Unit tests cannot see this: the policy is
// only ever called by NDK, from a socket callback.
//
//   nak serve --port 10548 --auth &
//   VEGA_AUTH_RELAY=ws://localhost:10548 npx vitest run relayAuth.live
//
// `--auth` challenges on rejection; `--eager-auth` challenges on connect. Both
// orderings are worth running.
import { describe, it, expect, beforeAll } from "vitest";
import { NDKPrivateKeySigner, NDKRelayStatus, NDKKind } from "@nostr-dev-kit/ndk";

// Avoids a dev-dependency on @types/node just for one env lookup.
declare const process: { env: Record<string, string | undefined> };

const AUTH_RELAY = process.env.VEGA_AUTH_RELAY;

describe.skipIf(!AUTH_RELAY)("NIP-42 AUTH against a live relay", () => {
  beforeAll(() => {
    // Seed before the first getNDK(): NDK reads explicitRelayUrls once, at
    // construction. Scope stays at its "configured" default, so this also
    // proves the relay is allowed *because* it is in the stored list.
    localStorage.setItem("wrystr_vega_relay_added", "1");
    localStorage.setItem("wrystr_relays", JSON.stringify([AUTH_RELAY]));
    localStorage.removeItem("wrystr_relay_auth_scope");
  });

  it("authenticates, and only reports AUTHENTICATED on the second authed event", async () => {
    const { getNDK } = await import("./core");
    const { getRelayAuthScope, isRelayAuthenticated } = await import("./relayAuth");

    expect(getRelayAuthScope()).toBe("configured");

    const ndk = getNDK();
    expect(typeof ndk.relayAuthDefaultPolicy).toBe("function");
    ndk.signer = NDKPrivateKeySigner.generate();

    // Attach BEFORE connect. Relays are constructed from explicitRelayUrls in
    // the NDK constructor, and under `--eager-auth` the challenge and both of
    // its `authed` emits land during connect — attaching afterwards silently
    // records nothing and the test fails on its own instrumentation.
    const relay = [...ndk.pool.relays.values()][0];
    expect(relay).toBeDefined();

    // NDK emits `authed` twice: once synchronously from onAuthRequested before
    // the 22242 has been signed (status 5), and once after the relay's OK
    // (status 8). Recording the status at each is the cheap, deterministic way
    // to prove the premature emit is real — anything that treats the first as
    // "we are authenticated" is broken for slow (bunker) signers.
    const statuses: number[] = [];
    relay!.on("authed", () => statuses.push(relay!.status));

    await ndk.connect();
    await new Promise((r) => setTimeout(r, 500));

    // Issue a REQ so a lazy-auth relay has a reason to challenge.
    const sub = ndk.subscribe({ kinds: [NDKKind.Text], limit: 1 }, { closeOnEose: true, groupable: false });
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      sub.on("eose", done);
      setTimeout(done, 8000);
    });

    // Give the handshake room to finish.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && relay!.status !== NDKRelayStatus.AUTHENTICATED) {
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(relay!.status).toBe(NDKRelayStatus.AUTHENTICATED);
    expect(isRelayAuthenticated(relay!)).toBe(true);
    expect(statuses.length).toBeGreaterThan(0);
    // The last authed always carries the real status.
    expect(statuses[statuses.length - 1]).toBe(NDKRelayStatus.AUTHENTICATED);

    // Measured against `nak serve --auth` on 2026-08-20: [5, 5, 8, 8] — the
    // relay challenges twice (once on connect, once on the REQ rejection) and
    // each challenge emits `authed` twice. Every non-AUTHENTICATED emit must be
    // CONNECTED(5), i.e. premature. If one of these ever reads 8 without the
    // relay having acknowledged, the "wait for authed" shortcut becomes
    // tempting again — and it is wrong for any signer slower than a local key.
    //
    // Not asserting an exact sequence: under `--eager-auth` the first pair can
    // land before this listener attaches.
    for (const s of statuses.filter((v) => v !== NDKRelayStatus.AUTHENTICATED)) {
      expect(s).toBe(NDKRelayStatus.CONNECTED);
    }
  }, 40000);

  it("declines a relay that is not in the stored list", async () => {
    const { getRelayAuthScope, shouldAuthenticate } = await import("./relayAuth");
    // Same decision the policy makes, against the live stored list.
    expect(
      shouldAuthenticate("wss://someone-elses-relay.invalid/", getRelayAuthScope(), new Set([AUTH_RELAY!]), false),
    ).toBe(false);
  });
});
