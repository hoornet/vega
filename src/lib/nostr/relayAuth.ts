import type NDK from "@nostr-dev-kit/ndk";
import type { NDKRelay } from "@nostr-dev-kit/ndk";
import { NDKRelayStatus } from "@nostr-dev-kit/ndk";
import { debug } from "../debug";

/**
 * How far Vega will prove who you are.
 *
 * NIP-42 AUTH is not a neutral handshake: you sign a kind 22242 with your
 * identity key, so every relay you answer learns who you are and can link that
 * to everything you subsequently ask for. Answering every challenge would
 * quietly break the promise the relay list makes — the same promise the Relay
 * reach switch exists to keep. See issue #48.
 */
export type RelayAuthScope = "configured" | "any";

const RELAY_AUTH_SCOPE_KEY = "wrystr_relay_auth_scope";

/**
 * Defaults to `"configured"`, and **fails closed** — anything other than the
 * literal `"any"`, including a corrupt value, keeps Vega on your own relays.
 *
 * Deliberately the opposite polarity to Relay reach's default-on
 * `!== "false"`: that switch preserved behaviour the app had shipped with for
 * its entire history, so leaving it on was the tested choice. NIP-42 has no
 * incumbent behaviour at all, so the default is a free choice and goes to the
 * private side.
 */
export function getRelayAuthScope(): RelayAuthScope {
  return localStorage.getItem(RELAY_AUTH_SCOPE_KEY) === "any" ? "any" : "configured";
}

export function setRelayAuthScope(scope: RelayAuthScope): void {
  localStorage.setItem(RELAY_AUTH_SCOPE_KEY, scope);
}

/**
 * Whether we will identify ourselves to this relay.
 *
 * `configured` holds the stored relay list in **stripped** form; `relayUrl`
 * usually arrives as `NDKRelay.url`, which always carries a trailing slash.
 * The strip below is that boundary, and it is the whole reason this is a pure
 * function with its own tests — comparing the two forms directly is the bug
 * class that made every configured relay read as disposable in v0.15.3.
 *
 * `isLocal` is passed in rather than imported so this module stays a leaf and
 * cannot form a cycle with core.ts.
 */
export function shouldAuthenticate(
  relayUrl: string,
  scope: RelayAuthScope,
  configured: Set<string>,
  isLocal: boolean,
): boolean {
  // The embedded strfry relay is ours and deliberately never in the stored
  // list, so a plain list check would refuse it. It has no auth configured
  // today; this is here so it keeps working the day it does.
  if (isLocal) return true;
  if (scope === "any") return true;
  return configured.has(relayUrl.replace(/\/+$/, ""));
}

/**
 * Authenticated means `status === AUTHENTICATED`, never the `authed` event.
 *
 * NDK emits `authed` twice. The first is premature: `onAuthRequested` calls
 * `authenticate()` fire-and-forget and then runs `_status = CONNECTED` and
 * `emit("authed")` synchronously — before the 22242 has been signed, let alone
 * acknowledged. The real one follows from the `.then()`, with status 8.
 *
 * The gap is invisible with a local nsec (sub-millisecond) and seconds wide
 * with a NIP-46 bunker, so anything keyed on the event alone works on the
 * developer's machine and fails for the person who reported the bug.
 */
export function isRelayAuthenticated(relay: NDKRelay): boolean {
  return relay.status === NDKRelayStatus.AUTHENTICATED;
}

/** Relays that challenged us while out of scope, or before we had a signer. */
const _declined = new Set<string>();
const _noSigner = new Set<string>();

export function recordDeclined(url: string): void { _declined.add(url); }
export function recordNoSigner(url: string): void { _noSigner.add(url); }

export function getPendingAuthRelays(): { declined: string[]; noSigner: string[] } {
  return { declined: [..._declined], noSigner: [..._noSigner] };
}

export function clearPendingAuthRelay(url: string): void {
  _declined.delete(url);
  _noSigner.delete(url);
}

/**
 * Force a fresh AUTH challenge by bouncing the connection.
 *
 * There is no way to ask a relay to re-challenge, and NDK will not re-run the
 * policy on its own: a declined relay is left at `AUTHENTICATING`, which trips
 * the re-entrancy guard in `onAuthRequested` for the life of the connection.
 * Reconnecting is the only lever, and it is also the honest one when the user
 * has just *narrowed* their scope — you cannot untell a relay who you are, but
 * you can stop using a session you no longer consent to.
 */
export function rechallengeRelays(instance: NDK, urls: string[]): void {
  if (urls.length === 0) return;
  const wanted = new Set(urls.map((u) => u.replace(/\/+$/, "")));

  for (const relay of instance.pool?.relays?.values() ?? []) {
    if (!wanted.has(relay.url.replace(/\/+$/, ""))) continue;
    clearPendingAuthRelay(relay.url);
    try {
      relay.disconnect();
      void relay.connect().catch(() => { /* reconnect is best-effort */ });
    } catch (err) {
      debug.warn(`[Vega] Failed to re-challenge ${relay.url}:`, err);
    }
  }
}

/** Every relay currently holding an authenticated session. */
export function authenticatedRelayUrls(instance: NDK): string[] {
  const urls: string[] = [];
  for (const relay of instance.pool?.relays?.values() ?? []) {
    if (isRelayAuthenticated(relay)) urls.push(relay.url);
  }
  return urls;
}

/**
 * `NDKRelaySubscriptionStatus.RUNNING`. The enum is type-only in NDK's bundle —
 * `require("@nostr-dev-kit/ndk").NDKRelaySubscriptionStatus` is `undefined` — so
 * the literal is the only way to compare it at runtime.
 */
const RELAY_SUB_RUNNING = 3;

/**
 * Close relay-level subscriptions that are RUNNING but hold no items.
 *
 * These are ghosts, and they are armed rather than merely untidy. `sub.stop()`
 * on a subscription that is RUNNING and has never EOSEd hits an early return in
 * NDK's `NDKRelaySubscription.removeItem`:
 *
 *     this.items.delete(subscription.internalId);
 *     if (this.items.size === 0) {
 *       if (this.status === 0 || this.status === 1) { ...cleanup(); return; }
 *       if (!this.eosed) return;          // <- here
 *       this.close(); this.cleanup();
 *     }
 *
 * `cleanup()` is what removes the `relay.once("authed", reExecuteAfterAuth)`
 * listener that `execute()` registers whenever `relay.status < AUTHENTICATED`.
 * Skipping it leaves that listener attached to a relaySub with zero items. When
 * `authed` later fires, it re-executes: `compileFilters()` returns `[]`, and
 * `NDKRelayConnectivity.req` builds the frame as
 *
 *     `["REQ","${subId}",${JSON.stringify(filters).substring(1)}`
 *
 * where `JSON.stringify([]).substring(1)` is `"]"` — putting `["REQ","<id>",]`
 * on the wire. That is invalid JSON. strfry and nostr-rs-relay treat a parse
 * error as fatal, so the socket drops, NDK reconnects, the relay challenges
 * again, and with a NIP-46 signer each cycle costs another bunker signature.
 *
 * A relay that answers `CLOSED auth-required:` never sends EOSE, so this is
 * exactly the shape every auth-blocked fetch leaves behind. The 60s
 * notification poller manufactures two per minute per auth-required relay.
 *
 * This is inert until something emits `authed`, which is why it lands before
 * the auth policy rather than with it.
 *
 * Returns how many were pruned.
 */
export function pruneOrphanRelaySubscriptions(relay: NDKRelay): number {
  let pruned = 0;
  const groups = relay.subs?.subscriptions;
  if (!groups) return 0;

  for (const group of groups.values()) {
    for (const relaySub of group) {
      // Only RUNNING+empty. INITIAL/PENDING/WAITING are mid-setup and may still
      // receive their items — `addItem` runs synchronously in `addSubscription`,
      // but a scheduled execution has not necessarily got there yet. CLOSED is
      // already done.
      if (relaySub.items.size > 0 || relaySub.status !== RELAY_SUB_RUNNING) continue;
      try {
        // `NDKRelaySubscription.close` is TS-private; `relay.close(subId)` is the
        // public route to the same CLOSE frame.
        relay.close(relaySub.subId);
        relaySub.cleanup();
        pruned++;
      } catch (err) {
        debug.warn("[Vega] Failed to prune orphan relay subscription:", err);
      }
    }
  }

  if (pruned > 0) {
    debug.log(`[Vega] Pruned ${pruned} orphan subscription(s) on ${relay.url}`);
  }
  return pruned;
}

/** Prune orphans across every relay in the pool. */
export function pruneOrphanRelaySubscriptionsInPool(instance: NDK): number {
  let pruned = 0;
  for (const relay of instance.pool?.relays?.values() ?? []) {
    pruned += pruneOrphanRelaySubscriptions(relay);
  }
  return pruned;
}
