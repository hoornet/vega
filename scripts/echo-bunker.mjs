/**
 * A NIP-46 bunker that answers `connect` by echoing the secret instead of "ack".
 *
 * This is the documented behaviour of Bunker46, whose handler is
 *   result = connection.secret || 'ack'
 * (see hoornet/vega#17). NIP-46 explicitly permits it: a signer may answer
 * `connect` with either "ack" or the secret from the bunker:// URI.
 *
 * Neither `nak bunker` nor NDK's own NDKNip46Backend does this — both return a
 * hardcoded "ack" — so nothing off the shelf reproduces #17/#47. Hence this.
 */
import NDK, { NDKPrivateKeySigner, NDKNip46Backend } from "@nostr-dev-kit/ndk";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const relay = arg("relay", "ws://localhost:10547");
const secret = arg("secret", "vega-test-secret");
const sec = arg("sec") ?? bytesToHex(NDKPrivateKeySigner.generate().privateKey);

function bytesToHex(v) {
  return typeof v === "string" ? v : Buffer.from(v).toString("hex");
}

const ndk = new NDK({ explicitRelayUrls: [relay], enableOutboxModel: false });
await ndk.connect();
await new Promise((r) => setTimeout(r, 500));

const signer = new NDKPrivateKeySigner(sec);
const user = await signer.user();

const backend = new NDKNip46Backend(ndk, signer, async () => true, [relay]);

// The whole point: echo the secret rather than acking.
backend.setStrategy("connect", {
  async handle(_backend, id, remotePubkey, params) {
    console.log(`[bunker] connect from ${remotePubkey.slice(0, 12)}… params=${JSON.stringify(params)}`);
    console.log(`[bunker] --> echoing secret ${JSON.stringify(secret)} (Bunker46 behaviour), NOT "ack"`);
    return secret;
  },
});

for (const method of ["sign_event", "get_public_key", "ping", "nip04_encrypt", "nip04_decrypt", "nip44_encrypt", "nip44_decrypt"]) {
  const inner = backend.handlers[method];
  backend.handlers[method] = {
    async handle(b, id, remotePubkey, params) {
      console.log(`[bunker] ${method} from ${remotePubkey.slice(0, 12)}…`);
      return inner.handle(b, id, remotePubkey, params);
    },
  };
}

await backend.start();

const uri = `bunker://${user.pubkey}?relay=${encodeURIComponent(relay)}&secret=${encodeURIComponent(secret)}`;
console.log(`[bunker] listening on ${relay}`);
console.log(`[bunker] user npub: ${user.npub}`);
console.log(`[bunker] sec (for restart): ${bytesToHex(sec)}`);
console.log(`BUNKER_URI=${uri}`);
