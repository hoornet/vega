import { NDKEvent, NDKKind, NDKRelay, giftWrap, giftUnwrap } from "@nostr-dev-kit/ndk";
import {
  getNDK,
  fetchWithTimeout,
  getStoredRelayUrls,
  isLocalRelayUrl,
  stopSubscription,
  FEED_TIMEOUT,
} from "./core";
import { getRelayAuthScope, isRelayAuthenticated, shouldAuthenticate } from "./relayAuth";
import { useToastStore } from "../../stores/toast";
import { debug } from "../debug";

/**
 * Absolute cap on waiting for an AUTH handshake to complete.
 *
 * Only an upper bound, not the expected wait: we finish as soon as the relay
 * actually reports itself authenticated. Generous because the handshake can be
 * several round-trips to a remote signer, over whatever network the user's
 * signer sits behind.
 */
const AUTH_HANDSHAKE_MAX = 30000;

/**
 * Time allowed after the relay authenticates for NDK to re-issue the REQ and
 * the events to come back.
 */
const POST_AUTH_GRACE = 6000;

/**
 * Per-relay publish timeout for DMs, replacing NDK's 2500ms default.
 *
 * Sized so an AUTH handshake with a remote signer can complete first. See #53.
 */
const DM_PUBLISH_TIMEOUT = 15000;

/**
 * How many gift wraps to unwrap at once.
 *
 * Each one costs two decrypt calls, which on a remote signer are two RPC
 * round-trips. Overlapping them is the whole win; the cap exists so we don't
 * point a thousand concurrent requests at someone's bunker. See #61.
 */
const UNWRAP_CONCURRENCY = 8;

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
    let detachAuthWatch: (() => void) | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detachAuthWatch?.();
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

      // We will authenticate, so wait for the handshake rather than the clock.
      //
      // A flat timer was the first attempt and it is not good enough: the wait
      // is however long the user's signer takes, which for a remote signer
      // behind a VPN is unknowable from here. Watch the relay's own state
      // instead, and only fall back to a timer as an upper bound.
      //
      // The `authed` event alone is not the signal — NDK emits it once
      // prematurely, before the event has even been signed, and again for
      // real. `isRelayAuthenticated` checks status, so the early one is
      // ignored. Once it is genuinely authenticated NDK re-issues the REQ on
      // its own; we just have to still be listening when the events land.
      if (extended) return;
      extended = true;
      debug.log(`[Vega] ${relay.url} requires AUTH — waiting for the handshake`);

      const onAuthed = () => {
        if (settled || !isRelayAuthenticated(relay)) return;
        detachAuthWatch?.();
        debug.log(`[Vega] ${relay.url} authenticated — waiting for the re-issued request`);
        clearTimeout(timer);
        timer = setTimeout(finish, POST_AUTH_GRACE);
      };

      relay.on("authed", onAuthed);
      detachAuthWatch = () => {
        detachAuthWatch = undefined;
        try { relay.off("authed", onAuthed); } catch { /* emitter may be gone */ }
      };

      clearTimeout(timer);
      timer = setTimeout(finish, AUTH_HANDSHAKE_MAX);

      // The relay may already have authenticated between the CLOSED frame and
      // this handler running, in which case no further `authed` is coming.
      onAuthed();
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

/** One notice per session: a failing signer fails on every poll, not just once. */
let _unwrapFailureNotified = false;
let _unexpectedKindNotified = false;

export async function unwrapGiftWraps(events: NDKEvent[]): Promise<NDKEvent[]> {
  const instance = getNDK();
  if (!instance.signer) return [];
  const rumors: NDKEvent[] = [];
  let failures = 0;
  const unexpectedKinds = new Set<number>();

  // Unwrap in bounded batches rather than one at a time.
  //
  // `giftUnwrap` decrypts twice per wrap — once for the wrapper, once for the
  // seal — and with a remote signer each of those is an RPC round-trip. Done
  // sequentially at a measured ~130ms per trip, 500 wraps is over two minutes.
  // With a local key the same work is in-process and free, which is why this
  // never showed up in development and why the person who reported it was
  // running a bunker. See #61.
  //
  // Bounded rather than all at once: a thousand concurrent requests at
  // someone's signer is its own denial of service, and some will rate-limit.
  for (let i = 0; i < events.length; i += UNWRAP_CONCURRENCY) {
    const batch = events.slice(i, i + UNWRAP_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (wrap) => {
        const id = wrap.id?.slice(0, 8);
        try {
          return { id, rumor: await giftUnwrap(wrap, undefined, instance.signer) };
        } catch (err) {
          debug.warn(`[DM] unwrap failed for event ${id}:`, err);
          return { id, failed: true as const };
        }
      }),
    );

    for (const result of settled) {
      if ("failed" in result) { failures++; continue; }
      const rumor = result.rumor;
      if (!rumor) continue;
      if (rumor.kind === NDKKind.PrivateDirectMessage) {
        rumors.push(rumor);
      } else {
        // Opened fine, but it isn't a NIP-17 chat message. Silently dropping
        // this was the last way a gift wrap could vanish without explanation:
        // the fetch worked, AUTH worked, decryption worked, and Messages still
        // showed nothing. Anything that wraps a different kind — a bot, a
        // client sending gift-wrapped kind 4 — landed here invisibly.
        unexpectedKinds.add(rumor.kind ?? -1);
        debug.warn(`[DM] gift wrap ${result.id} contained kind ${rumor.kind}, not ${NDKKind.PrivateDirectMessage}`);
      }
    }
  }

  // Name the kind. Whoever sent it can then fix it, and it tells us whether
  // Vega should learn to read it.
  if (rumors.length === 0 && unexpectedKinds.size > 0 && !_unexpectedKindNotified) {
    _unexpectedKindNotified = true;
    const kinds = [...unexpectedKinds].sort((a, b) => a - b).join(", ");
    useToastStore.getState().addToast(
      `Received private messages Vega can't read yet — they contain kind ${kinds}, and Vega reads NIP-17 chat messages (kind ${NDKKind.PrivateDirectMessage}).`,
      "warning",
      9000,
    );
  }

  // One wrap failing is ordinary — a malformed or foreign event. *Every* wrap
  // failing is a broken signer, and until now it was invisible: the warning
  // above is compiled out of production builds, so the user just saw an empty
  // Messages view.
  //
  // The usual cause is a remote signer without decrypt permission. NIP-17 gift
  // wraps are NIP-44, and Bunker46's default permission set deliberately grants
  // no nip04/nip44 decrypt at all ("so a fresh connection can never act as a
  // blanket decryption oracle"), so a default bunker connection cannot read DMs
  // until the user grants it.
  if (failures > 0 && rumors.length === 0 && !_unwrapFailureNotified) {
    _unwrapFailureNotified = true;
    useToastStore.getState().addToast(
      `Couldn't decrypt ${failures} message${failures === 1 ? "" : "s"}. If you sign in with a remote signer, it may need permission to decrypt (nip44).`,
      "warning",
      9000,
    );
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

  // NDK's per-relay publish timeout defaults to 2500ms, which is shorter than
  // an AUTH handshake on an auth-required relay: the publish is held until the
  // relay authenticates, and on a remote signer that is several round-trips.
  // NDK does eventually land the event — an `OK false` reading `auth-required`
  // is re-queued and resent by `retryPendingAuthPublishes` — but by then the
  // caller's promise has already rejected, so the UI reported a send failure
  // for a message that went out moments later. See #53.
  const [recipientResult, selfResult] = await Promise.all([
    wrappedForRecipient.publish(undefined, DM_PUBLISH_TIMEOUT),
    wrappedForSelf.publish(undefined, DM_PUBLISH_TIMEOUT),
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
