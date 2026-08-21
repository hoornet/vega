// @vitest-environment node
//
// One signature per handshake (#50), against a live AUTH-requiring relay.
//
// Its own file because getNDK() is a module singleton that authenticates once:
// a second test in the same file inherits an already-authenticated relay and
// never draws a fresh challenge. Same reason relayPruneVisibility.test.ts is
// split out.
//
//   nak serve --port 10548 --auth &
//   VEGA_AUTH_RELAY=ws://localhost:10548 npx vitest run relayAuthStorm.live
import { describe, it, expect, beforeAll } from "vitest";
import { NDKPrivateKeySigner, NDKRelayStatus, NDKKind } from "@nostr-dev-kit/ndk";

declare const process: { env: Record<string, string | undefined> };

const AUTH_RELAY = process.env.VEGA_AUTH_RELAY;

describe.skipIf(!AUTH_RELAY)("NIP-42 signature count", () => {
  beforeAll(() => {
    localStorage.setItem("wrystr_vega_relay_added", "1");
    localStorage.setItem("wrystr_relays", JSON.stringify([AUTH_RELAY]));
    localStorage.removeItem("wrystr_relay_auth_scope");
  });

  it("asks the signer for exactly one signature per handshake", async () => {
    // The storm only appears with a signer slow enough that NDK re-challenges
    // while the first signature is still in flight — invisible with a local
    // key (sub-millisecond), 3 signatures against a real bunker. A deliberate
    // delay reproduces the bunker case without needing one.
    const { getNDK } = await import("./core");
    const ndk = getNDK();

    const signer = NDKPrivateKeySigner.generate();
    let authSignatures = 0;
    const realSign = signer.sign.bind(signer);
    signer.sign = async (event: { kind?: number }) => {
      if (event.kind === 22242) {
        authSignatures++;
        await new Promise((r) => setTimeout(r, 800));
      }
      return realSign(event as never);
    };
    ndk.signer = signer;

    const relay = [...ndk.pool.relays.values()][0];
    await ndk.connect();
    await new Promise((r) => setTimeout(r, 500));

    const sub = ndk.subscribe({ kinds: [NDKKind.Text], limit: 1 }, { closeOnEose: true, groupable: false });
    await new Promise<void>((r) => { sub.on("eose", () => r()); setTimeout(r, 12000); });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && relay!.status !== NDKRelayStatus.AUTHENTICATED) {
      await new Promise((r) => setTimeout(r, 200));
    }

    // The guard must not wedge the handshake — this is the failure mode that
    // made it too risky to add without a live check.
    expect(relay!.status).toBe(NDKRelayStatus.AUTHENTICATED);
    expect(authSignatures).toBe(1);
  }, 60000);

});
