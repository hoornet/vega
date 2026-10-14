import { NDKEvent, NDKFilter, NDKKind, NDKUserProfile, profileFromEvent } from "@nostr-dev-kit/ndk";
import { fetchReplaceableList, relaysToAsk } from "./lists";
export { relaysToAsk };
import { getNDK, fetchWithTimeout, FEED_TIMEOUT, publishToNetwork } from "./core";
import {
  type ContactListResult,
  type ContactListSnapshot,
} from "../contacts";

export async function publishProfile(fields: {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
}): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = 0;
  event.content = JSON.stringify(fields);
  await publishToNetwork(event);
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
  await user.fetchProfile();
  return user.profile ?? null;
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
