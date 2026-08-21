import NDK, { NDKEvent, NDKFilter, NDKKind, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";

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

export async function payKeysendViaNWC(
  nwcUri: string,
  pubkey: string,
  amountMsats: number,
  tlvRecords?: { type: number; value: string }[],
): Promise<string> {
  const { walletPubkey, relayUrl, secret } = parseNwcUri(nwcUri);

  const ndk = new NDK({
    explicitRelayUrls: [relayUrl],
    enableOutboxModel: false,
    // A wallet relay that requires NIP-42 would otherwise never connect,
    // the same way the main pool could not before #48. Unconditional true
    // is right *here* and nowhere else: this instance signs as the wallet
    // connection secret, not the user's identity key, so the privacy
    // reasoning behind the "My relays only" scope does not apply — the key
    // is already scoped to this one wallet. See #54.
    relayAuthDefaultPolicy: async () => true,
  });
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
      reject(new Error("NWC keysend timed out (30s)"));
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

    requestEvent.publish();
  });
}

export async function payInvoiceViaNWC(nwcUri: string, bolt11: string): Promise<string> {
  const { walletPubkey, relayUrl, secret } = parseNwcUri(nwcUri);

  const ndk = new NDK({
    explicitRelayUrls: [relayUrl],
    enableOutboxModel: false,
    // A wallet relay that requires NIP-42 would otherwise never connect,
    // the same way the main pool could not before #48. Unconditional true
    // is right *here* and nowhere else: this instance signs as the wallet
    // connection secret, not the user's identity key, so the privacy
    // reasoning behind the "My relays only" scope does not apply — the key
    // is already scoped to this one wallet. See #54.
    relayAuthDefaultPolicy: async () => true,
  });
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
      reject(new Error("NWC payment timed out (30s)"));
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

    requestEvent.publish();
  });
}
