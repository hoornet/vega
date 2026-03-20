import { NDKEvent, NDKFilter, NDKKind, NDKRelaySet, NDKSubscriptionCacheUsage, nip19 } from "@nostr-dev-kit/ndk";
import { getNDK, getStoredRelayUrls } from "./core";
import { fetchUserRelayList } from "./relays";

export async function fetchGlobalFeed(limit: number = 50): Promise<NDKEvent[]> {
  const instance = getNDK();

  const filter: NDKFilter = {
    kinds: [NDKKind.Text],
    limit,
  };

  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });

  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchFollowFeed(pubkeys: string[], limit = 80): Promise<NDKEvent[]> {
  if (pubkeys.length === 0) return [];
  const instance = getNDK();

  const filter: NDKFilter = {
    kinds: [NDKKind.Text],
    authors: pubkeys,
    limit,
  };

  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });

  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchUserNotes(pubkey: string, limit = 30): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = {
    kinds: [NDKKind.Text],
    authors: [pubkey],
    limit,
  };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchUserNotesNIP65(pubkey: string, limit = 30): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Text], authors: [pubkey], limit };
  try {
    const relayList = await fetchUserRelayList(pubkey);
    if (relayList.write.length > 0) {
      const merged = Array.from(new Set([...relayList.write, ...getStoredRelayUrls()]));
      const relaySet = NDKRelaySet.fromRelayUrls(merged, instance);
      const events = await instance.fetchEvents(filter, { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }, relaySet);
      return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    }
  } catch { /* fallthrough */ }
  return fetchUserNotes(pubkey, limit);
}

export async function fetchNoteById(eventId: string): Promise<NDKEvent | null> {
  const instance = getNDK();
  const filter: NDKFilter = { ids: [eventId], limit: 1 };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events)[0] ?? null;
}

export async function fetchReplies(eventId: string): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = {
    kinds: [NDKKind.Text],
    "#e": [eventId],
  };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
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

export async function publishReply(content: string, replyTo: { id: string; pubkey: string }): Promise<NDKEvent> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = NDKKind.Text;
  event.content = content;
  event.tags = [
    ["e", replyTo.id, "", "reply"],
    ["p", replyTo.pubkey],
  ];
  await event.publish();
  return event;
}

export async function publishRepost(event: NDKEvent): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const repost = new NDKEvent(instance);
  repost.kind = NDKKind.Repost; // kind 6
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

export async function fetchHashtagFeed(tag: string, limit = 100): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = {
    kinds: [NDKKind.Text],
    "#t": [tag.toLowerCase()],
    limit,
  };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}
