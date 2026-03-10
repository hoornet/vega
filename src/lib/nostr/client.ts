import NDK, { NDKEvent, NDKFilter, NDKKind, NDKRelay, NDKSubscriptionCacheUsage, nip19 } from "@nostr-dev-kit/ndk";

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

export async function publishReply(content: string, replyTo: { id: string; pubkey: string }): Promise<void> {
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
}

export async function publishNote(content: string): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");

  const event = new NDKEvent(instance);
  event.kind = NDKKind.Text;
  event.content = content;
  await event.publish();
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

// ── Direct Messages (NIP-04) ─────────────────────────────────────────────────

export async function fetchDMConversations(myPubkey: string): Promise<NDKEvent[]> {
  const instance = getNDK();
  const [received, sent] = await Promise.all([
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], "#p": [myPubkey], limit: 500 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], authors: [myPubkey], limit: 500 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
  ]);
  const seen = new Set<string>();
  return [...Array.from(received), ...Array.from(sent)]
    .filter((e) => { if (seen.has(e.id!)) return false; seen.add(e.id!); return true; })
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchDMThread(myPubkey: string, theirPubkey: string): Promise<NDKEvent[]> {
  const instance = getNDK();
  const [fromThem, fromMe] = await Promise.all([
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], "#p": [myPubkey], authors: [theirPubkey], limit: 200 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    instance.fetchEvents(
      { kinds: [NDKKind.EncryptedDirectMessage], "#p": [theirPubkey], authors: [myPubkey], limit: 200 },
      { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
  ]);
  return [...Array.from(fromThem), ...Array.from(fromMe)]
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

export async function sendDM(recipientPubkey: string, content: string): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");
  const recipient = instance.getUser({ pubkey: recipientPubkey });
  const encrypted = await instance.signer.encrypt(recipient, content, "nip04");
  const event = new NDKEvent(instance);
  event.kind = NDKKind.EncryptedDirectMessage;
  event.content = encrypted;
  event.tags = [["p", recipientPubkey]];
  await event.publish();
}

export async function decryptDM(event: NDKEvent, myPubkey: string): Promise<string> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("No signer");
  // ECDH shared secret is symmetric — always pass the OTHER party
  const otherPubkey =
    event.pubkey === myPubkey
      ? (event.tags.find((t) => t[0] === "p")?.[1] ?? "")
      : event.pubkey;
  const otherUser = instance.getUser({ pubkey: otherPubkey });
  return instance.signer.decrypt(otherUser, event.content, "nip04");
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
  const filter: NDKFilter = { kinds: [NDKKind.ZapRequest], authors: [pubkey], limit };
  const events = await instance.fetchEvents(filter, {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
  });
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
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
