import NDK, { NDKEvent, NDKFilter, NDKKind, NDKSubscriptionCacheUsage, NDKUser } from "@nostr-dev-kit/ndk";
import { type ParsedSearch, matchesHasFilter } from "../search";
import { getNDK, fetchWithTimeout, withTimeout, FEED_TIMEOUT } from "./core";

// Dedicated NIP-50 search relays — queried for full-text search regardless of user's relay list
const SEARCH_RELAYS = [
  "wss://relay.nostr.band",
  "wss://search.nos.today",
  "wss://nostr.wine",
];

// One persistent NDK per search relay — queried independently so a slow/dead
// relay can't block results from the others.
const searchNDKs: Map<string, NDK> = new Map();

async function getSearchNDKFor(relay: string): Promise<NDK> {
  let ndk = searchNDKs.get(relay);
  if (ndk) return ndk;
  ndk = new NDK({ explicitRelayUrls: [relay] });
  searchNDKs.set(relay, ndk);
  await withTimeout(ndk.connect(), 5000, undefined);
  console.log(`[Vega] Search relay connected: ${relay}`);
  return ndk;
}

const EMPTY_SET = new Set<NDKEvent>();

/** Fetch events from all search relays independently, merge results. */
async function searchFetch(filter: NDKFilter, timeoutMs = FEED_TIMEOUT): Promise<Set<NDKEvent>> {
  const perRelay = SEARCH_RELAYS.map(async (relay) => {
    try {
      const ndk = await getSearchNDKFor(relay);
      const events = await withTimeout(
        ndk.fetchEvents(filter, { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY, groupable: false }),
        timeoutMs,
        EMPTY_SET,
      );
      return events;
    } catch {
      return EMPTY_SET;
    }
  });
  const results = await Promise.all(perRelay);
  const merged = new Set<NDKEvent>();
  for (const set of results) {
    for (const e of set) merged.add(e);
  }
  return merged;
}

export async function searchNotes(query: string, limit = 50): Promise<NDKEvent[]> {
  const instance = getNDK();
  const isHashtag = query.startsWith("#");

  if (isHashtag) {
    const filter: NDKFilter = { kinds: [NDKKind.Text], "#t": [query.slice(1).toLowerCase()], limit };
    const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
    return Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  }

  // Hybrid: NIP-50 full-text on search relays + hashtag on user relays
  const searchFilter: NDKFilter & { search?: string } = { kinds: [NDKKind.Text], search: query, limit };
  const tagFilter: NDKFilter = { kinds: [NDKKind.Text], "#t": [query.toLowerCase()], limit };
  const [nip50Events, tagEvents] = await Promise.all([
    searchFetch(searchFilter),
    fetchWithTimeout(instance, tagFilter, FEED_TIMEOUT),
  ]);

  // Merge and deduplicate
  const seen = new Set<string>();
  const merged: NDKEvent[] = [];
  for (const e of [...nip50Events, ...tagEvents]) {
    if (e.id && !seen.has(e.id)) { seen.add(e.id); merged.push(e); }
  }
  return merged.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function searchUsers(query: string, limit = 20): Promise<NDKEvent[]> {
  const filter: NDKFilter & { search?: string } = {
    kinds: [NDKKind.Metadata],
    search: query,
    limit,
  };
  const events = await searchFetch(filter);
  return Array.from(events);
}

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

  // Resolve author identifiers (npub or NIP-05 only — display name resolution not yet supported)
  const resolvedAuthors = [...parsed.authors];
  for (const nip05 of parsed.unresolvedNip05) {
    const identifier = nip05.includes("@") || nip05.includes(".") ? nip05 : `_@${nip05}`;
    const resolved = await resolveNip05(identifier);
    if (resolved) resolvedAuthors.push(resolved);
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

  const noteFilter = noteKinds.length > 0 ? buildFilter(noteKinds) : null;
  const articleFilter = articleKinds.length > 0 ? buildFilter(articleKinds) : null;
  const shouldSearchUsers = (!hasKindFilter || parsed.kinds.includes(0)) && (hasSearch || hasHashtags);

  const usesNip50 = hasSearch && !hasHashtags;

  // Build parallel fetch promises
  const fetches: Promise<Set<NDKEvent>>[] = [];

  // Notes: NIP-50 on search relays, or hashtag on user relays
  fetches.push(noteFilter ? (usesNip50 ? searchFetch(noteFilter) : fetchWithTimeout(instance, noteFilter, FEED_TIMEOUT)) : Promise.resolve(new Set<NDKEvent>()));
  // Articles: same logic
  fetches.push(articleFilter ? (usesNip50 ? searchFetch(articleFilter) : fetchWithTimeout(instance, articleFilter, FEED_TIMEOUT)) : Promise.resolve(new Set<NDKEvent>()));
  // Users: NIP-50 on search relays
  fetches.push(shouldSearchUsers
    ? searchFetch({ kinds: [NDKKind.Metadata], search: hasSearch ? searchText : parsed.hashtags.join(" "), limit: 20 } as NDKFilter & { search: string })
    : Promise.resolve(new Set<NDKEvent>()));

  // Hybrid: if text search, also do hashtag lookup on user relays and merge
  // Carry over author/mention/time constraints so modifiers like by:jack still filter
  const hybridTerms = hasSearch && !hasHashtags ? searchText.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const buildHybridFilter = (kinds: number[]): NDKFilter => {
    const f: NDKFilter = { kinds: kinds.map((k) => k as NDKKind), "#t": hybridTerms, limit };
    if (resolvedAuthors.length > 0) f.authors = resolvedAuthors;
    if (parsed.mentions.length > 0) f["#p"] = parsed.mentions;
    if (parsed.since) f.since = parsed.since;
    if (parsed.until) f.until = parsed.until;
    return f;
  };
  if (hybridTerms.length > 0 && noteKinds.length > 0) {
    fetches.push(fetchWithTimeout(instance, buildHybridFilter(noteKinds), FEED_TIMEOUT));
  } else {
    fetches.push(Promise.resolve(new Set<NDKEvent>()));
  }
  if (hybridTerms.length > 0 && articleKinds.length > 0) {
    fetches.push(fetchWithTimeout(instance, buildHybridFilter(articleKinds), FEED_TIMEOUT));
  } else {
    fetches.push(Promise.resolve(new Set<NDKEvent>()));
  }

  const [noteEvents, articleEvents, userEvents, hybridNoteEvents, hybridArticleEvents] = await Promise.all(fetches);

  // Merge and deduplicate results from multiple sources
  const dedup = (...sources: Set<NDKEvent>[]): NDKEvent[] => {
    const seen = new Set<string>();
    const result: NDKEvent[] = [];
    for (const source of sources) {
      for (const e of source) {
        if (e.id && !seen.has(e.id)) { seen.add(e.id); result.push(e); }
      }
    }
    return result;
  };

  let notes = dedup(noteEvents, hybridNoteEvents);
  let articles = dedup(articleEvents, hybridArticleEvents);
  const users = Array.from(userEvents);

  // Client-side author filter — search relays may not intersect authors with search properly
  if (resolvedAuthors.length > 0) {
    const authorSet = new Set(resolvedAuthors);
    notes = notes.filter((e) => authorSet.has(e.pubkey));
    articles = articles.filter((e) => authorSet.has(e.pubkey));
  }

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
