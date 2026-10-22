import NDK, { NDKEvent, NDKFilter, NDKKind, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { guardIncomingEvents } from "../nostr/authentic";
import { withinTime } from "../timeLimit";
import { clipText } from "../utils";

interface NwcConnection {
  walletPubkey: string;
  relayUrl: string;
  secret: string;
}

export function parseNwcUri(uri: string): NwcConnection {
  const cleaned = uri.replace("nostr+walletconnect://", "https://");
  const url = new URL(cleaned);
  const walletPubkey = url.hostname;
  const relayUrl = url.searchParams.get("relay");
  const secret = url.searchParams.get("secret");

  if (!walletPubkey || !relayUrl || !secret) {
    throw new Error("Invalid NWC URI: missing pubkey, relay, or secret");
  }

  return { walletPubkey, relayUrl, secret };
}

export function isValidNwcUri(uri: string): boolean {
  try {
    parseNwcUri(uri);
    return uri.startsWith("nostr+walletconnect://");
  } catch {
    return false;
  }
}

/** How long a payment waits for the wallet's relay, and then for the wallet. Tests shorten them. */
export interface NwcLimits {
  connectMs?: number;
  answerMs?: number;
}

const CONNECT_MS = 8000;
const ANSWER_MS = 30000;
/** How long the relay gets to confirm it holds the REQ before the request goes out anyway. */
const LISTEN_MS = 2000;

/**
 * The wallet did not answer within the wait. The request went out, so the
 * payment may well have been made: callers count it as sent, not failed.
 */
export class NwcTimeoutError extends Error {
  constructor(what: string, ms = ANSWER_MS) {
    super(`${what} timed out (${Math.round(ms / 1000)}s)`);
    this.name = "NwcTimeoutError";
  }
}

/**
 * Lets go of a wallet instance: every relay's socket, its keepalive, state
 * monitor and sleep detector, and a reconnect still scheduled. Through
 * connectivity, not relay.disconnect(): that one returns at once for a relay
 * that never connected and leaves its monitors running for the session, with
 * the secret still in the instance. And `disconnect()` alone keeps a reconnect
 * that was scheduled when the relay dropped, which then opens the socket again.
 */
function letGo(ndk: NDK | null): void {
  for (const relay of ndk?.pool?.relays?.values() ?? []) {
    relay.connectivity.resetReconnectionState();
    relay.connectivity.disconnect();
  }
}

/**
 * NDK's own words for a publish that got no answer, as opposed to a relay's
 * reason: no OK in time (`NDKRelayPublisher.publish`), a relay gone while it
 * was out (`clearPendingPublishes`), and its rejection of every event still
 * waiting for an OK when the connection goes or AUTH fails
 * (`rejectPendingAuthPublishes`, "Authentication failed: Relay … disconnected"
 * on a drop). None of them says what the relay did with the request. NDK is
 * pinned exactly; `payWallet.test.ts` reads its source for all three.
 */
export function isNdkOwnFailure(reason: string): boolean {
  return /^Timeout: \d+ms$/.test(reason) || /^Relay \S+ disconnected$/.test(reason) || reason.startsWith("Authentication failed: ");
}

function relayName(relayUrl: string): string {
  try {
    return new URL(relayUrl).host || relayUrl;
  } catch {
    return relayUrl;
  }
}

/**
 * Publishes a wallet request, and calls `failed` only when nothing can have
 * reached the wallet: the relay said no (`OK false`), or no relay was connected
 * at any moment the request could have been written (NDK sends to a relay that
 * is connected and writes nothing to one that is not, waiting for it to
 * connect instead). NDK's publish of an ephemeral event resolves with the
 * relays that took it and never rejects once it has sent, so the set is read,
 * and the relay's reason comes from the failure event. A missing OK is not a
 * "no": the relay may have passed the request on and confirm late, so the
 * caller's own wait decides.
 */
function sendRequest(ndk: NDK, requestEvent: NDKEvent, relayUrl: string, failed: (err: Error) => void): void {
  const relays = Array.from(ndk.pool.relays.values());
  let written = relays.some((r) => r.connected);
  for (const relay of relays) relay.once("connect", () => { written = true; });
  let refusal = "";
  requestEvent.on("relay:publish:failed", (_relay: unknown, err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err);
    if (!isNdkOwnFailure(reason)) refusal = reason;
  });
  requestEvent.publish().then(
    (took) => {
      if (took.size > 0) return;
      if (refusal) failed(new Error(`Your wallet's relay (${relayName(relayUrl)}) refused the request: ${clipText(refusal, 90)}`));
      else if (!written) failed(new Error(`Your wallet's relay (${relayName(relayUrl)}) could not be reached`));
    },
    // Thrown before anything was sent.
    (err: unknown) => failed(err instanceof Error ? err : new Error(String(err))),
  );
}

/**
 * One payment request (NIP-47) on an instance of its own, let go of when the
 * wallet answers, refuses, or the wait runs out. Resolves with the preimage.
 *
 * - **The wait for the relay has a limit.** NDK's `connect()` without one
 *   resolves only once the relay has connected, so a wallet relay that was down
 *   held the payment for good: the zap dialog said "timed out" after its own
 *   45 s, and podcast streaming, which pays one round at a time, stopped paying
 *   for the rest of the episode without a word. A relay still not up after the
 *   limit is a failure: nothing went out.
 * - **The relay holds the REQ before the request goes out**, as in the probe: a
 *   wallet can answer within milliseconds (a refusal always does), the reply is
 *   ephemeral, and NDK sends REQs on a short delay to batch them. A reply that
 *   reached the relay before the REQ was gone, and the payment ran out its wait
 *   as a timeout, which streaming counts as sent.
 * - **It fails before the wallet's answer only when nothing reached the
 *   wallet**: the relay said no (`OK false`), or no relay was connected at any
 *   moment the request could have been written. NDK never rejects the publish
 *   of an ephemeral event, and a NIP-47 request is one (kind 23194): it
 *   resolves with the relays that took it, an empty set when none did, so the
 *   set and the relay's reason are read. The code waited on a rejection that
 *   could not come, and a relay that refused the request left the payment to
 *   run out its wait as a timeout, which streaming counts as sent. A missing
 *   OK is not a "no": NDK writes the request to a connected relay at once, and
 *   a busy relay may pass it on and confirm late, so the wallet's answer or the
 *   wait decides. A payment failed there could be made again and paid twice.
 * - **The subscription is not stopped on its own.** The instance is let go of,
 *   which ends it with its sockets; a bare `sub.stop()` before EOSE is the orphan
 *   hazard (CLAUDE.md, "Orphan relay subscriptions"), and nothing reconnects a
 *   relay that was let go of to discharge one.
 */
async function payViaNWC(
  nwcUri: string,
  method: "pay_invoice" | "pay_keysend",
  params: Record<string, unknown>,
  what: string,
  limits: NwcLimits = {},
): Promise<string> {
  const { walletPubkey, relayUrl, secret } = parseNwcUri(nwcUri);
  const connectMs = limits.connectMs ?? CONNECT_MS;
  const answerMs = limits.answerMs ?? ANSWER_MS;

  const ndk = guardIncomingEvents(new NDK({
    explicitRelayUrls: [relayUrl],
    enableOutboxModel: false,
    // A wallet relay that requires NIP-42 would otherwise never connect,
    // the same way the main pool could not before #48. Unconditional true
    // is right *here* and nowhere else: this instance signs as the wallet
    // connection secret, not the user's identity key, so the privacy
    // reasoning behind the "My relays only" scope does not apply — the key
    // is already scoped to this one wallet. See #54.
    relayAuthDefaultPolicy: async () => true,
  }));
  const signer = new NDKPrivateKeySigner(secret);
  ndk.signer = signer;

  try {
    await ndk.connect(connectMs);
    if (!Array.from(ndk.pool.relays.values()).some((r) => r.connected)) {
      throw new Error(`Your wallet's relay (${relayName(relayUrl)}) could not be reached`);
    }

    const walletUser = ndk.getUser({ pubkey: walletPubkey });
    const requestEvent = new NDKEvent(ndk);
    requestEvent.kind = NDKKind.NostrWalletConnectReq;
    requestEvent.content = await signer.encrypt(walletUser, JSON.stringify({ method, params }), "nip04");
    requestEvent.tags = [["p", walletPubkey]];
    await requestEvent.sign();

    const filter: NDKFilter = {
      kinds: [NDKKind.NostrWalletConnectRes],
      authors: [walletPubkey],
      "#e": [requestEvent.id!],
    };
    const sub = ndk.subscribe(filter, { closeOnEose: false, groupable: false });
    await new Promise<void>((resolve) => {
      const clock = setTimeout(resolve, LISTEN_MS);
      sub.on("eose", () => { clearTimeout(clock); resolve(); });
    });

    return await new Promise<string>((resolve, reject) => {
      const clock = setTimeout(() => reject(new NwcTimeoutError(what, answerMs)), answerMs);
      sub.on("event", async (event: NDKEvent) => {
        clearTimeout(clock);
        try {
          const response = JSON.parse(await signer.decrypt(walletUser, event.content, "nip04"));
          if (response.error) reject(new Error(response.error.message || `${what} failed`));
          else resolve(response.result?.preimage ?? "");
        } catch (err) {
          reject(err);
        }
      });
      sendRequest(ndk, requestEvent, relayUrl, (err) => { clearTimeout(clock); reject(err); });
    });
  } finally {
    letGo(ndk);
  }
}

export function payKeysendViaNWC(
  nwcUri: string,
  pubkey: string,
  amountMsats: number,
  tlvRecords?: { type: number; value: string }[],
  limits?: NwcLimits,
): Promise<string> {
  const params: Record<string, unknown> = { pubkey, amount: amountMsats };
  if (tlvRecords && tlvRecords.length > 0) {
    params.tlv_records = tlvRecords.map((r) => ({ type: r.type, value: r.value }));
  }
  return payViaNWC(nwcUri, "pay_keysend", params, "NWC keysend", limits);
}

export function payInvoiceViaNWC(nwcUri: string, bolt11: string, limits?: NwcLimits): Promise<string> {
  return payViaNWC(nwcUri, "pay_invoice", { invoice: bolt11 }, "NWC payment", limits);
}

/** What a wallet's reply to the probe says: it is there and this code is known to it, it refused the code, or nothing came back. */
export type ProbeResult = "ok" | "refused" | "unreachable";

/** NIP-47 error codes that mean the wallet does not know, or cannot speak to, this connection. Any other error means the wallet is there. */
const REFUSALS = new Set(["UNAUTHORIZED", "UNSUPPORTED_ENCRYPTION"]);

/**
 * Asks the wallet one cheap question (`get_info`) to learn whether the
 * connection code reaches a wallet that knows it. Nothing is paid. The reply
 * is decrypted and read: "ok" when the wallet answered with a result or with
 * an error that is not about the code (RESTRICTED, NOT_IMPLEMENTED and the
 * like: a wallet that allows only pay_invoice is still there); "refused" when
 * it answered UNAUTHORIZED or UNSUPPORTED_ENCRYPTION, or with something this
 * secret cannot decrypt, which is the revoked-or-mistyped case; "unreachable"
 * when nothing came back in time.
 */
export async function probeWallet(nwcUri: string, timeoutMs = 10000): Promise<ProbeResult> {
  const { walletPubkey, relayUrl, secret } = parseNwcUri(nwcUri);
  const signer = new NDKPrivateKeySigner(secret);
  let ndk: NDK | null = null;
  // Every wait in here has a limit, and the whole has one too: `ndk.connect()` resolves only once the
  // relay has connected, and a relay that is down leaves it pending for good.
  const ask = async (): Promise<ProbeResult> => {
    ndk = guardIncomingEvents(new NDK({ explicitRelayUrls: [relayUrl], enableOutboxModel: false, relayAuthDefaultPolicy: async () => true }));
    ndk.signer = signer;
    await withinTime(ndk.connect(), Math.min(timeoutMs, 8000), "connect").catch(() => {});
    const walletUser = ndk.getUser({ pubkey: walletPubkey });
    const requestEvent = new NDKEvent(ndk);
    requestEvent.kind = NDKKind.NostrWalletConnectReq;
    requestEvent.content = await signer.encrypt(walletUser, JSON.stringify({ method: "get_info", params: {} }), "nip04");
    requestEvent.tags = [["p", walletPubkey]];
    await requestEvent.sign();
    const instance = ndk;
    const filter: NDKFilter = { kinds: [NDKKind.NostrWalletConnectRes], authors: [walletPubkey], "#e": [requestEvent.id!] };
    // The relay must hold the REQ before the request goes out: a wallet answers within milliseconds,
    // the reply is ephemeral (a relay keeps none of it), and NDK sends REQs on a short delay to batch
    // them. Not groupable, and EOSE is the relay saying it has the REQ. The live test found this: the
    // reply reached the relay before the question about it, and was gone.
    const sub = instance.subscribe(filter, { closeOnEose: false, groupable: false });
    await new Promise<void>((resolve) => { sub.on("eose", () => resolve()); setTimeout(resolve, 2000); });
    return new Promise<ProbeResult>((resolve) => {
      // A bare sub.stop() is allowed here only because the whole instance is disconnected right after.
      const timer = setTimeout(() => { sub.stop(); resolve("unreachable"); }, timeoutMs);
      sub.on("event", async (event: NDKEvent) => {
        clearTimeout(timer);
        sub.stop();
        try {
          const reply = JSON.parse(await signer.decrypt(walletUser, event.content, "nip04")) as { error?: { code?: string } };
          resolve(reply.error && REFUSALS.has(String(reply.error.code)) ? "refused" : "ok");
        } catch {
          resolve("refused");
        }
      });
      sendRequest(instance, requestEvent, relayUrl, () => { clearTimeout(timer); sub.stop(); resolve("unreachable"); });
    });
  };
  try {
    return await withinTime(ask(), timeoutMs + 9000, "probe");
  } catch {
    return "unreachable";
  } finally {
    letGo(ndk);
  }
}
