import type NDK from "@nostr-dev-kit/ndk";
import type { NDKRelay } from "@nostr-dev-kit/ndk";
import { debug } from "../debug";

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
