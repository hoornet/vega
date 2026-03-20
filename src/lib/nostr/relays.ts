import { NDKEvent, NDKFilter, NDKKind, NDKSubscriptionCacheUsage } from "@nostr-dev-kit/ndk";
import { getNDK } from "./core";

export interface UserRelayList { read: string[]; write: string[]; }

export async function fetchUserRelayList(pubkey: string): Promise<UserRelayList> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [10002 as NDKKind], authors: [pubkey], limit: 1 };
  const events = await instance.fetchEvents(filter, { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY });
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
