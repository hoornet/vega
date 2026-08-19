// @vitest-environment node
//
// Must be node, not the suite's default jsdom: a real relay connection uses
// undici's WebSocket, whose Event objects jsdom rejects as "must be an instance
// of Event. Received an instance of Event".
import { describe, it, expect } from "vitest";
import NDK, { NDKNip46Signer } from "@nostr-dev-kit/ndk";
import { acceptSecretEchoAsAck, connectWithTimeout } from "./nip46";

// Avoids a dev-dependency on @types/node just for two env lookups.
declare const process: { env: Record<string, string | undefined> };

/**
 * End-to-end NIP-46 reconnect test against a *real* bunker over a *real* relay.
 *
 * Skipped unless VEGA_BUNKER_URI is set, so CI and `npm test` stay hermetic.
 * To run it:
 *
 *   nak serve --port 10547 &
 *   node scripts/echo-bunker.mjs --relay ws://localhost:10547 --secret vega-test-secret
 *   VEGA_BUNKER_URI='<the bunker:// URI it prints>' npx vitest run nip46.live
 *
 * The bunker must answer `connect` by echoing the secret rather than "ack" —
 * that is what Bunker46 does (`result = connection.secret || 'ack'`, see #17),
 * and it is what `scripts/echo-bunker.mjs` imitates. Neither `nak bunker` nor
 * NDK's own NDKNip46Backend behaves that way, so neither reproduces this bug.
 */
const BUNKER_URI = process.env.VEGA_BUNKER_URI;
const RELAY = process.env.VEGA_BUNKER_RELAY ?? "ws://localhost:10547";

async function freshNdk() {
  const ndk = new NDK({ explicitRelayUrls: [RELAY], enableOutboxModel: false });
  await ndk.connect();
  await new Promise((r) => setTimeout(r, 500));
  return ndk;
}

describe.skipIf(!BUNKER_URI)("NIP-46 against a secret-echoing bunker", () => {
  it("logs in, then reconnects from the persisted payload after a restart", async () => {
    // --- login, exactly as loginWithRemoteSigner does ---
    const signer = NDKNip46Signer.bunker(await freshNdk(), BUNKER_URI!);
    acceptSecretEchoAsAck(signer);
    const user = await connectWithTimeout(signer, 15000);
    expect(user.pubkey).toMatch(/^[0-9a-f]{64}$/);

    const payload = signer.toPayload();
    // The persisted payload carries the one-shot secret forward, which is why
    // every later reconnect re-sends it and gets echoed again.
    expect(JSON.parse(payload).payload.secret).toBeTruthy();

    // --- restart WITHOUT the hook: this is Vega <= 0.15.3, and it must fail ---
    // NDK rejects with `response.error`, which is undefined on a *successful*
    // secret echo — so this rejects with literally `undefined`. That is the
    // "Remote signer login failed: undefined" users saw. `.rejects.toBeDefined()`
    // would wrongly fail here, so capture the rejection instead of matching it.
    const unpatched = await NDKNip46Signer.fromPayload(payload, await freshNdk());
    let rejected = false;
    let rejectionReason: unknown = "not-rejected";
    try {
      await connectWithTimeout(unpatched, 12000);
    } catch (err) {
      rejected = true;
      rejectionReason = err;
    }
    expect(rejected).toBe(true);
    expect(rejectionReason).toBeUndefined();

    // --- restart WITH the hook: the #47 fix ---
    const patched = await NDKNip46Signer.fromPayload(payload, await freshNdk());
    acceptSecretEchoAsAck(patched);
    const restored = await connectWithTimeout(patched, 12000);
    expect(restored.pubkey).toBe(user.pubkey);
  }, 60000);
});
