// Every event a relay sends is checked before anything in NDK or Vega sees
// it. NDK 3.0.3 does not do that by itself, in two ways, both shown with real
// NDK in `authentic.test.ts`.
//
// 1. It samples. A relay's events stop being checked once the relay has
//    "proved itself". For a relay created after the NDK instance (one added
//    in the Relays view, one from a published relay list, one reached through
//    Relay reach, the built-in relay) a slip in NDK makes that total: after
//    ten good events and the next thirty-second tick, none of its events are
//    checked at all. The NDK constructor builds the pool before it sets
//    `validationRatioFn`, so only the relays of the configured list get the
//    safe default; the rest get a method bound to the wrong object, which
//    works out the share to check as NaN.
//
// 2. Its record of signatures already checked is kept by the id the event
//    *claims*, and nothing compares that id with the hash of the event. A
//    relay sends one honestly signed event under an id of its choosing, then
//    a forged event under the same id: the record says "checked", and the
//    forgery is taken, from any relay, the configured ones included.
//
// Either way a relay could hand Vega an event under anyone's name: a note, a
// profile, or the account's own follow list, which the next Follow click then
// republished under the user's own key.
//
// So: every relay's events are always checked (`shouldValidateEvent` below),
// and an event whose id is not the hash of what it says is dropped before NDK
// looks at it (`guardIncomingEvents`), which makes NDK's record sound: the
// same id can then only mean the same author, time, kind, tags and content.

import NDK, { NDKEvent, NDKRelay, type NostrEvent } from "@nostr-dev-kit/ndk";
import { debug } from "../debug";

// NDK decides per relay, per event, whether to check the signature. Always.
NDKRelay.prototype.shouldValidateEvent = function shouldValidateEvent(): boolean {
  return true;
};

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;

/**
 * Whether an event is what its id says: the right shape, and an id that is
 * the hash of its author, time, kind, tags and content.
 *
 * Not the signature: NDK checks that, once per id, and this is what makes
 * "once per id" safe.
 */
export function hasItsOwnId(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const event = raw as Partial<NostrEvent>;
  if (typeof event.id !== "string" || !HEX_64.test(event.id)) return false;
  if (typeof event.sig !== "string" || !HEX_128.test(event.sig)) return false;
  try {
    const parsed = new NDKEvent(undefined, event as NostrEvent);
    return parsed.isValid && parsed.getEventHash() === event.id;
  } catch {
    return false;
  }
}

/**
 * Put the check in front of an NDK instance, and return the instance.
 *
 * `dispatchEvent` is the one place in NDK where an event from a relay is
 * matched to the subscriptions that want it: NDK's own fetches (profiles,
 * relay lists, a remote signer's replies) as much as Vega's. An event handed
 * round as it is published (`optimisticPublish`) was made and signed here and
 * is let through.
 *
 * **Every `new NDK(...)` in the app goes through this.** A test reads the
 * sources for one that does not.
 */
export function guardIncomingEvents<T extends NDK>(ndk: T): T {
  // Verification has to stay synchronous. With NDK's worker (`asyncSigVerification`)
  // an event is handed to its subscription before the signature is known, and a
  // bad one only raises `event:invalid-sig` afterwards, which nothing listens for.
  // The id check above does not cover that: a correct id over a forged signature
  // would get through. Moving verification off the main thread means handling
  // that event, not just flipping the option.
  if (ndk.asyncSigVerification) throw new Error("Signature verification must be synchronous: see authentic.ts");
  const manager = ndk.subManager;
  const dispatch = manager.dispatchEvent.bind(manager);
  manager.dispatchEvent = (event, relay, optimisticPublish = false) => {
    if (!optimisticPublish && !hasItsOwnId(event)) {
      debug.warn(`[Vega] Dropped an event whose id is not its own, from ${relay?.url ?? "an unknown relay"}`);
      return;
    }
    dispatch(event, relay, optimisticPublish);
  };
  return ndk;
}
