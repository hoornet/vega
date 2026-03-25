import { NDKEvent, NDKFilter, NDKKind } from "@nostr-dev-kit/ndk";
import { getNDK, fetchWithTimeout, FEED_TIMEOUT } from "./core";

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
  await event.publish();
}

export async function publishContactList(pubkeys: string[]): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = 3;
  event.content = "";
  event.tags = pubkeys.map((pk) => ["p", pk]);
  await event.publish();
}

export async function fetchProfile(pubkey: string) {
  const instance = getNDK();
  const user = instance.getUser({ pubkey });
  await user.fetchProfile();
  return user.profile;
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
  const events = await fetchWithTimeout(
    instance,
    { kinds: [NDKKind.Text], "#p": [pubkey], since, limit },
    FEED_TIMEOUT,
  );
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchFollowers(pubkey: string, limit = 200): Promise<string[]> {
  const instance = getNDK();
  const events = await fetchWithTimeout(
    instance,
    { kinds: [3 as NDKKind], "#p": [pubkey], limit },
    FEED_TIMEOUT,
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
