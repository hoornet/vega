import NDK, { NDKEvent, NDKFilter, NDKRelay, NDKRelaySet, NDKSubscription, NDKSubscriptionCacheUsage, tryNormalizeRelayUrl } from "@nostr-dev-kit/ndk";
import { debug } from "../debug";
import { pruneOrphanRelaySubscriptionsInPool } from "./relayAuth";

// ─── Fetch timeout helper ───────────────────────────────────────────

/** Race a promise against a timeout. Returns fallback on timeout. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => {
      debug.warn(`[Vega] Fetch timed out after ${ms}ms`);
      resolve(fallback);
    }, ms)),
  ]);
}

/**
 * Stop a subscription, then sweep the orphan NDK leaves behind.
 *
 * `sub.stop()` on a RUNNING subscription that never EOSEd returns early without
 * sending CLOSE and without running `cleanup()`, stranding an `authed` listener
 * that later re-REQs with an empty filter set. See the long note on
 * `pruneOrphanRelaySubscriptions`. Prefer this over `sub.stop()` everywhere.
 */
export function stopSubscription(sub: NDKSubscription, instance: NDK): void {
  try { sub.stop(); } catch { /* ignore */ }
  try { pruneOrphanRelaySubscriptionsInPool(instance); } catch { /* ignore */ }
}

export const FEED_TIMEOUT = 8000;    // 8s for feed fetches
export const THREAD_TIMEOUT = 5000;  // 5s per thread round-trip
export const SINGLE_TIMEOUT = 5000;  // 5s for single event lookups

// ─── Active fetch counter + concurrency semaphore ──────────────────
let _activeFetchCount = 0;
/** Number of in-flight fetchWithTimeout calls (subscriptions currently open). */
export function getActiveFetchCount(): number { return _activeFetchCount; }

// Hard cap on concurrent NDK subscriptions.
// Without this, rendering 200 cached notes triggers 400+ simultaneous subscriptions
// (useReplyCount + useZapCount per note), each receiving events from 7+ relays → OOM.
const MAX_CONCURRENT_FETCHES = 25;
const _fetchQueue: Array<() => void> = [];

function _runNextFetch() {
  while (_fetchQueue.length > 0 && _activeFetchCount < MAX_CONCURRENT_FETCHES) {
    const next = _fetchQueue.shift()!;
    next();
  }
}

/**
 * Fetch events with explicit subscription lifecycle.
 *
 * IMPORTANT: Do NOT use instance.fetchEvents() here. fetchEvents() creates an
 * NDK subscription internally that we cannot cancel if the timeout fires first.
 * Abandoned subscriptions keep receiving relay data forever, leaking memory.
 *
 * This implementation uses subscribe() directly so we can stop the subscription
 * on both EOSE and timeout. Note that `sub.stop()` alone does NOT guarantee
 * that: on a RUNNING subscription that never EOSEd — which is exactly what a
 * relay answering `CLOSED auth-required:` produces — NDK skips both the CLOSE
 * frame and its listener cleanup. Use `stopSubscription()`, never a bare stop.
 *
 * Concurrency is capped at MAX_CONCURRENT_FETCHES. Excess calls queue and
 * start as slots free up.
 */
export function fetchWithTimeout(
  instance: NDK,
  filter: NDKFilter,
  timeoutMs: number,
  relaySet?: NDKRelaySet,
): Promise<Set<NDKEvent>> {
  return new Promise((resolve) => {
    const start = () => {
      const events = new Set<NDKEvent>();
      let settled = false;
      _activeFetchCount++;

      const finish = () => {
        if (settled) return;
        settled = true;
        _activeFetchCount--;
        clearTimeout(timer);
        stopSubscription(sub, instance);
        resolve(events);
        _runNextFetch();
      };

      const sub = instance.subscribe(
        filter,
        {
          cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
          groupable: false,
          closeOnEose: true,
          // Only bites on authors-scoped filters, where NDK resolves each author
          // to their NIP-65 write relays and opens a connection to every one.
          // The default of 2 measured at ~18-21 relays for a single follow list
          // (issue #36) — connections opened and torn down for one fetch. The
          // cost of 1 is redundancy per author, softened by NDK also querying
          // the user's own connected relays regardless of this goal.
          relayGoalPerAuthor: 1,
        },
        relaySet,
      );

      sub.on("event", (event: NDKEvent) => {
        if (!settled) events.add(event);
      });
      sub.on("eose", finish);

      const timer = setTimeout(() => {
        debug.warn(`[Vega] Fetch timed out after ${timeoutMs}ms (collected ${events.size} events, queue: ${_fetchQueue.length})`);
        finish();
      }, timeoutMs);
    };

    if (_activeFetchCount < MAX_CONCURRENT_FETCHES) {
      start();
    } else {
      _fetchQueue.push(start);
    }
  });
}

export const RELAY_STORAGE_KEY = "wrystr_relays";

export const FALLBACK_RELAYS = [
  "wss://relay2.veganostr.com",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
];

// Override NDK's default outbox relays (purplepag.es can have DNS issues)
export const OUTBOX_RELAYS = [
  "wss://relay2.veganostr.com/",
  "wss://relay.damus.io/",
  "wss://nos.lol/",
  "wss://relay.nostr.band/",
];

/** Normalize relay URL: lowercase host, strip trailing slash, deduplicate. */
export function normalizeRelayUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * The embedded strfry relay, which lives in the pool but deliberately never in
 * the stored relay list.
 *
 * Tolerates either URL form — callers pass `NDKRelay.url` (trailing slash) as
 * often as stored URLs (stripped), and the port is assigned at runtime by the
 * Rust side, so it cannot be matched as a constant.
 */
export function isLocalRelayUrl(url: string): boolean {
  return /^ws:\/\/(127\.0\.0\.1|localhost):/.test(normalizeRelayUrl(url));
}

const VEGA_RELAY = "wss://relay2.veganostr.com";
const VEGA_RELAY_MIGRATED_KEY = "wrystr_vega_relay_added";

export function getStoredRelayUrls(): string[] {
  try {
    const stored = localStorage.getItem(RELAY_STORAGE_KEY);
    if (stored) {
      // Deduplicate on load (handles legacy duplicates from trailing-slash mismatch)
      const urls: string[] = JSON.parse(stored);
      const seen = new Set<string>();
      const deduped = urls.map(normalizeRelayUrl).filter((u) => {
        if (seen.has(u)) return false;
        seen.add(u);
        return true;
      });

      // One-time: inject Vega relay for existing users
      if (!localStorage.getItem(VEGA_RELAY_MIGRATED_KEY)) {
        localStorage.setItem(VEGA_RELAY_MIGRATED_KEY, "1");
        if (!deduped.includes(VEGA_RELAY)) {
          deduped.unshift(VEGA_RELAY);
          saveRelayUrls(deduped);
        }
      }

      return deduped;
    }
  } catch { /* ignore */ }
  return FALLBACK_RELAYS;
}

export function saveRelayUrls(urls: string[]) {
  localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify(urls.map(normalizeRelayUrl)));
  _allowedRelays = null;
}

/**
 * "Use authors' relays (NIP-65 outbox)".
 *
 * **On by default**, and deliberately so. Outbox was silently enabled for the
 * entire history of the app — the code believed omitting `outboxRelayUrls`
 * disabled it, and it never did (see the outbox section in CLAUDE.md). So every
 * release users are happy with shipped *with* this behaviour: switching it off
 * would be the untested change, not the safe one. Users who want Vega confined
 * to their own relay list turn it off; everyone else keeps the reach they have.
 * See issue #35.
 */
const OUTBOX_ENABLED_KEY = "wrystr_use_author_relays";

export function isOutboxRelaysEnabled(): boolean {
  return localStorage.getItem(OUTBOX_ENABLED_KEY) !== "false";
}

export function setOutboxRelaysEnabled(enabled: boolean): void {
  localStorage.setItem(OUTBOX_ENABLED_KEY, enabled ? "true" : "false");
}

/** Cached so the connection filter doesn't re-parse localStorage per relay per author. */
let _allowedRelays: Set<string> | null = null;

/**
 * Gate for every relay NDK wants to connect to.
 *
 * NDK calls this in two places that matter: `NDKPool.addRelay`, and — crucially —
 * the OutboxTracker, where it prunes the read/write relays discovered from each
 * author's NIP-65 list. That second one is what stops a follow feed from
 * expanding into every relay your follows happen to write to (29, in the report
 * on issue #35) while your own list holds exactly one.
 */
export function isRelayAllowed(url: string): boolean {
  if (isOutboxRelaysEnabled()) return true;
  const normalized = normalizeRelayUrl(url);
  // The embedded strfry relay is deliberately never in the stored list.
  if (isLocalRelayUrl(normalized)) return true;
  if (!_allowedRelays) {
    _allowedRelays = new Set(getStoredRelayUrls().map(normalizeRelayUrl));
  }
  return _allowedRelays.has(normalized);
}

/**
 * The stored relay list in NDK's own normalized form (trailing slash).
 *
 * NDK's temporary-relay pruner is an **exact string match**:
 *
 *     if (this.ndk.explicitRelayUrls?.includes(relay.url)) return;
 *     this.removeRelay(relay.url);
 *
 * `relay.url` always carries a trailing slash, because `NDKRelay` normalizes it.
 * But NDK's *constructor* assigns `opts.explicitRelayUrls` verbatim — only the
 * setter normalizes — so handing it our stripped form made every relay configured
 * at startup read to the pruner as disposable. Relays added later survived, since
 * `syncExplicitRelayUrl` pushes `tryNormalizeRelayUrl`. Normalizing at this one
 * boundary makes both paths agree.
 *
 * Storage keeps the stripped form (`saveRelayUrls`); only the handoff to NDK
 * converts. Don't "fix" this by assigning `ndk.explicitRelayUrls` — that setter
 * clears the pool. See `syncExplicitRelayUrl`.
 */
function ndkExplicitRelayUrls(): string[] {
  return getStoredRelayUrls().map((u) => tryNormalizeRelayUrl(u) ?? u);
}

/**
 * Shared NDK options. Both NIP-65 knobs MUST be passed explicitly — each one
 * defaults to on, and each was silently on for the app's entire history.
 *
 * - `enableOutboxModel`: NDK treats anything other than a literal `false` as
 *   enabled (`if (!(opts.enableOutboxModel === false))`), so simply omitting
 *   `outboxRelayUrls` — which is what this code used to do — left the outbox
 *   model fully switched on.
 * - `autoConnectUserRelays`: on login, `setActiveUser` → `getUserRelayList`
 *   reads the signed-in user's *published* kind-10002 list and adds every relay
 *   in it with a plain `pool.addRelay()` — **no prune timer, so they stay for
 *   the life of the instance**. That is a third way relays enter the pool, and
 *   it is why the pool settles above the configured count (issue #36).
 *
 * Both are tied to the same "Relay reach" switch, because to a user they are
 * one promise: reach beyond my list, or don't. `relayConnectionFilter` already
 * blocks the second path when reach is off — this makes the intent explicit
 * rather than relying on the filter to catch it.
 */
function ndkOptions() {
  return {
    explicitRelayUrls: ndkExplicitRelayUrls(),
    enableOutboxModel: isOutboxRelaysEnabled(),
    autoConnectUserRelays: isOutboxRelaysEnabled(),
    relayConnectionFilter: isRelayAllowed,
  };
}

let ndk: NDK | null = null;
let ndkCreatedAt: number | null = null;

export function getNDK(): NDK {
  if (!ndk) {
    // Outbox discovery connects to every event author's preferred relays, ballooning
    // the relay pool from 7 to 40+ and flooding startLiveFeed() with a firehose of
    // events from all those relays simultaneously → OOM crash. Disabling it takes an
    // explicit `enableOutboxModel: false`; see ndkOptions().
    ndk = new NDK(ndkOptions());
    ndkCreatedAt = Date.now();
  }
  return ndk;
}

export function getNDKUptimeMs(): number | null {
  return ndkCreatedAt ? Date.now() - ndkCreatedAt : null;
}

/**
 * Destroy the current NDK instance and create a fresh one.
 * Preserves the signer (login state) but resets all relay connections.
 * Use as a last resort when relay connections are unrecoverable.
 */
export async function resetNDK(): Promise<void> {
  const oldInstance = ndk;
  const oldSigner = oldInstance?.signer ?? null;

  // Only preserve the stored relay URLs — do NOT preserve outbox-discovered relays.
  // Outbox-discovered relays are the source of the relay pool explosion (7 → 40+).
  const storedUrls = ndkExplicitRelayUrls();

  // Disconnect all relays on old instance
  if (oldInstance?.pool?.relays) {
    for (const relay of oldInstance.pool.relays.values()) {
      try { relay.disconnect(); } catch { /* ignore */ }
    }
  }

  // Create fresh instance with only the stored relay URLs
  ndk = new NDK({ ...ndkOptions(), explicitRelayUrls: storedUrls });
  ndkCreatedAt = Date.now();

  // Restore signer so user stays logged in
  if (oldSigner) {
    ndk.signer = oldSigner;
  }

  // Connect fresh
  debug.log("[Vega] NDK instance reset — connecting fresh relays");
  await ndk.connect();
  await waitForConnectedRelay(ndk, 5000);

  // Re-add local relay if enabled (dynamic import to avoid circular dependency)
  import("../localRelay").then(({ isLocalRelayEnabled, connectLocalRelay }) => {
    if (isLocalRelayEnabled()) {
      connectLocalRelay().catch(() => {});
    }
  }).catch(() => {});

  const relays = Array.from(ndk.pool?.relays?.values() ?? []);
  const connected = relays.filter((r) => r.connected).length;
  debug.log(`[Vega] Fresh connection: ${connected}/${relays.length} relays connected`);
}

/**
 * Add/remove a URL in NDK's own `explicitRelayUrls` array.
 *
 * Removing a relay from `pool.relays` is NOT enough to stop using it. NDK falls
 * back to `explicitRelayUrls` whenever it builds a relay set for a filter it
 * can't scope to specific authors (`calculateRelaySetsFromFilter`), and re-adds
 * those URLs to the pool — so a deleted relay comes back on the very next
 * subscription and only stays gone after a restart, when the fresh NDK instance
 * is constructed from the stored list. That was issue #35.
 *
 * The array is mutated in place on purpose. Assigning `instance.explicitRelayUrls`
 * runs a setter that also does `pool.relayUrls = urls`, which CLEARS the pool and
 * rebuilds every NDKRelay from scratch — that would drop the embedded local relay,
 * which is deliberately in the pool but never in the stored relay list
 * (see `localRelay.ts`).
 */
function syncExplicitRelayUrl(instance: NDK, url: string, present: boolean): void {
  const list = instance.explicitRelayUrls;
  if (!Array.isArray(list)) return;

  // NDK stores its own normalized form (trailing slash); ours is stripped.
  const ndkUrl = tryNormalizeRelayUrl(url);
  const variants = new Set([url, normalizeRelayUrl(url), ...(ndkUrl ? [ndkUrl] : [])]);

  for (let i = list.length - 1; i >= 0; i--) {
    if (variants.has(list[i])) list.splice(i, 1);
  }
  if (present) list.push(ndkUrl ?? url);
}

export function addRelay(url: string): void {
  const normalized = normalizeRelayUrl(url);
  const instance = getNDK();
  const urls = getStoredRelayUrls();
  if (!urls.includes(normalized)) {
    saveRelayUrls([...urls, normalized]);
  }
  // Without this the relay lives in the pool but is invisible to NDK's relay-set
  // calculation, so nothing actually subscribes to it until the next restart.
  syncExplicitRelayUrl(instance, normalized, true);
  // Check both with and without trailing slash since NDK may use either
  if (!instance.pool?.relays.has(normalized) && !instance.pool?.relays.has(normalized + "/")) {
    const relay = new NDKRelay(normalized, undefined, instance);
    instance.pool?.addRelay(relay, true);
  }
}

export function removeRelay(url: string): void {
  const instance = getNDK();
  // NDK may store URLs with or without trailing slash — check both
  const variants = [url, url.replace(/\/$/, ""), url.replace(/\/?$/, "/")];
  for (const v of variants) {
    const relay = instance.pool?.relays.get(v);
    if (relay) {
      relay.disconnect();
      instance.pool?.relays.delete(v);
    }
  }
  syncExplicitRelayUrl(instance, url, false);
  saveRelayUrls(getStoredRelayUrls().filter((u) => u !== url));
}

function waitForConnectedRelay(instance: NDK, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, _reject) => {
    const timer = setTimeout(() => {
      // Even on timeout, continue — some relays may connect later
      debug.warn("Relay connection timeout, continuing anyway");
      resolve();
    }, timeoutMs);

    const check = () => {
      const relays = Array.from(instance.pool?.relays?.values() ?? []);
      const hasConnected = relays.some((r) => r.connected);
      if (hasConnected) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  });
}

export async function connectToRelays(): Promise<void> {
  const instance = getNDK();
  await instance.connect();
  await waitForConnectedRelay(instance);
}

/**
 * Ensure at least one relay is connected.
 * If relays report connected, trust them and return immediately.
 * Only reconnect if zero relays are connected — never force-disconnect working connections.
 */
export async function ensureConnected(): Promise<boolean> {
  const instance = getNDK();
  const relays = Array.from(instance.pool?.relays?.values() ?? []);
  const connectedCount = relays.filter((r) => r.connected).length;

  if (connectedCount > 0) {
    return true; // Trust relay.connected — don't probe or disconnect
  }

  debug.warn(`[Vega] No relays connected (${relays.length} in pool) — attempting reconnect`);

  try {
    await withTimeout(instance.connect(), 4000, undefined);
    await waitForConnectedRelay(instance, 3000);
    const after = Array.from(instance.pool?.relays?.values() ?? []);
    const nowConnected = after.some((r) => r.connected);
    debug.log(`[Vega] Reconnect ${nowConnected ? "succeeded" : "failed"}`);
    return nowConnected;
  } catch {
    debug.error("[Vega] Reconnect failed");
    return false;
  }
}
