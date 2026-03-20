import { NDKEvent, NDKFilter, NDKKind, NDKSubscriptionCacheUsage } from "@nostr-dev-kit/ndk";
import { getNDK } from "./core";

export async function fetchMuteList(pubkey: string): Promise<string[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [10000 as NDKKind], authors: [pubkey], limit: 1 };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  if (events.size === 0) return [];
  const event = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  return event.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
}

export async function publishMuteList(pubkeys: string[]): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) return;
  const event = new NDKEvent(instance);
  event.kind = 10000 as NDKKind;
  event.content = "";
  event.tags = pubkeys.map((pk) => ["p", pk]);
  await event.publish();
}
