import NDK, { NDKEvent, NDKKind, NDKRelay, NDKRelaySet, giftWrap, giftUnwrap } from "@nostr-dev-kit/ndk";
import {
  getNDK,
  fetchWithTimeout,
  getStoredRelayUrls,
  isLocalRelayUrl,
  isOutboxRelaysEnabled,
  stopSubscription,
  withTimeout,
  FEED_TIMEOUT,
  SINGLE_TIMEOUT,
} from "./core";
import { fetchUserDMRelayList } from "./relays";
import {
  getOwnDMRelayUrls,
  getRelayAuthScope,
  isRelayAuthenticated,
  setOwnDMRelayUrls,
  shouldAuthenticate,
} from "./relayAuth";
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

/**
 * Rumors we have already opened this run, keyed by gift-wrap id.
 *
 * Opening Messages re-fetches and re-decrypts everything from scratch, so the
 * second visit costs exactly as much as the first — and with a remote signer
 * that is two RPC round-trips per message. A wrap's contents cannot change, so
 * decrypting one twice is pure waste.
 *
 * **Memory only, never disk.** These are decrypted private messages; keeping
 * them in a process that ends when the app closes is a materially different
 * proposition from writing them into `vega.db` alongside the public note cache.
 * Persisting them may still be worth doing, but it is a decision with its own
 * consequences and it should be made deliberately rather than inherited from a
 * performance fix. See #61.
 */
const _rumorCache = new Map<string, NDKEvent>();

/** Bounds the cache so a long session with a busy inbox cannot grow unbounded. */
const RUMOR_CACHE_MAX = 2000;

/**
 * Forget every decrypted message.
 *
 * Must be called whenever the signed-in identity changes. The cache is keyed by
 * wrap id, which says nothing about *whose* messages they are — so without
 * this, switching accounts would serve the previous account's decrypted
 * messages to the new one. Same class of mistake as leaving a relay
 * authenticated as the previous identity.
 */
export function clearDecryptedDMCache(): void {
  _rumorCache.clear();
}

/** Relays we have already explained ourselves about, so the toast fires once per session. */
const _authNoticeShown = new Set<string>();

// ─── NIP-17 DM relay lists (kind 10050) ─────────────────────────────

/**
 * How long a fetched 10050 list is trusted before re-asking the relays.
 *
 * The notification poller calls into DMs every 60 seconds; without a cache that
 * is a relay round-trip per poll for a list that changes roughly never.
 */
const DM_RELAY_LIST_TTL = 10 * 60 * 1000;

/**
 * Published DM relay lists by pubkey. Public data, so it is identity-independent
 * and deliberately survives account switches — unlike the rumor cache above.
 * Empty results are cached too: "no 10050 published" is the common case, and
 * re-asking every poll would be the exact cost the cache exists to avoid.
 */
const _dmRelayLists = new Map<string, { urls: string[]; fetchedAt: number }>();

/** Test seam. */
export function clearDMRelayListCache(): void {
  _dmRelayLists.clear();
}

/**
 * A user's DM relays, from cache or the network. Returns [] when Relay reach is
 * off without touching the network: with reach off we will not connect beyond
 * the configured list anyway, so the answer could change nothing.
 */
async function resolveDMRelays(pubkey: string): Promise<string[]> {
  if (!isOutboxRelaysEnabled()) return [];
  const cached = _dmRelayLists.get(pubkey);
  if (cached && Date.now() - cached.fetchedAt < DM_RELAY_LIST_TTL) return cached.urls;
  const urls = await withTimeout(fetchUserDMRelayList(pubkey), SINGLE_TIMEOUT, []);
  _dmRelayLists.set(pubkey, { urls, fetchedAt: Date.now() });
  return urls;
}

/**
 * Same, for the signed-in user — additionally records the list in the AUTH
 * scope registry, so "My relays only" covers the user's own DM inbox relay.
 * A dedicated DM relay is exactly the relay that will demand NIP-42 before
 * serving kind 1059, and exactly the relay a privacy-minded user keeps out of
 * their configured list; without this the feature is dead on arrival for the
 * person it exists for. See issue #49.
 */
async function resolveOwnDMRelays(myPubkey: string): Promise<string[]> {
  const urls = await resolveDMRelays(myPubkey);
  // Unconditional, so a deleted 10050 narrows the scope again instead of the
  // old list lingering until the next account switch. A transient fetch
  // failure narrows it too, which errs in the private direction.
  setOwnDMRelayUrls(urls);
  return urls;
}

/**
 * The relay set for a DM operation: the given DM relays plus the configured
 * list, or undefined — meaning "use the pool, as before #49" — when reach is
 * off or no 10050 is published.
 *
 * Merged rather than DM-relays-only for the same reason `fetchUserNotesNIP65`
 * merges: every release so far delivered DMs via the pool, so pool relays are
 * where existing conversations live, and narrowing to a possibly-unreachable
 * 10050 list would turn a routing improvement into a delivery regression.
 *
 * `NDKRelaySet.fromRelayUrls` bypasses `relayConnectionFilter` — it constructs
 * relay objects directly rather than through the pool — which is why this MUST
 * stay behind the `isOutboxRelaysEnabled()` gate (already enforced in
 * `resolveDMRelays`, kept here as defence in depth). It does propagate
 * `relayAuthDefaultPolicy`, so the NIP-42 scope check still applies.
 */
function dmRelaySet(dmRelays: string[], instance: NDK): NDKRelaySet | undefined {
  if (!isOutboxRelaysEnabled() || dmRelays.length === 0) return undefined;
  const merged = Array.from(new Set([...dmRelays, ...getStoredRelayUrls()]));
  return NDKRelaySet.fromRelayUrls(merged, instance);
}

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
  // Ask the user's own published DM relays (kind 10050) as well as the pool.
  // Undefined relay set = the pool alone, the pre-#49 behaviour — which is
  // also what Relay reach off pins us to. The gate is checked here as well as
  // inside resolveDMRelays so the reach-off path never awaits: subscribing in
  // the same tick keeps event handlers attached before anything can fire.
  let relaySet: NDKRelaySet | undefined;
  if (isOutboxRelaysEnabled()) {
    const ownDMRelays = await resolveOwnDMRelays(myPubkey);
    relaySet = dmRelaySet(ownDMRelays, instance);
    if (relaySet) debug.log(`[DM] fetching gift wraps via DM relays: ${ownDMRelays.join(", ")}`);
  }
  const sub = instance.subscribe(
    { kinds: [1059 as NDKKind], "#p": [myPubkey], limit },
    { closeOnEose: true, groupable: false },
    relaySet,
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
      // Own published DM relays count as "my relays" — mirror the merged set
      // relayAuthPolicy uses, or this handler would toast about a relay the
      // policy is happily authenticating to.
      const willAuth = shouldAuthenticate(
        relay.url,
        scope,
        new Set([...getStoredRelayUrls(), ...getOwnDMRelayUrls()]),
        isLocalRelayUrl(relay.url),
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
  // Anything opened earlier this run is free; only the rest costs round-trips.
  const pending: NDKEvent[] = [];
  for (const wrap of events) {
    const cached = wrap.id ? _rumorCache.get(wrap.id) : undefined;
    if (cached) rumors.push(cached);
    else pending.push(wrap);
  }
  if (pending.length < events.length) {
    debug.log(`[DM] ${events.length - pending.length}/${events.length} gift wraps already decrypted this session`);
  }

  for (let i = 0; i < pending.length; i += UNWRAP_CONCURRENCY) {
    const batch = pending.slice(i, i + UNWRAP_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (wrap) => {
        // Full id for the cache key; truncated only for logging.
        const id = wrap.id;
        try {
          return { id, rumor: await giftUnwrap(wrap, undefined, instance.signer) };
        } catch (err) {
          debug.warn(`[DM] unwrap failed for event ${id?.slice(0, 8)}:`, err);
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
        // Only successes are cached. A failure is usually a missing signer
        // permission, which the user can grant and retry — caching that would
        // make the retry look broken.
        if (result.id && _rumorCache.size < RUMOR_CACHE_MAX) {
          _rumorCache.set(result.id, rumor);
        }
      } else {
        // Opened fine, but it isn't a NIP-17 chat message. Silently dropping
        // this was the last way a gift wrap could vanish without explanation:
        // the fetch worked, AUTH worked, decryption worked, and Messages still
        // showed nothing. Anything that wraps a different kind — a bot, a
        // client sending gift-wrapped kind 4 — landed here invisibly.
        unexpectedKinds.add(rumor.kind ?? -1);
        debug.warn(`[DM] gift wrap ${result.id?.slice(0, 8)} contained kind ${rumor.kind}, not ${NDKKind.PrivateDirectMessage}`);
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

  // Gift-wrap to recipient and self (so sent messages appear in our inbox),
  // and resolve both parties' published DM relays (kind 10050) meanwhile.
  const [wrappedForRecipient, wrappedForSelf, recipientDMRelays, ownDMRelays] = await Promise.all([
    giftWrap(rumor, recipient, instance.signer),
    giftWrap(rumor, myUser, instance.signer),
    resolveDMRelays(recipientPubkey),
    resolveOwnDMRelays(myUser.pubkey),
  ]);
  if (recipientDMRelays.length > 0) {
    debug.log(`[DM] recipient publishes DM relays: ${recipientDMRelays.join(", ")}`);
  }

  // NDK's per-relay publish timeout defaults to 2500ms, which is shorter than
  // an AUTH handshake on an auth-required relay: the publish is held until the
  // relay authenticates, and on a remote signer that is several round-trips.
  // NDK does eventually land the event — an `OK false` reading `auth-required`
  // is re-queued and resent by `retryPendingAuthPublishes` — but by then the
  // caller's promise has already rejected, so the UI reported a send failure
  // for a message that went out moments later. See #53.
  //
  // Each wrap targets its owner's DM relays merged with the configured list —
  // undefined (the pool, as before #49) when reach is off or no 10050 exists.
  const [recipientResult, selfResult] = await Promise.all([
    wrappedForRecipient.publish(dmRelaySet(recipientDMRelays, instance), DM_PUBLISH_TIMEOUT),
    wrappedForSelf.publish(dmRelaySet(ownDMRelays, instance), DM_PUBLISH_TIMEOUT),
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
