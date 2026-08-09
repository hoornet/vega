import type { NDKNip46Signer, NDKRpcResponse } from "@nostr-dev-kit/ndk";
import { debug } from "../debug";

// Scratch slot for the NIP-46 *client* key of an in-flight bunker login. This is
// not the user's nsec — it only identifies Vega to the bunker. Retrying a failed
// login must reuse it: bunkers bind the one-shot bunker:// secret to the first
// client pubkey that presents it and answer every later one with "Unknown client".
// Keyed by URI so a freshly issued bunker:// URI still gets a fresh identity —
// reusing a client key whose connection was revoked is rejected just as hard.
export const NIP46_PENDING_CLIENT_KEY = "wrystr_nip46_pending_client_key";

const HEX_PRIVATE_KEY = /^[0-9a-f]{64}$/i;

export function pendingClientKeyFor(bunkerUri: string): string | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(NIP46_PENDING_CLIENT_KEY) ?? "null");
    if (saved?.uri !== bunkerUri) return undefined;
    // A malformed key would throw inside NDKPrivateKeySigner and wedge every
    // future attempt at this URI — fall back to a fresh identity instead.
    return HEX_PRIVATE_KEY.test(saved.privateKey) ? saved.privateKey : undefined;
  } catch {
    return undefined;
  }
}

export function rememberPendingClientKey(bunkerUri: string, privateKey: string): void {
  localStorage.setItem(NIP46_PENDING_CLIENT_KEY, JSON.stringify({ uri: bunkerUri, privateKey }));
}

export function forgetPendingClientKey(): void {
  localStorage.removeItem(NIP46_PENDING_CLIENT_KEY);
}

/**
 * NIP-46 lets a bunker answer `connect` with either `"ack"` **or the secret**
 * from the bunker:// URI. NDK only accepts `"ack"` and rejects anything else —
 * and it rejects with `response.error`, which is undefined on a *successful*
 * secret echo, so the failure surfaces as "login failed: undefined" even though
 * the bunker connected us. Normalize the echo to "ack" before NDK sees it.
 *
 * Hooks `rpc.parseEvent`, which decrypts every inbound NIP-46 message and runs
 * before the response is dispatched to the waiting request handler.
 * See https://github.com/hoornet/vega/issues/17.
 */
export function acceptSecretEchoAsAck(signer: NDKNip46Signer): void {
  const secret = signer.secret;
  const rpc = signer.rpc;
  if (!secret || typeof rpc?.parseEvent !== "function") return;

  const parseEvent = rpc.parseEvent.bind(rpc);
  rpc.parseEvent = async (event) => {
    const parsed = await parseEvent(event);
    // Requests carry `method`; anything else is a response to something we sent.
    if (!("method" in parsed)) {
      const response = parsed as NDKRpcResponse;
      if (response.result === secret) {
        debug.log("[nip46] bunker acked connect by echoing the secret");
        response.result = "ack";
      }
    }
    return parsed;
  };
}
