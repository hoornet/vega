import { NDKEvent, NDKFilter, NDKKind, NDKSubscriptionCacheUsage } from "@nostr-dev-kit/ndk";
import { getNDK } from "./core";

export async function fetchTrendingCandidates(limit = 200, sinceHours = 24): Promise<NDKEvent[]> {
  const instance = getNDK();
  const since = Math.floor(Date.now() / 1000) - sinceHours * 3600;
  const filter: NDKFilter = {
    kinds: [NDKKind.Text, 30023 as NDKKind],
    since,
    limit,
  };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchTrendingHashtags(limit = 15): Promise<{ tag: string; count: number }[]> {
  const instance = getNDK();
  const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const filter: NDKFilter = {
    kinds: [NDKKind.Text],
    since,
    limit: 500,
  };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });

  const counts = new Map<string, number>();
  for (const event of events) {
    for (const tag of event.tags) {
      if (tag[0] !== "t" || !tag[1]) continue;
      const normalized = tag[1].toLowerCase().trim();
      if (normalized.length === 0) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
