import { NDKEvent, NDKFilter, NDKKind, NDKRelaySet, nip19 } from "@nostr-dev-kit/ndk";
import { getNDK, getStoredRelayUrls, fetchWithTimeout, withTimeout, FEED_TIMEOUT, THREAD_TIMEOUT, SINGLE_TIMEOUT } from "./core";
import { fetchUserRelayList } from "./relays";

export async function fetchGlobalFeed(limit: number = 50): Promise<NDKEvent[]> {
  const instance = getNDK();
  // Ask for notes from the last 2 hours to ensure freshness
  const since = Math.floor(Date.now() / 1000) - 2 * 3600;
  const filter: NDKFilter = { kinds: [NDKKind.Text, 1068 as NDKKind], limit, since };
  const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchMediaFeed(limit: number = 500): Promise<NDKEvent[]> {
  const instance = getNDK();
  // Wider window (24h) since media notes are sparse among text notes
  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  const filter: NDKFilter = { kinds: [NDKKind.Text], limit, since };
  const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchFollowFeed(pubkeys: string[], limit = 30): Promise<NDKEvent[]> {
  if (pubkeys.length === 0) return [];
  const instance = getNDK();
  const since = Math.floor(Date.now() / 1000) - 24 * 3600; // last 24h for follows
  const filter: NDKFilter = { kinds: [NDKKind.Text, 1068 as NDKKind], authors: pubkeys, limit, since };
  const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchUserNotes(pubkey: string, limit = 30): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Text, 1068 as NDKKind], authors: [pubkey], limit };
  const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchUserNotesNIP65(pubkey: string, limit = 30): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Text, 1068 as NDKKind], authors: [pubkey], limit };
  try {
    const relayList = await withTimeout(fetchUserRelayList(pubkey), SINGLE_TIMEOUT, { read: [], write: [] });
    if (relayList.write.length > 0) {
      const merged = Array.from(new Set([...relayList.write, ...getStoredRelayUrls()]));
      const relaySet = NDKRelaySet.fromRelayUrls(merged, instance);
      const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT, relaySet);
      return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    }
  } catch { /* fallthrough */ }
  return fetchUserNotes(pubkey, limit);
}

export async function fetchNoteById(eventId: string): Promise<NDKEvent | null> {
  const instance = getNDK();
  const filter: NDKFilter = { ids: [eventId], limit: 1 };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  return Array.from(events)[0] ?? null;
}

export async function fetchReplies(eventId: string): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Text], "#e": [eventId] };
  const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
  return Array.from(events).sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

export async function publishNote(content: string): Promise<NDKEvent> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = NDKKind.Text;
  event.content = content;
  await event.publish();
  return event;
}

export async function publishReply(
  content: string,
  replyTo: { id: string; pubkey: string },
  rootEvent?: { id: string; pubkey: string },
): Promise<NDKEvent> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = NDKKind.Text;
  event.content = content;

  if (rootEvent && rootEvent.id !== replyTo.id) {
    const pTags = new Set([rootEvent.pubkey, replyTo.pubkey]);
    event.tags = [
      ["e", rootEvent.id, "", "root"],
      ["e", replyTo.id, "", "reply"],
      ...Array.from(pTags).map((p) => ["p", p]),
    ];
  } else {
    event.tags = [
      ["e", replyTo.id, "", "root"],
      ["p", replyTo.pubkey],
    ];
  }
  await event.publish();
  return event;
}

export async function publishRepost(event: NDKEvent): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const repost = new NDKEvent(instance);
  repost.kind = NDKKind.Repost;
  repost.content = JSON.stringify(event.rawEvent());
  repost.tags = [
    ["e", event.id!, "", "mention"],
    ["p", event.pubkey],
  ];
  await repost.publish();
}

export async function publishQuote(content: string, quotedEvent: NDKEvent): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const nevent = nip19.neventEncode({ id: quotedEvent.id!, author: quotedEvent.pubkey });
  const fullContent = content.trim() + "\n\nnostr:" + nevent;

  const note = new NDKEvent(instance);
  note.kind = NDKKind.Text;
  note.content = fullContent;
  note.tags = [
    ["q", quotedEvent.id!, ""],
    ["p", quotedEvent.pubkey],
  ];
  await note.publish();
}

const THREAD_EVENT_LIMIT = 300; // hard cap to prevent OOM on viral threads

export async function fetchThreadEvents(rootId: string): Promise<NDKEvent[]> {
  const instance = getNDK();

  // Round-trip 1: all events tagging the root (capped)
  const directFilter: NDKFilter = { kinds: [NDKKind.Text], "#e": [rootId], limit: THREAD_EVENT_LIMIT };
  const directEvents = await fetchWithTimeout(instance, directFilter, THREAD_TIMEOUT);

  const allEvents = new Map<string, NDKEvent>();
  // Hard-truncate: relays often ignore `limit` on #e filters, so we enforce it client-side
  for (const e of [...directEvents].slice(0, THREAD_EVENT_LIMIT)) allEvents.set(e.id, e);

  // Round-trip 2: only attempt if round 1 was small (skip entirely on big threads)
  if (allEvents.size < 50) {
    const knownIds = Array.from(allEvents.keys());
    if (knownIds.length > 0) {
      const deepFilter: NDKFilter = { kinds: [NDKKind.Text], "#e": knownIds, limit: THREAD_EVENT_LIMIT };
      const deepEvents = await fetchWithTimeout(instance, deepFilter, THREAD_TIMEOUT);
      for (const e of [...deepEvents].slice(0, THREAD_EVENT_LIMIT - allEvents.size)) allEvents.set(e.id, e);
    }
  }

  return Array.from(allEvents.values());
}

const ANCESTOR_TIMEOUT = 2000; // 2s per parent — fail fast

export async function fetchAncestors(event: NDKEvent, maxDepth = 5): Promise<NDKEvent[]> {
  const ancestors: NDKEvent[] = [];
  let current = event;

  for (let i = 0; i < maxDepth; i++) {
    const eTags = current.tags.filter((t) => t[0] === "e");
    if (eTags.length === 0) break;

    const parentId =
      eTags.find((t) => t[3] === "reply")?.[1] ??
      eTags.find((t) => t[3] === "root")?.[1] ??
      eTags[eTags.length - 1][1];

    if (!parentId) break;
    const instance = getNDK();
    const filter: NDKFilter = { ids: [parentId], limit: 1 };
    const events = await fetchWithTimeout(instance, filter, ANCESTOR_TIMEOUT);
    const parent = Array.from(events)[0] ?? null;
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }

  return ancestors;
}

export async function fetchHashtagFeed(tag: string, limit = 100): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Text], "#t": [tag.toLowerCase()], limit };
  const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}
