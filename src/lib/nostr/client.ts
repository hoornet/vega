import NDK, { NDKEvent, NDKFilter, NDKKind, NDKRelay, NDKRelaySet, NDKSubscriptionCacheUsage, NDKUser, nip19, giftWrap, giftUnwrap } from "@nostr-dev-kit/ndk";
import { type ParsedSearch, matchesHasFilter } from "../search";

const RELAY_STORAGE_KEY = "wrystr_relays";

const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
];

export function getStoredRelayUrls(): string[] {
  try {
    const stored = localStorage.getItem(RELAY_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return FALLBACK_RELAYS;
}

function saveRelayUrls(urls: string[]) {
  localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify(urls));
}

let ndk: NDK | null = null;

export function getNDK(): NDK {
  if (!ndk) {
    ndk = new NDK({
      explicitRelayUrls: getStoredRelayUrls(),
    });
  }
  return ndk;
}

export function addRelay(url: string): void {
  const instance = getNDK();
  const urls = getStoredRelayUrls();
  if (!urls.includes(url)) {
    saveRelayUrls([...urls, url]);
  }
  if (!instance.pool?.relays.has(url)) {
    const relay = new NDKRelay(url, undefined, instance);
    instance.pool?.addRelay(relay, true);
  }
}

export function removeRelay(url: string): void {
  const instance = getNDK();
  const relay = instance.pool?.relays.get(url);
  if (relay) {
    relay.disconnect();
    instance.pool?.relays.delete(url);
  }
  saveRelayUrls(getStoredRelayUrls().filter((u) => u !== url));
}

function waitForConnectedRelay(instance: NDK, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, _reject) => {
    const timer = setTimeout(() => {
      // Even on timeout, continue — some relays may connect later
      console.warn("Relay connection timeout, continuing anyway");
      resolve();
    }, timeoutMs);

    const check = () => {
      const relays = Array.from(instance.pool?.relays?.values() ?? []);
      const hasConnected = relays.some((r) => r.connected);
      if (hasConnected) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  });
}

export async function connectToRelays(): Promise<void> {
  const instance = getNDK();
  await instance.connect();
  await waitForConnectedRelay(instance);
}

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

export async function publishArticle(opts: {
  title: string;
  content: string;
  summary?: string;
  image?: string;
  tags?: string[];
}): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const slug = opts.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) + "-" + Date.now();

  const event = new NDKEvent(instance);
  event.kind = 30023;
  event.content = opts.content;
  event.tags = [
    ["d", slug],
    ["title", opts.title],
    ["published_at", String(Math.floor(Date.now() / 1000))],
  ];
  if (opts.summary) event.tags.push(["summary", opts.summary]);
  if (opts.image) event.tags.push(["image", opts.image]);
  if (opts.tags) opts.tags.forEach((t) => event.tags.push(["t", t]));

  await event.publish();
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

export async function publishNote(content: string): Promise<NDKEvent> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = NDKKind.Text;
  event.content = content;
  await event.publish();
  return event;
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

export async function searchNotes(query: string, limit = 50): Promise<NDKEvent[]> {
  const instance = getNDK();
  const isHashtag = query.startsWith("#");
  const filter: NDKFilter & { search?: string } = isHashtag
    ? { kinds: [NDKKind.Text], "#t": [query.slice(1).toLowerCase()], limit }
    : { kinds: [NDKKind.Text], search: query, limit };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function searchUsers(query: string, limit = 20): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter & { search?: string } = {
    kinds: [NDKKind.Metadata],
    search: query,
    limit,
  };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events);
}

export async function fetchNoteById(eventId: string): Promise<NDKEvent | null> {
  const instance = getNDK();
  const filter: NDKFilter = { ids: [eventId], limit: 1 };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events)[0] ?? null;
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

export async function publishContactList(pubkeys: string[]): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = 3;
  event.content = "";
  event.tags = pubkeys.map((pk) => ["p", pk]);
  await event.publish();
}

// ── Direct Messages (NIP-17 gift-wrap + NIP-04 legacy) ───────────────────────

async function unwrapGiftWraps(events: NDKEvent[]): Promise<NDKEvent[]> {
  const instance = getNDK();
  if (!instance.signer) return [];
  const rumors: NDKEvent[] = [];
  for (const wrap of events) {
    try {
      const rumor = await giftUnwrap(wrap, undefined, instance.signer);
      if (rumor && rumor.kind === NDKKind.PrivateDirectMessage) {
        // Preserve wrapper ID for dedup, but use rumor's created_at for ordering
        rumors.push(rumor);
      }
    } catch {
      // Not for us or corrupted — skip silently
    }
  }
  return rumors;
}

export async function fetchDMConversations(myPubkey: string): Promise<NDKEvent[]> {
  const instance = getNDK();
  // Fetch NIP-04 (legacy) and NIP-17 (gift-wrap) in parallel
  const [nip04Received, nip04Sent, giftWraps] = await Promise.all([
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], "#p": [myPubkey], limit: 500 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], authors: [myPubkey], limit: 500 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    instance.fetchEvents(
      { kinds: [NDKKind.GiftWrap], "#p": [myPubkey], limit: 500 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
  ]);

  const nip17Rumors = await unwrapGiftWraps(Array.from(giftWraps));

  const seen = new Set<string>();
  return [...Array.from(nip04Received), ...Array.from(nip04Sent), ...nip17Rumors]
    .filter((e) => { if (seen.has(e.id!)) return false; seen.add(e.id!); return true; })
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchDMThread(myPubkey: string, theirPubkey: string): Promise<NDKEvent[]> {
  const instance = getNDK();
  // Fetch NIP-04 and NIP-17 in parallel
  const [fromThem, fromMe, giftWraps] = await Promise.all([
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], "#p": [myPubkey], authors: [theirPubkey], limit: 200 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], "#p": [theirPubkey], authors: [myPubkey], limit: 200 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    instance.fetchEvents(
      { kinds: [NDKKind.GiftWrap], "#p": [myPubkey], limit: 200 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
  ]);

  // Unwrap NIP-17 and filter to only messages from/to this partner
  const allRumors = await unwrapGiftWraps(Array.from(giftWraps));
  const partnerRumors = allRumors.filter((r) => {
    const pTag = r.tags.find((t) => t[0] === "p")?.[1];
    return r.pubkey === theirPubkey || pTag === theirPubkey;
  });

  return [...Array.from(fromThem), ...Array.from(fromMe), ...partnerRumors]
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

export async function sendDM(recipientPubkey: string, content: string): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const myUser = await instance.signer.user();
  const recipient = instance.getUser({ pubkey: recipientPubkey });

  // Create unsigned rumor (kind 14)
  const rumor = new NDKEvent(instance);
  rumor.kind = NDKKind.PrivateDirectMessage;
  rumor.content = content;
  rumor.tags = [["p", recipientPubkey]];
  rumor.pubkey = myUser.pubkey;
  rumor.created_at = Math.floor(Date.now() / 1000);

  // Gift-wrap to recipient and self (so sent messages appear in our inbox)
  const [wrappedForRecipient, wrappedForSelf] = await Promise.all([
    giftWrap(rumor, recipient, instance.signer),
    giftWrap(rumor, myUser, instance.signer),
  ]);

  await Promise.all([
    wrappedForRecipient.publish(),
    wrappedForSelf.publish(),
  ]);
}

export async function decryptDM(event: NDKEvent, myPubkey: string): Promise<string> {
  // Kind 14 (NIP-17 rumor) — content is already plaintext after unwrapping
  if (event.kind === NDKKind.PrivateDirectMessage) {
    return event.content;
  }

  // Kind 4 (NIP-04 legacy) — decrypt as before
  const instance = getNDK();
  if (!instance.signer) throw new Error("No signer");
  const otherPubkey =
    event.pubkey === myPubkey
      ? (event.tags.find((t) => t[0] === "p")?.[1] ?? "")
      : event.pubkey;
  const otherUser = instance.getUser({ pubkey: otherPubkey });
  return instance.signer.decrypt(otherUser, event.content, "nip04");
}

export async function fetchArticle(naddr: string): Promise<NDKEvent | null> {
  const instance = getNDK();
  try {
    const decoded = nip19.decode(naddr);
    if (decoded.type !== "naddr") return null;
    const { identifier, pubkey, kind } = decoded.data;
    const filter: NDKFilter = {
      kinds: [kind as NDKKind],
      authors: [pubkey],
      "#d": [identifier],
      limit: 1,
    };
    const events = await instance.fetchEvents(filter, {
      cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
    });
    return Array.from(events)[0] ?? null;
  } catch {
    return null;
  }
}

export async function fetchAuthorArticles(pubkey: string, limit = 20): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Article], authors: [pubkey], limit };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchArticleFeed(limit = 40, authors?: string[]): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Article], limit };
  if (authors && authors.length > 0) filter.authors = authors;
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function searchArticles(query: string, limit = 30): Promise<NDKEvent[]> {
  const instance = getNDK();
  const isHashtag = query.startsWith("#");
  const filter: NDKFilter & { search?: string } = isHashtag
    ? { kinds: [NDKKind.Article], "#t": [query.slice(1).toLowerCase()], limit }
    : { kinds: [NDKKind.Article], search: query, limit };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
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

// ── Bookmarks (NIP-51 kind 10003) ────────────────────────────────────────────

export async function fetchBookmarkList(pubkey: string): Promise<string[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [10003 as NDKKind], authors: [pubkey], limit: 1 };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  if (events.size === 0) return [];
  const event = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  return event.tags.filter((t) => t[0] === "e" && t[1]).map((t) => t[1]);
}

export async function publishBookmarkList(eventIds: string[]): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) return;
  const event = new NDKEvent(instance);
  event.kind = 10003 as NDKKind;
  event.content = "";
  event.tags = eventIds.map((id) => ["e", id]);
  await event.publish();
}

export async function fetchBookmarkListFull(pubkey: string): Promise<{ eventIds: string[]; articleAddrs: string[] }> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [10003 as NDKKind], authors: [pubkey], limit: 1 };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  if (events.size === 0) return { eventIds: [], articleAddrs: [] };
  const event = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  const eventIds = event.tags.filter((t) => t[0] === "e" && t[1]).map((t) => t[1]);
  const articleAddrs = event.tags.filter((t) => t[0] === "a" && t[1]).map((t) => t[1]);
  return { eventIds, articleAddrs };
}

export async function publishBookmarkListFull(eventIds: string[], articleAddrs: string[]): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) return;
  const event = new NDKEvent(instance);
  event.kind = 10003 as NDKKind;
  event.content = "";
  event.tags = [
    ...eventIds.map((id) => ["e", id]),
    ...articleAddrs.map((addr) => ["a", addr]),
  ];
  await event.publish();
}

export async function fetchByAddr(addr: string): Promise<NDKEvent | null> {
  const instance = getNDK();
  // addr format: "30023:<pubkey>:<d-tag>"
  const parts = addr.split(":");
  if (parts.length < 3) return null;
  const kind = parseInt(parts[0]);
  const pubkey = parts[1];
  const dTag = parts.slice(2).join(":");
  const filter: NDKFilter = {
    kinds: [kind as NDKKind],
    authors: [pubkey],
    "#d": [dTag],
    limit: 1,
  };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events)[0] ?? null;
}

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

export async function fetchProfile(pubkey: string) {
  const instance = getNDK();
  const user = instance.getUser({ pubkey });
  await user.fetchProfile();
  return user.profile;
}

// ── NIP-65 Relay Lists ────────────────────────────────────────────────────────

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

// ── Notifications (mentions) ──────────────────────────────────────────────────

// ── Follow Suggestions (follows-of-follows) ─────────────────────────────────

export async function fetchFollowSuggestions(myFollows: string[]): Promise<{ pubkey: string; mutualCount: number }[]> {
  if (myFollows.length === 0) return [];
  const instance = getNDK();
  // Fetch contact lists (kind 3) from our follows
  const batchSize = 20;
  const allContactEvents: NDKEvent[] = [];
  for (let i = 0; i < myFollows.length; i += batchSize) {
    const batch = myFollows.slice(i, i + batchSize);
    const filter: NDKFilter = { kinds: [3 as NDKKind], authors: batch, limit: batch.length };
    const events = await instance.fetchEvents(filter, {
      cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
    });
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
  const events = await instance.fetchEvents(
    { kinds: [NDKKind.Text], "#p": [pubkey], since, limit },
    { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
  );
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

// ── NIP-05 Resolution ─────────────────────────────────────────────────────────

export async function resolveNip05(identifier: string): Promise<string | null> {
  const instance = getNDK();
  try {
    const user = new NDKUser({ nip05: identifier });
    user.ndk = instance;
    await user.fetchProfile();
    return user.pubkey || null;
  } catch {
    return null;
  }
}

// ── Relay Recommendations ─────────────────────────────────────────────────────

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

// ── Trending Hashtags ─────────────────────────────────────────────────────────

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

// ── Advanced Search ───────────────────────────────────────────────────────────

export interface AdvancedSearchResults {
  notes: NDKEvent[];
  articles: NDKEvent[];
  users: NDKEvent[];
}

/**
 * Execute an advanced search using a ParsedSearch query.
 * Resolves NIP-05 identifiers, builds filters, runs queries,
 * and applies client-side filters (has:image, has:code, etc.).
 */
export async function advancedSearch(parsed: ParsedSearch, limit = 50): Promise<AdvancedSearchResults> {
  const instance = getNDK();

  // Handle OR queries — run each sub-query and merge
  if (parsed.orQueries && parsed.orQueries.length > 0) {
    const subResults = await Promise.all(parsed.orQueries.map((q) => advancedSearch(q, limit)));
    const seenNotes = new Set<string>();
    const seenArticles = new Set<string>();
    const seenUsers = new Set<string>();
    const notes: NDKEvent[] = [];
    const articles: NDKEvent[] = [];
    const users: NDKEvent[] = [];
    for (const r of subResults) {
      for (const e of r.notes) { if (!seenNotes.has(e.id!)) { seenNotes.add(e.id!); notes.push(e); } }
      for (const e of r.articles) { if (!seenArticles.has(e.id!)) { seenArticles.add(e.id!); articles.push(e); } }
      for (const e of r.users) { if (!seenUsers.has(e.pubkey)) { seenUsers.add(e.pubkey); users.push(e); } }
    }
    return {
      notes: notes.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)).slice(0, limit),
      articles: articles.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)).slice(0, limit),
      users,
    };
  }

  // Resolve any NIP-05 or name-based author identifiers
  const resolvedAuthors = [...parsed.authors];
  for (const nip05 of parsed.unresolvedNip05) {
    const resolved = await resolveNip05(nip05.includes("@") || nip05.includes(".") ? nip05 : `_@${nip05}`);
    if (resolved) {
      resolvedAuthors.push(resolved);
    } else {
      const nameResults = await searchUsers(nip05, 1);
      if (nameResults.length > 0) {
        resolvedAuthors.push(nameResults[0].pubkey);
      }
    }
  }

  // Determine which kinds to search
  const hasKindFilter = parsed.kinds.length > 0;
  const noteKinds = hasKindFilter
    ? parsed.kinds.filter((k) => k === 1)
    : [1];
  const articleKinds = hasKindFilter
    ? parsed.kinds.filter((k) => k === 30023)
    : [30023];

  const searchText = parsed.searchTerms.join(" ").trim();
  const hasSearch = searchText.length > 0;
  const hasHashtags = parsed.hashtags.length > 0;

  const buildFilter = (kinds: number[]): (NDKFilter & { search?: string }) | null => {
    if (kinds.length === 0 && hasKindFilter) return null;
    const filter: NDKFilter & { search?: string } = {
      kinds: kinds.map((k) => k as NDKKind),
      limit,
    };
    if (hasSearch) filter.search = searchText;
    if (hasHashtags) filter["#t"] = parsed.hashtags;
    if (resolvedAuthors.length > 0) filter.authors = resolvedAuthors;
    if (parsed.mentions.length > 0) filter["#p"] = parsed.mentions;
    if (parsed.since) filter.since = parsed.since;
    if (parsed.until) filter.until = parsed.until;
    if (!hasSearch && !hasHashtags && resolvedAuthors.length === 0 && parsed.mentions.length === 0) {
      return null;
    }
    return filter;
  };

  const opts = { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY };

  const noteFilter = noteKinds.length > 0 ? buildFilter(noteKinds) : null;
  const articleFilter = articleKinds.length > 0 ? buildFilter(articleKinds) : null;
  const shouldSearchUsers = (!hasKindFilter || parsed.kinds.includes(0)) && hasSearch && !hasHashtags;

  const [noteEvents, articleEvents, userEvents] = await Promise.all([
    noteFilter ? instance.fetchEvents(noteFilter, opts) : Promise.resolve(new Set<NDKEvent>()),
    articleFilter ? instance.fetchEvents(articleFilter, opts) : Promise.resolve(new Set<NDKEvent>()),
    shouldSearchUsers ? instance.fetchEvents({ kinds: [NDKKind.Metadata], search: searchText, limit: 20 } as NDKFilter & { search: string }, opts) : Promise.resolve(new Set<NDKEvent>()),
  ]);

  let notes = Array.from(noteEvents);
  let articles = Array.from(articleEvents);
  const users = Array.from(userEvents);

  // Client-side filters: has:image, has:video, has:code, etc.
  if (parsed.hasFilters.length > 0) {
    const applyHas = (events: NDKEvent[]) =>
      events.filter((e) => parsed.hasFilters.every((f) => matchesHasFilter(e.content, f)));
    notes = applyHas(notes);
    articles = applyHas(articles);
  }

  return {
    notes: notes.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
    articles: articles.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
    users,
  };
}
