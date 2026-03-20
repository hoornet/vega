import { NDKEvent, NDKFilter, NDKKind, NDKSubscriptionCacheUsage } from "@nostr-dev-kit/ndk";
import { getNDK } from "./core";

export async function publishReaction(eventId: string, eventPubkey: string, reaction = "+"): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = NDKKind.Reaction;
  event.content = reaction;
  event.tags = [
    ["e", eventId],
    ["p", eventPubkey],
  ];
  await event.publish();
}

export async function fetchReactionCount(eventId: string): Promise<number> {
  const instance = getNDK();
  const filter: NDKFilter = {
    kinds: [NDKKind.Reaction],
    "#e": [eventId],
  };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return events.size;
}

export async function fetchReplyCount(eventId: string): Promise<number> {
  const instance = getNDK();
  const filter: NDKFilter = {
    kinds: [NDKKind.Text],
    "#e": [eventId],
  };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return events.size;
}

export async function fetchZapCount(eventId: string): Promise<{ count: number; totalSats: number }> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Zap], "#e": [eventId] };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  let totalSats = 0;
  for (const event of events) {
    const desc = event.tags.find((t) => t[0] === "description")?.[1];
    if (desc) {
      try {
        const zapReq = JSON.parse(desc) as { tags?: string[][] };
        const amountTag = zapReq.tags?.find((t) => t[0] === "amount");
        if (amountTag?.[1]) totalSats += Math.round(parseInt(amountTag[1]) / 1000);
      } catch { /* malformed */ }
    }
  }
  return { count: events.size, totalSats };
}

export async function fetchBatchEngagement(eventIds: string[]): Promise<Map<string, { reactions: number; replies: number; zapSats: number }>> {
  const instance = getNDK();
  const result = new Map<string, { reactions: number; replies: number; zapSats: number }>();
  for (const id of eventIds) {
    result.set(id, { reactions: 0, replies: 0, zapSats: 0 });
  }

  // Batch in chunks to avoid oversized filters
  const chunkSize = 50;
  for (let i = 0; i < eventIds.length; i += chunkSize) {
    const chunk = eventIds.slice(i, i + chunkSize);

    const [reactions, replies, zaps] = await Promise.all([
      instance.fetchEvents(
        { kinds: [NDKKind.Reaction], "#e": chunk },
        { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
      ),
      instance.fetchEvents(
        { kinds: [NDKKind.Text], "#e": chunk },
        { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
      ),
      instance.fetchEvents(
        { kinds: [NDKKind.Zap], "#e": chunk },
        { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
      ),
    ]);

    for (const event of reactions) {
      const eTag = event.tags.find((t) => t[0] === "e")?.[1];
      if (eTag && result.has(eTag)) result.get(eTag)!.reactions++;
    }

    for (const event of replies) {
      const eTag = event.tags.find((t) => t[0] === "e")?.[1];
      if (eTag && result.has(eTag)) result.get(eTag)!.replies++;
    }

    for (const event of zaps) {
      const eTag = event.tags.find((t) => t[0] === "e")?.[1];
      if (eTag && result.has(eTag)) {
        const desc = event.tags.find((t) => t[0] === "description")?.[1];
        if (desc) {
          try {
            const zapReq = JSON.parse(desc) as { tags?: string[][] };
            const amountTag = zapReq.tags?.find((t) => t[0] === "amount");
            if (amountTag?.[1]) result.get(eTag)!.zapSats += Math.round(parseInt(amountTag[1]) / 1000);
          } catch { /* malformed */ }
        }
      }
    }
  }

  return result;
}

export async function fetchZapsReceived(pubkey: string, limit = 50): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Zap], "#p": [pubkey], limit };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchZapsSent(pubkey: string, limit = 50): Promise<NDKEvent[]> {
  const instance = getNDK();
  // Zap receipts (kind 9735) with uppercase P tag = the sender's pubkey
  const filter: NDKFilter = { kinds: [NDKKind.Zap], "#P": [pubkey], limit };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}
