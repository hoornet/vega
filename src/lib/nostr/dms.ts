import { NDKEvent, NDKKind, NDKSubscriptionCacheUsage, giftWrap, giftUnwrap } from "@nostr-dev-kit/ndk";
import { getNDK } from "./core";

async function unwrapGiftWraps(events: NDKEvent[]): Promise<NDKEvent[]> {
  const instance = getNDK();
  if (!instance.signer) return [];
  const rumors: NDKEvent[] = [];
  for (const wrap of events) {
    try {
      const rumor = await giftUnwrap(wrap, undefined, instance.signer);
      if (rumor && rumor.kind === NDKKind.PrivateDirectMessage) {
        // Preserve wrapper ID for dedup, but use rumor's created_at for ordering
        rumors.push(rumor);
      }
    } catch {
      // Not for us or corrupted — skip silently
    }
  }
  return rumors;
}

export async function fetchDMConversations(myPubkey: string): Promise<NDKEvent[]> {
  const instance = getNDK();
  // Fetch NIP-04 (legacy) and NIP-17 (gift-wrap) in parallel
  const [nip04Received, nip04Sent, giftWraps] = await Promise.all([
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], "#p": [myPubkey], limit: 500 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], authors: [myPubkey], limit: 500 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    instance.fetchEvents(
      { kinds: [NDKKind.GiftWrap], "#p": [myPubkey], limit: 500 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
  ]);

  const nip17Rumors = await unwrapGiftWraps(Array.from(giftWraps));

  const seen = new Set<string>();
  return [...Array.from(nip04Received), ...Array.from(nip04Sent), ...nip17Rumors]
    .filter((e) => { if (seen.has(e.id!)) return false; seen.add(e.id!); return true; })
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchDMThread(myPubkey: string, theirPubkey: string): Promise<NDKEvent[]> {
  const instance = getNDK();
  // Fetch NIP-04 and NIP-17 in parallel
  const [fromThem, fromMe, giftWraps] = await Promise.all([
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], "#p": [myPubkey], authors: [theirPubkey], limit: 200 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], "#p": [theirPubkey], authors: [myPubkey], limit: 200 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    instance.fetchEvents(
      { kinds: [NDKKind.GiftWrap], "#p": [myPubkey], limit: 200 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
  ]);

  // Unwrap NIP-17 and filter to only messages from/to this partner
  const allRumors = await unwrapGiftWraps(Array.from(giftWraps));
  const partnerRumors = allRumors.filter((r) => {
    const pTag = r.tags.find((t) => t[0] === "p")?.[1];
    return r.pubkey === theirPubkey || pTag === theirPubkey;
  });

  return [...Array.from(fromThem), ...Array.from(fromMe), ...partnerRumors]
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

export async function sendDM(recipientPubkey: string, content: string): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const myUser = await instance.signer.user();
  const recipient = instance.getUser({ pubkey: recipientPubkey });

  // Create unsigned rumor (kind 14)
  const rumor = new NDKEvent(instance);
  rumor.kind = NDKKind.PrivateDirectMessage;
  rumor.content = content;
  rumor.tags = [["p", recipientPubkey]];
  rumor.pubkey = myUser.pubkey;
  rumor.created_at = Math.floor(Date.now() / 1000);

  // Gift-wrap to recipient and self (so sent messages appear in our inbox)
  const [wrappedForRecipient, wrappedForSelf] = await Promise.all([
    giftWrap(rumor, recipient, instance.signer),
    giftWrap(rumor, myUser, instance.signer),
  ]);

  await Promise.all([
    wrappedForRecipient.publish(),
    wrappedForSelf.publish(),
  ]);
}

export async function decryptDM(event: NDKEvent, myPubkey: string): Promise<string> {
  // Kind 14 (NIP-17 rumor) — content is already plaintext after unwrapping
  if (event.kind === NDKKind.PrivateDirectMessage) {
    return event.content;
  }

  // Kind 4 (NIP-04 legacy) — decrypt as before
  const instance = getNDK();
  if (!instance.signer) throw new Error("No signer");
  const otherPubkey =
    event.pubkey === myPubkey
      ? (event.tags.find((t) => t[0] === "p")?.[1] ?? "")
      : event.pubkey;
  const otherUser = instance.getUser({ pubkey: otherPubkey });
  return instance.signer.decrypt(otherUser, event.content, "nip04");
}
