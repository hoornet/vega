import { NDKEvent, NDKFilter, NDKKind, NDKSubscriptionCacheUsage, nip19 } from "@nostr-dev-kit/ndk";
import { getNDK } from "./core";

export async function publishArticle(opts: {
  title: string;
  content: string;
  summary?: string;
  image?: string;
  tags?: string[];
}): Promise<{ relayCount: number }> {
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

  const relays = await event.publish();
  return { relayCount: relays.size };
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
