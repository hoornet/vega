import { NDKEvent, NDKKind, NDKRelay, giftWrap, giftUnwrap } from "@nostr-dev-kit/ndk";
import {
  getNDK,
  fetchWithTimeout,
  getStoredRelayUrls,
  isLocalRelayUrl,
  stopSubscription,
  FEED_TIMEOUT,
} from "./core";
import { getRelayAuthScope, shouldAuthenticate } from "./relayAuth";
import { useToastStore } from "../../stores/toast";
import { debug } from "../debug";

/**
 * Extra grace once a relay has told us it wants AUTH first.
 *
 * Sized for a NIP-46 bunker, where signing the kind 22242 is a full round-trip
 * to a remote signer rather than a local key operation.
 */
const RELAY_AUTH_GRACE = 12000;

/** Relays we have already explained ourselves about, so the toast fires once per session. */
const _authNoticeShown = new Set<string>();

/**
 * Fetch gift wraps via subscribe (fetchEvents doesn't reliably return kind 1059).
 *
 * Kind 1059 is exactly the kind a relay is most likely to gate behind NIP-42 —
 * gift wraps are addressed to you, so `restrictReadToInvolvedPubkey` needs to
 * know who is asking. Before issue #48 this function could not tell the
 * difference between "your inbox is empty" and "the relay refused to answer
 * until you identified yourself": it resolved on a bare timer with no `closed`
 * handler, and both cases produced `[]` after 8 seconds.
 */
export async function fetchGiftWraps(myPubkey: string, limit: number, timeoutMs: number): Promise<NDKEvent[]> {
  const instance = getNDK();
  const events: NDKEvent[] = [];
  const sub = instance.subscribe(
    { kinds: [1059 as NDKKind], "#p": [myPubkey], limit },
    { closeOnEose: true, groupable: false },
  );
  sub.on("event", (e: NDKEvent) => events.push(e));

  await new Promise<void>((resolve) => {
    let settled = false;
    let extended = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    sub.on("eose", finish);

    // NDK never inspects CLOSED reasons on the subscription path, so this is
    // the only place the refusal becomes visible to us.
    sub.on("closed", (relay: NDKRelay, reason: string) => {
      if (settled || !/^auth-required/i.test(reason ?? "")) return;

      const scope = getRelayAuthScope();
      const willAuth = shouldAuthenticate(
        relay.url, scope, new Set(getStoredRelayUrls()), isLocalRelayUrl(relay.url),
      );

      if (!willAuth) {
        // A decline that costs the user something — an empty Messages view they
        // would otherwise have no explanation for. Host in the message so the
        // toast store's dedup distinguishes relays.
        if (!_authNoticeShown.has(relay.url)) {
          _authNoticeShown.add(relay.url);
          const host = hostOf(relay.url);
          useToastStore.getState().addToast(
            `${host} wants to know who you are before showing your messages. Add it to your relays, or allow any relay in Settings → Relay authentication.`,
            "warning",
            8000,
          );
        }
        return;
      }

      // We will authenticate, so give the handshake room to finish. NDK
      // re-issues the REQ itself once the relay reaches AUTHENTICATED —
      // `execute()` re-registers `once("authed")` whenever status < 8 — so we
      // only need to still be listening when the events arrive.
      if (extended) return;
      extended = true;
      debug.log(`[Vega] ${relay.url} requires AUTH — waiting for the handshake`);
      clearTimeout(timer);
      timer = setTimeout(finish, RELAY_AUTH_GRACE);
    });

    timer = setTimeout(finish, timeoutMs);
  });

  // Never a bare sub.stop(): this subscription is RUNNING and, on an
  // auth-required relay, has never EOSEd — precisely the case where NDK skips
  // both the CLOSE frame and its listener cleanup.
  stopSubscription(sub, instance);
  return events;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

async function unwrapGiftWraps(events: NDKEvent[]): Promise<NDKEvent[]> {
  const instance = getNDK();
  if (!instance.signer) return [];
  const rumors: NDKEvent[] = [];
  for (const wrap of events) {
    try {
      const rumor = await giftUnwrap(wrap, undefined, instance.signer);
      if (rumor && rumor.kind === NDKKind.PrivateDirectMessage) {
        rumors.push(rumor);
      }
    } catch (err) {
      debug.warn(`[DM] unwrap failed for event ${wrap.id?.slice(0, 8)}:`, err);
    }
  }
  return rumors;
}

/**
 * Recent inbound DMs for notification polling, newest last.
 *
 * `sinceRumorTs` is compared against the **rumor's** timestamp, never the gift
 * wrap's: NIP-59 randomizes a wrap's `created_at`, backdating it by up to two
 * days to frustrate timing analysis. A `since` filter on kind 1059 therefore
 * drops real messages, so the wraps are fetched by limit and judged after
 * unwrapping. Legacy kind 4 carries a truthful timestamp and can use `since`.
 *
 * Returns [] for read-only accounts — without a signer there is nothing to
 * decrypt with.
 */
export async function fetchNewDMs(
  myPubkey: string,
  sinceRumorTs: number,
  limit = 20,
): Promise<NDKEvent[]> {
  const instance = getNDK();
  if (!instance.signer) return [];

  const [nip04, giftWrapEvents] = await Promise.all([
    fetchWithTimeout(
      instance,
      { kinds: [NDKKind.EncryptedDirectMessage], "#p": [myPubkey], since: sinceRumorTs, limit },
      FEED_TIMEOUT,
    ),
    fetchGiftWraps(myPubkey, limit, FEED_TIMEOUT),
  ]);

  const rumors = await unwrapGiftWraps(giftWrapEvents);
  return [...Array.from(nip04), ...rumors]
    .filter((e) => e.pubkey !== myPubkey && (e.created_at ?? 0) > sinceRumorTs)
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

export async function fetchDMConversations(myPubkey: string): Promise<NDKEvent[]> {
  const instance = getNDK();
  // Fetch NIP-04 (legacy) and NIP-17 (gift-wrap) in parallel with timeouts
  const [nip04Received, nip04Sent, giftWrapEvents] = await Promise.all([
    fetchWithTimeout(instance, { kinds: [NDKKind.EncryptedDirectMessage], "#p": [myPubkey], limit: 500 }, FEED_TIMEOUT),
    fetchWithTimeout(instance, { kinds: [NDKKind.EncryptedDirectMessage], authors: [myPubkey], limit: 500 }, FEED_TIMEOUT),
    fetchGiftWraps(myPubkey, 500, FEED_TIMEOUT),
  ]);

  debug.log(`[DM] fetchConversations: nip04Received=${nip04Received.size} nip04Sent=${nip04Sent.size} giftWraps=${giftWrapEvents.length}`);
  const nip17Rumors = await unwrapGiftWraps(giftWrapEvents);
  debug.log(`[DM] unwrapped ${nip17Rumors.length} NIP-17 rumors from ${giftWrapEvents.length} gift wraps`);

  const seen = new Set<string>();
  return [...Array.from(nip04Received), ...Array.from(nip04Sent), ...nip17Rumors]
    .filter((e) => { if (seen.has(e.id!)) return false; seen.add(e.id!); return true; })
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchDMThread(myPubkey: string, theirPubkey: string): Promise<NDKEvent[]> {
  const instance = getNDK();
  // Fetch NIP-04 and NIP-17 in parallel with timeouts
  const [fromThem, fromMe, giftWrapEvents] = await Promise.all([
    fetchWithTimeout(instance, { kinds: [NDKKind.EncryptedDirectMessage], "#p": [myPubkey], authors: [theirPubkey], limit: 200 }, FEED_TIMEOUT),
    fetchWithTimeout(instance, { kinds: [NDKKind.EncryptedDirectMessage], "#p": [theirPubkey], authors: [myPubkey], limit: 200 }, FEED_TIMEOUT),
    fetchGiftWraps(myPubkey, 200, FEED_TIMEOUT),
  ]);

  debug.log(`[DM] fetchThread: nip04FromThem=${fromThem.size} nip04FromMe=${fromMe.size} giftWraps=${giftWrapEvents.length}`);

  // Unwrap NIP-17 and filter to only messages from/to this partner
  const allRumors = await unwrapGiftWraps(giftWrapEvents);
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

  const [recipientResult, selfResult] = await Promise.all([
    wrappedForRecipient.publish(),
    wrappedForSelf.publish(),
  ]);
  debug.log(`[DM] sendDM published: toRecipient=${recipientResult?.size ?? 0} relays, toSelf=${selfResult?.size ?? 0} relays`);
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
