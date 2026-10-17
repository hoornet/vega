import NDK, { NDKEvent, NDKFilter, NDKKind, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { guardIncomingEvents } from "../nostr/authentic";
import { withinTime } from "../timeLimit";

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

/**
 * The wallet did not answer within the wait. The request went out, so the
 * payment may well have been made: callers count it as sent, not failed.
 */
export class NwcTimeoutError extends Error {
  constructor(what: string) {
    super(`${what} timed out (30s)`);
    this.name = "NwcTimeoutError";
  }
}

export async function payKeysendViaNWC(
  nwcUri: string,
  pubkey: string,
  amountMsats: number,
  tlvRecords?: { type: number; value: string }[],
): Promise<string> {
  const { walletPubkey, relayUrl, secret } = parseNwcUri(nwcUri);

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
  await ndk.connect();

  await new Promise<void>((resolve) => {
    const check = () => {
      const relays = Array.from(ndk.pool?.relays?.values() ?? []);
      if (relays.some((r) => r.connected)) resolve();
      else setTimeout(check, 200);
    };
    setTimeout(() => resolve(), 8000);
    check();
  });

  const walletUser = ndk.getUser({ pubkey: walletPubkey });

  const params: Record<string, unknown> = {
    pubkey,
    amount: amountMsats,
  };
  if (tlvRecords && tlvRecords.length > 0) {
    params.tlv_records = tlvRecords.map((r) => ({
      type: r.type,
      value: r.value,
    }));
  }

  const requestContent = JSON.stringify({ method: "pay_keysend", params });
  const encrypted = await signer.encrypt(walletUser, requestContent, "nip04");

  const requestEvent = new NDKEvent(ndk);
  requestEvent.kind = NDKKind.NostrWalletConnectReq;
  requestEvent.content = encrypted;
  requestEvent.tags = [["p", walletPubkey]];
  await requestEvent.sign();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sub.stop();
      reject(new NwcTimeoutError("NWC keysend"));
    }, 30000);

    const filter: NDKFilter = {
      kinds: [NDKKind.NostrWalletConnectRes],
      authors: [walletPubkey],
      "#e": [requestEvent.id!],
    };

    const sub = ndk.subscribe(filter, { closeOnEose: false });

    sub.on("event", async (event: NDKEvent) => {
      clearTimeout(timeout);
      sub.stop();
      try {
        const decrypted = await signer.decrypt(walletUser, event.content, "nip04");
        const response = JSON.parse(decrypted);
        if (response.error) {
          reject(new Error(response.error.message || "NWC keysend failed"));
        } else {
          resolve(response.result?.preimage ?? "");
        }
      } catch (err) {
        reject(err);
      }
    });

    // A request no relay took is a failure, not a wallet that did not answer.
    requestEvent.publish().catch((err: unknown) => {
      clearTimeout(timeout);
      sub.stop();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export async function payInvoiceViaNWC(nwcUri: string, bolt11: string): Promise<string> {
  const { walletPubkey, relayUrl, secret } = parseNwcUri(nwcUri);

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
  await ndk.connect();

  // Wait briefly for relay connection
  await new Promise<void>((resolve) => {
    const check = () => {
      const relays = Array.from(ndk.pool?.relays?.values() ?? []);
      if (relays.some((r) => r.connected)) resolve();
      else setTimeout(check, 200);
    };
    setTimeout(() => resolve(), 8000); // timeout fallback
    check();
  });

  const walletUser = ndk.getUser({ pubkey: walletPubkey });
  const requestContent = JSON.stringify({
    method: "pay_invoice",
    params: { invoice: bolt11 },
  });

  const encrypted = await signer.encrypt(walletUser, requestContent, "nip04");

  const requestEvent = new NDKEvent(ndk);
  requestEvent.kind = NDKKind.NostrWalletConnectReq;
  requestEvent.content = encrypted;
  requestEvent.tags = [["p", walletPubkey]];
  await requestEvent.sign();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sub.stop();
      reject(new NwcTimeoutError("NWC payment"));
    }, 30000);

    const filter: NDKFilter = {
      kinds: [NDKKind.NostrWalletConnectRes],
      authors: [walletPubkey],
      "#e": [requestEvent.id!],
    };

    const sub = ndk.subscribe(filter, { closeOnEose: false });

    sub.on("event", async (event: NDKEvent) => {
      clearTimeout(timeout);
      sub.stop();
      try {
        const decrypted = await signer.decrypt(walletUser, event.content, "nip04");
        const response = JSON.parse(decrypted);
        if (response.error) {
          reject(new Error(response.error.message || "NWC payment failed"));
        } else {
          resolve(response.result?.preimage ?? "");
        }
      } catch (err) {
        reject(err);
      }
    });

    // A request no relay took is a failure, not a wallet that did not answer.
    requestEvent.publish().catch((err: unknown) => {
      clearTimeout(timeout);
      sub.stop();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
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
      requestEvent.publish().catch(() => { clearTimeout(timer); sub.stop(); resolve("unreachable"); });
    });
  };
  try {
    return await withinTime(ask(), timeoutMs + 9000, "probe");
  } catch {
    return "unreachable";
  } finally {
    // Through connectivity, not relay.disconnect(): that one returns at once for a relay that never
    // connected and leaves its state monitor, sleep detector and any reconnect timer running for the
    // session, with the secret still in the instance.
    for (const relay of (ndk as NDK | null)?.pool?.relays?.values() ?? []) relay.connectivity.disconnect();
  }
}
