import { NDKEvent, NDKFilter, NDKKind } from "@nostr-dev-kit/ndk";
import { getNDK, fetchWithTimeout, withTimeout, FEED_TIMEOUT, SINGLE_TIMEOUT, publishToNetwork } from "./core";

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
  await publishToNetwork(event);
}


export interface GroupedReactions {
  groups: Map<string, number>;
  myReactions: Set<string>;
  total: number;
}

/** Normalize reaction content: "+" and empty → "❤️", ignore "-" */
function normalizeEmoji(content: string): string | null {
  if (content === "-") return null; // downvote — ignore
  if (!content || content === "+") return "❤️";
  return content;
}

// A zap's outer event.pubkey is the wallet/LNURL service; the real zapper is
// the pubkey inside the embedded zap request. Returns null if malformed.
function getZapperPubkey(event: NDKEvent): string | null {
  const desc = event.tags.find((t) => t[0] === "description")?.[1];
  if (!desc) return null;
  try {
    const zapReq = JSON.parse(desc) as { pubkey?: string };
    return typeof zapReq.pubkey === "string" ? zapReq.pubkey : null;
  } catch {
    return null;
  }
}

function getZapAmountSats(event: NDKEvent): number {
  const desc = event.tags.find((t) => t[0] === "description")?.[1];
  if (!desc) return 0;
  try {
    const zapReq = JSON.parse(desc) as { tags?: string[][] };
    const amountTag = zapReq.tags?.find((t) => t[0] === "amount");
    if (amountTag?.[1]) return Math.round(parseInt(amountTag[1]) / 1000);
  } catch { /* malformed */ }
  return 0;
}

/**
 * Group reaction events by emoji. Pass myPubkey to track which emojis the user
 * sent. Pass wotSet to only count reactions from pubkeys in the set.
 */
export function groupReactions(
  events: Iterable<NDKEvent>,
  myPubkey?: string,
  wotSet?: Set<string>,
): GroupedReactions {
  const groups = new Map<string, number>();
  const myReactions = new Set<string>();
  let total = 0;

  for (const event of events) {
    const emoji = normalizeEmoji(event.content);
    if (!emoji) continue;
    if (wotSet && !wotSet.has(event.pubkey)) continue;
    groups.set(emoji, (groups.get(emoji) ?? 0) + 1);
    total++;
    if (myPubkey && event.pubkey === myPubkey) {
      myReactions.add(emoji);
    }
  }

  return { groups, myReactions, total };
}

export async function fetchReactions(eventId: string, myPubkey?: string, wotSet?: Set<string>): Promise<GroupedReactions> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Reaction], "#e": [eventId] };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  return groupReactions(events, myPubkey, wotSet);
}

export async function fetchReplyCount(eventId: string): Promise<number> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Text], "#e": [eventId] };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  return events.size;
}

export async function fetchZapCount(eventId: string, wotSet?: Set<string>): Promise<{ count: number; totalSats: number }> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Zap], "#e": [eventId] };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  let totalSats = 0;
  let count = 0;
  for (const event of events) {
    if (wotSet) {
      const zapper = getZapperPubkey(event);
      if (!zapper || !wotSet.has(zapper)) continue;
    }
    totalSats += getZapAmountSats(event);
    count++;
  }
  return { count, totalSats };
}

export interface BatchEngagement {
  reactions: number;
  replies: number;
  zapSats: number;
  reactionGroups: Map<string, number>;
  myReactions: Set<string>;
}

export async function fetchBatchEngagement(eventIds: string[], myPubkey?: string, wotSet?: Set<string>): Promise<Map<string, BatchEngagement>> {
  const instance = getNDK();
  const result = new Map<string, BatchEngagement>();
  for (const id of eventIds) {
    result.set(id, { reactions: 0, replies: 0, zapSats: 0, reactionGroups: new Map(), myReactions: new Set() });
  }

  // Batch in chunks to avoid oversized filters
  const chunkSize = 50;
  for (let i = 0; i < eventIds.length; i += chunkSize) {
    const chunk = eventIds.slice(i, i + chunkSize);

    const [reactions, replies, zaps] = await withTimeout(
      Promise.all([
        fetchWithTimeout(instance, { kinds: [NDKKind.Reaction], "#e": chunk }, FEED_TIMEOUT),
        fetchWithTimeout(instance, { kinds: [NDKKind.Text], "#e": chunk }, FEED_TIMEOUT),
        fetchWithTimeout(instance, { kinds: [NDKKind.Zap], "#e": chunk }, FEED_TIMEOUT),
      ]),
      FEED_TIMEOUT + 2000,
      [new Set<NDKEvent>(), new Set<NDKEvent>(), new Set<NDKEvent>()],
    );

    for (const event of reactions) {
      if (wotSet && !wotSet.has(event.pubkey)) continue;
      const eTag = event.tags.find((t) => t[0] === "e")?.[1];
      if (eTag && result.has(eTag)) {
        const entry = result.get(eTag)!;
        const emoji = normalizeEmoji(event.content);
        if (emoji) {
          entry.reactions++;
          entry.reactionGroups.set(emoji, (entry.reactionGroups.get(emoji) ?? 0) + 1);
          if (myPubkey && event.pubkey === myPubkey) {
            entry.myReactions.add(emoji);
          }
        }
      }
    }

    for (const event of replies) {
      if (wotSet && !wotSet.has(event.pubkey)) continue;
      const eTag = event.tags.find((t) => t[0] === "e")?.[1];
      if (eTag && result.has(eTag)) result.get(eTag)!.replies++;
    }

    for (const event of zaps) {
      if (wotSet) {
        const zapper = getZapperPubkey(event);
        if (!zapper || !wotSet.has(zapper)) continue;
      }
      const eTag = event.tags.find((t) => t[0] === "e")?.[1];
      if (eTag && result.has(eTag)) {
        result.get(eTag)!.zapSats += getZapAmountSats(event);
      }
    }
  }

  return result;
}

export async function fetchZapsReceived(pubkey: string, limit = 50, since?: number): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Zap], "#p": [pubkey], limit, ...(since !== undefined ? { since } : {}) };
  // Zap queries can be slow — give relays more time
  const events = await fetchWithTimeout(instance, filter, 12000);
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchZapsSent(pubkey: string, limit = 50): Promise<NDKEvent[]> {
  const instance = getNDK();
  // #P (uppercase) is poorly supported; also try finding zap requests we authored
  const filter: NDKFilter = { kinds: [NDKKind.Zap], "#P": [pubkey], limit };
  const events = await fetchWithTimeout(instance, filter, 12000);
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}
