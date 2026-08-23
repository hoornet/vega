import { NDKEvent, NDKFilter, NDKKind } from "@nostr-dev-kit/ndk";
import { getNDK, fetchWithTimeout, SINGLE_TIMEOUT } from "./core";

export interface UserRelayList { read: string[]; write: string[]; }

export async function fetchUserRelayList(pubkey: string): Promise<UserRelayList> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [10002 as NDKKind], authors: [pubkey], limit: 1 };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  if (events.size === 0) return { read: [], write: [] };
  const event = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  const read: string[] = [], write: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "r" || !tag[1]) continue;
    const marker = tag[2];
    if (!marker || marker === "read") read.push(tag[1]);
    if (!marker || marker === "write") write.push(tag[1]);
  }
  return { read, write };
}

/**
 * Bound on how many relays we honour from one kind 10050.
 *
 * NIP-17 expects "one to three" DM relays; anyone we message controls their own
 * list, so an unbounded read would let a hostile 10050 point a DM send at
 * dozens of relays of their choosing. Four keeps a margin over the spec's
 * expectation without handing out that lever.
 */
const MAX_DM_RELAYS = 4;

/**
 * A user's published NIP-17 DM relay list (kind 10050), newest event wins.
 *
 * Tag shape differs from 10002: `["relay", url]`, no read/write markers.
 * Returns [] when none is published — the caller falls back to the pool, which
 * is the pre-#49 behaviour.
 */
export async function fetchUserDMRelayList(pubkey: string): Promise<string[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [10050 as NDKKind], authors: [pubkey], limit: 1 };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  if (events.size === 0) return [];
  const event = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  const urls = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== "relay" || !tag[1]) continue;
    // Only websocket URLs: these strings come off the wire and go straight into
    // relay connections.
    if (!/^wss?:\/\//i.test(tag[1])) continue;
    urls.add(tag[1]);
    if (urls.size >= MAX_DM_RELAYS) break;
  }
  return Array.from(urls);
}

export async function publishRelayList(relayUrls: string[]): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");
  const event = new NDKEvent(instance);
  event.kind = 10002 as NDKKind;
  event.content = "";
  event.tags = relayUrls.map((url) => ["r", url]);
  await event.publish();
}

export async function fetchRelayRecommendations(
  follows: string[],
  ownRelays: string[],
  sampleSize = 30
): Promise<{ url: string; count: number }[]> {
  if (follows.length === 0) return [];
  // Sample random follows to avoid hammering relays
  const shuffled = [...follows].sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, sampleSize);

  const results = await Promise.allSettled(
    sample.map((pk) => fetchUserRelayList(pk))
  );

  const ownSet = new Set(ownRelays.map((u) => u.replace(/\/$/, "")));
  const tally = new Map<string, number>();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const allUrls = Array.from(new Set([...result.value.read, ...result.value.write]));
    for (const url of allUrls) {
      const normalized = url.replace(/\/$/, "");
      if (ownSet.has(normalized)) continue;
      tally.set(normalized, (tally.get(normalized) ?? 0) + 1);
    }
  }

  return Array.from(tally.entries())
    .map(([url, count]) => ({ url, count }))
    .filter((r) => r.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}
