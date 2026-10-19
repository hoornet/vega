// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import NDK, { NDKEvent, NDKKind, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { probeWallet } from "./nwc";

// The wallet probe against a real relay and a small wallet of our own:
//
//   nak serve --port 28549 &
//   VEGA_WALLET_RELAY=ws://localhost:28549 npx vitest run probeWallet.live
//
// Gated on the env var so CI stays hermetic. undici's WebSocket dies under jsdom, hence node.
declare const process: { env: Record<string, string | undefined> };
const RELAY = process.env.VEGA_WALLET_RELAY;

/** A wallet: answers every get_info on the relay with what it is told to, NIP-04 encrypted to the asker. */
async function wallet(reply: object | null) {
  const signer = NDKPrivateKeySigner.generate();
  const ndk = new NDK({ explicitRelayUrls: [RELAY!], enableOutboxModel: false });
  ndk.signer = signer;
  await ndk.connect(3000);
  const pubkey = (await signer.user()).pubkey;
  const sub = ndk.subscribe({ kinds: [NDKKind.NostrWalletConnectReq], "#p": [pubkey], since: Math.floor(Date.now() / 1000) - 5 }, { closeOnEose: false });
  // The relay does not keep ephemeral events: the wallet must be listening before the request is sent.
  await new Promise<void>((resolve) => { sub.on("eose", () => resolve()); setTimeout(resolve, 3000); });
  sub.on("event", async (req: NDKEvent) => {
    if (!reply) return;
    const asker = ndk.getUser({ pubkey: req.pubkey });
    const res = new NDKEvent(ndk);
    res.kind = NDKKind.NostrWalletConnectRes;
    res.content = await signer.encrypt(asker, JSON.stringify(reply), "nip04");
    res.tags = [["p", req.pubkey], ["e", req.id!]];
    await res.publish();
  });
  const stop = () => { sub.stop(); for (const r of ndk.pool.relays.values()) r.connectivity.disconnect(); };
  const code = `nostr+walletconnect://${pubkey}?relay=${encodeURIComponent(RELAY!)}&secret=${NDKPrivateKeySigner.generate().privateKey}`;
  return { code, stop };
}

const stops: Array<() => void> = [];
afterEach(() => { for (const s of stops.splice(0)) s(); });

describe.skipIf(!RELAY)("probeWallet, against a real relay", () => {
  it("is ok when the wallet answers with a result", async () => {
    const w = await wallet({ result_type: "get_info", result: { alias: "test" } }); stops.push(w.stop);
    expect(await probeWallet(w.code, 6000)).toBe("ok");
  }, 20000);

  it("is ok when the wallet refuses the method but not the code: it is there", async () => {
    const w = await wallet({ result_type: "get_info", error: { code: "RESTRICTED", message: "no" } }); stops.push(w.stop);
    expect(await probeWallet(w.code, 6000)).toBe("ok");
  }, 20000);

  it("is refused when the wallet does not know the code", async () => {
    const w = await wallet({ result_type: "get_info", error: { code: "UNAUTHORIZED", message: "This public key has no wallet connected" } }); stops.push(w.stop);
    expect(await probeWallet(w.code, 6000)).toBe("refused");
  }, 20000);

  it("is unreachable when nothing answers, and when the relay is not there", async () => {
    const w = await wallet(null); stops.push(w.stop);
    expect(await probeWallet(w.code, 2000)).toBe("unreachable");
    const nowhere = w.code.replace(encodeURIComponent(RELAY!), encodeURIComponent("ws://127.0.0.1:1"));
    expect(await probeWallet(nowhere, 2000)).toBe("unreachable");
  }, 30000);
});
