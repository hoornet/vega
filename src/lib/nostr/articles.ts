import { NDKEvent, NDKFilter, NDKKind, NDKRelay, NDKRelaySet, nip19 } from "@nostr-dev-kit/ndk";
import { getNDK, fetchWithTimeout, fetchFromRelay, heardFromNetwork, withTimeout, isOutboxRelaysEnabled, FEED_TIMEOUT, SINGLE_TIMEOUT, publishToNetwork } from "./core";
import { fetchUserRelayList } from "./relays";
import { relaysToAsk } from "./lists";
import { recordFetchOutcome } from "./fetchTotals";

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

  const relays = await publishToNetwork(event);
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
    const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
    return Array.from(events)[0] ?? null;
  } catch {
    return null;
  }
}

const NO_RELAYS = { read: [] as string[], write: [] as string[] };

/**
 * A writer's articles: each of the user's relays asked on its own, plus the
 * writer's own write relays when Relay reach is on (as `fetchUserNotesNIP65`
 * does for notes; with it off, our relays are all the user allowed, issue #35).
 *
 * On its own, because of NDK's early EOSE (see `fetchFromRelay`): measured
 * 2026-10-17 in the capture harness, two relays answered "nothing" within 80 ms,
 * which cut the wait for the third to about 330 ms, and the one relay that held
 * the writer's articles answered at 368 ms. One fetch over all three returned
 * nothing every time; the same relay asked alone returned five.
 */
export async function fetchAuthorArticles(pubkey: string, limit = 20): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Article], authors: [pubkey], limit };
  const [own, theirs] = await Promise.all([
    relaysToAsk(instance),
    isOutboxRelaysEnabled() ? withTimeout(fetchUserRelayList(pubkey), SINGLE_TIMEOUT, NO_RELAYS).catch(() => NO_RELAYS) : Promise.resolve(NO_RELAYS),
  ]);
  const relays = new Map<string, NDKRelay>(own.map((r) => [r.url, r]));
  if (theirs.write.length > 0) {
    try {
      for (const r of NDKRelaySet.fromRelayUrls(theirs.write, instance).relays) relays.set(r.url, r);
    } catch { /* their relays are a bonus */ }
  }
  const asked = await Promise.all(Array.from(relays.values()).map(async (relay) => ({ relay, ...(await fetchFromRelay(instance, relay, filter, FEED_TIMEOUT)) })));
  // One answer from the network is an answer; what a list says of "nothing" depends on it.
  recordFetchOutcome(heardFromNetwork(asked.filter((a) => a.answered).map((a) => a.relay.url), instance.pool?.relays?.keys() ?? []));
  const byId = new Map<string, NDKEvent>();
  for (const a of asked) for (const e of a.events) if (!byId.has(e.id)) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchArticleFeed(limit = 40, authors?: string[]): Promise<NDKEvent[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [NDKKind.Article], limit };
  if (authors && authors.length > 0) filter.authors = authors;
  const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
  return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function searchArticles(query: string, limit = 30): Promise<NDKEvent[]> {
  const instance = getNDK();
  const isHashtag = query.startsWith("#");
  const filter: NDKFilter & { search?: string } = isHashtag
    ? { kinds: [NDKKind.Article], "#t": [query.slice(1).toLowerCase()], limit }
    : { kinds: [NDKKind.Article], search: query, limit };
  const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
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
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  return Array.from(events)[0] ?? null;
}
