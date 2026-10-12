import { NDKEvent, NDKFilter, NDKKind, NDKUserProfile, profileFromEvent } from "@nostr-dev-kit/ndk";
import { fetchReplaceableList, relaysToAsk } from "./lists";
export { relaysToAsk };
import { getNDK, fetchWithTimeout, fetchFromRelay, builtInRelayTest, FEED_TIMEOUT, publishToNetwork } from "./core";
import {
  type ContactListResult,
  type ContactListSnapshot,
} from "../contacts";

export interface ProfileFields {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
}

/**
 * Publish `pubkey`'s profile, and return it as the app holds profiles.
 *
 * Signed with the key for `pubkey` or not at all. The signature is whoever is
 * signed in when it is made, and a profile is the one event that says who an
 * account is: published under the wrong key it gives another account this
 * one's name. So the key is checked first and the event is signed with that
 * very signer, not with whichever one is in place a moment later.
 *
 * What comes back is what the relays now hold, so the caller can show it
 * without asking them: a fetch straight after a publish can come back empty
 * (see "Contact list (kind 3) and NDK's early EOSE" in CLAUDE.md).
 */
export async function publishProfile(fields: ProfileFields, pubkey: string): Promise<NDKUserProfile> {
  const instance = getNDK();
  const signer = instance.signer;
  if (!signer || (await signer.user()).pubkey !== pubkey) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = 0;
  event.content = JSON.stringify(fields);
  await event.sign(signer);
  await publishToNetwork(event);
  return profileFromEvent(event);
}

/** How long a relay gets to answer for the contact list before its silence counts. */
const CONTACT_LIST_TIMEOUT = 6000;


/**
 * Fetch `pubkey`'s contact list (kind 3) by asking every connected relay
 * individually, and say honestly what came back: a list, proof of no list, or
 * "could not tell" (see `ContactListResult`).
 *
 * This replaces `NDKUser.follows()`, which is a multi-relay `fetchEvent` and so
 * inherits NDK's early EOSE quorum — see `fetchFromRelay` in core.ts for the
 * mechanism and the measurement. A user's kind 3 can live on a single relay;
 * when that relay was the slow one the list came back empty, the UI said "not
 * following anyone", and the next Follow click published a one-person list
 * over the real one.
 *
 * `onFound` fires as soon as any relay returns a list (and again if a newer one
 * turns up), so the UI does not have to wait for the slowest relay just to
 * render. The returned promise settles when every relay has answered or timed
 * out, which is what a caller about to *publish* needs.
 */
export async function fetchContactList(
  pubkey: string,
  opts: { timeoutMs?: number; onFound?: (list: ContactListSnapshot) => void } = {},
): Promise<ContactListResult> {
  return fetchReplaceableList(3, pubkey, { timeoutMs: opts.timeoutMs ?? CONTACT_LIST_TIMEOUT, onFound: opts.onFound });
}

/**
 * Publish a contact list. The caller supplies the complete tag set and content
 * — built from the newest known list by `nextContactTags` — so relay hints,
 * petnames and non-`p` tags are carried over. This function never invents a
 * list from a bare array of pubkeys; that shape is what made the wipe possible.
 */
export async function publishContactList(tags: string[][], content: string): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = 3;
  event.content = content;
  event.tags = tags;
  await publishToNetwork(event);
}

export async function fetchProfile(pubkey: string) {
  const instance = getNDK();
  const user = instance.getUser({ pubkey });
  // NDK hands an event to every open subscription that matches it the moment
  // it is published, before any relay has answered, and its own profile fetch
  // is such a subscription. Without this a profile that no relay took came
  // back from a fetch that was on its way, and was shown as the account's:
  // a name "not published" by the toast and in the sidebar all the same.
  await user.fetchProfile({ skipOptimisticPublishEvent: true });
  return user.profile ?? null;
}

/** What the relays hold as an account's profile. The three answers must stay distinct, as for the contact list. */
export type ProfileRead =
  /** `fromNetwork`: whether a relay on the network answered. With only the built-in relay's copy, the network is still to be read. */
  | { status: "found"; profile: NDKUserProfile; fromNetwork: boolean }
  /** Every relay on the network that was asked answered, and none holds a profile. */
  | { status: "none" }
  /** Not every relay answered and none returned one: it cannot be told. */
  | { status: "unknown" };

/**
 * Whether `a` replaces `b` as the newest of two replaceable events: later,
 * or of the same second and the lower id, as NIP-01 has it. Without the
 * tie-break, two profiles published in one second would swap from one read
 * to the next, by whichever relay answered first.
 */
function newerEvent(a: { created_at?: number; id: string }, b: { created_at?: number; id: string } | null): boolean {
  if (!b) return true;
  const at = a.created_at ?? 0;
  const bt = b.created_at ?? 0;
  return at > bt || (at === bt && a.id < b.id);
}

/** How long a relay gets to answer for a profile before its silence counts. */
const OWN_PROFILE_TIMEOUT = 6000;

/**
 * An account's profile, asked of each relay on its own, newest wins.
 *
 * For the account's own profile, where "the newest there is" matters: it is
 * what the edit form opens on and what the next save is made from. One fetch
 * over several relays is cut short by NDK once most have answered (see
 * "Contact list (kind 3) and NDK's early EOSE" in CLAUDE.md), so a profile
 * saved a minute ago and held by one slower relay lost to the previous one
 * held by three quick ones. Asked one at a time, each relay is waited for.
 *
 * `fetchProfile` stays the way to read anyone else's: one grouped request
 * for a screen of cards, where a slightly old name does no harm.
 */
export async function fetchProfileFromEachRelay(
  pubkey: string,
  opts: { maxWaitMs?: number; onFound?: (profile: NDKUserProfile) => void } = {},
): Promise<ProfileRead> {
  const instance = getNDK();
  const relays = await relaysToAsk(instance, opts.maxWaitMs);
  if (relays.length === 0) return { status: "unknown" };

  const filter: NDKFilter = { kinds: [NDKKind.Metadata], authors: [pubkey] };
  const builtIn = builtInRelayTest();
  type Newest = { profile: NDKUserProfile; id: string };
  let newest: Newest | null = null;
  const answers = await Promise.all(
    relays.map(async (relay) => {
      const { events, answered } = await fetchFromRelay(instance, relay, filter, OWN_PROFILE_TIMEOUT);
      for (const event of events) {
        if (event.kind !== NDKKind.Metadata || event.pubkey !== pubkey) continue;
        let profile: NDKUserProfile;
        // A profile whose content is not valid JSON is passed over.
        try { profile = profileFromEvent(event); } catch { continue; }
        if (!newerEvent({ created_at: profile.created_at, id: event.id }, newest && { created_at: newest.profile.created_at, id: newest.id })) continue;
        newest = { profile, id: event.id };
        // Said as each relay answers, newest so far: one relay that never
        // answers must not hold the profile back for its whole time limit.
        opts.onFound?.(profile);
      }
      return { answered, builtIn: builtIn(relay.url) };
    }),
  );
  const network = answers.filter((a) => !a.builtIn);
  const got = newest as Newest | null;
  if (got) return { status: "found", profile: got.profile, fromNetwork: network.some((a) => a.answered) };

  // The built-in relay answers at once with the network gone: its copy of a
  // profile counts above, and its silence proves nothing here.
  if (network.length > 0 && network.every((a) => a.answered)) return { status: "none" };
  return { status: "unknown" };
}

/**
 * Fetch kind 0 profiles for many pubkeys in one subscription per chunk, instead
 * of one subscription per author. Newest kind 0 per pubkey wins. A pubkey
 * missing from the result means no relay in the pool returned a profile within
 * the timeout — usually "has none", occasionally "relays were slow".
 */
export async function fetchProfiles(pubkeys: string[]): Promise<Map<string, NDKUserProfile>> {
  const instance = getNDK();
  const unique = Array.from(new Set(pubkeys));
  const result = new Map<string, NDKUserProfile>();
  const newest = new Map<string, number>();
  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const authors = unique.slice(i, i + CHUNK);
    const filter: NDKFilter = { kinds: [NDKKind.Metadata], authors };
    const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
    for (const ev of events) {
      const ts = ev.created_at ?? 0;
      if ((newest.get(ev.pubkey) ?? -1) >= ts) continue;
      try {
        result.set(ev.pubkey, profileFromEvent(ev));
        newest.set(ev.pubkey, ts);
      } catch {
        // malformed kind 0 content — treat as no profile
      }
    }
  }
  return result;
}

export async function fetchFollowSuggestions(myFollows: string[]): Promise<{ pubkey: string; mutualCount: number }[]> {
  if (myFollows.length === 0) return [];
  const instance = getNDK();
  // Fetch contact lists (kind 3) from our follows
  const batchSize = 20;
  const allContactEvents: NDKEvent[] = [];
  for (let i = 0; i < myFollows.length; i += batchSize) {
    const batch = myFollows.slice(i, i + batchSize);
    const filter: NDKFilter = { kinds: [3 as NDKKind], authors: batch, limit: batch.length };
    const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
    allContactEvents.push(...Array.from(events));
  }

  // Count how many of our follows follow each pubkey
  const myFollowSet = new Set(myFollows);
  const counts = new Map<string, number>();
  for (const event of allContactEvents) {
    const pubkeys = event.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
    for (const pk of pubkeys) {
      if (myFollowSet.has(pk)) continue; // already following
      counts.set(pk, (counts.get(pk) ?? 0) + 1);
    }
  }

  // Remove self
  const myPubkey = (await instance.signer?.user())?.pubkey;
  if (myPubkey) counts.delete(myPubkey);

  return Array.from(counts.entries())
    .map(([pubkey, mutualCount]) => ({ pubkey, mutualCount }))
    .sort((a, b) => b.mutualCount - a.mutualCount)
    .slice(0, 30);
}

export async function fetchMentions(pubkey: string, since: number, limit = 50): Promise<NDKEvent[]> {
  const instance = getNDK();
  // Use a longer timeout for #p queries — some relays are slow to index tag lookups
  const events = await fetchWithTimeout(
    instance,
    { kinds: [NDKKind.Text], "#p": [pubkey], since, limit },
    12000,
  );
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchFollowers(pubkey: string, limit = 200): Promise<string[]> {
  const instance = getNDK();
  // #p queries on kind 3 are slow on most relays — give them extra time
  const events = await fetchWithTimeout(
    instance,
    { kinds: [3 as NDKKind], "#p": [pubkey], limit },
    15000,
  );
  const followerPubkeys = new Set<string>();
  for (const e of events) {
    if (e.pubkey !== pubkey) followerPubkeys.add(e.pubkey);
  }
  return Array.from(followerPubkeys);
}

export async function fetchNewFollowers(pubkey: string, since: number, limit = 20): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = {
    kinds: [3 as NDKKind],
    "#p": [pubkey],
    since,
    limit,
  };
  const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}
