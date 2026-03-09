import NDK, { NDKEvent, NDKFilter, NDKKind, NDKSubscriptionCacheUsage } from "@nostr-dev-kit/ndk";

const DEFAULT_RELAYS = [
  "ws://umbrel.local:4848",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
];

let ndk: NDK | null = null;

export function getNDK(): NDK {
  if (!ndk) {
    ndk = new NDK({
      explicitRelayUrls: DEFAULT_RELAYS,
    });
  }
  return ndk;
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

export async function fetchProfile(pubkey: string) {
  const instance = getNDK();
  const user = instance.getUser({ pubkey });
  await user.fetchProfile();
  return user.profile;
}
