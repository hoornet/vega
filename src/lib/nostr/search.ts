import { NDKEvent, NDKFilter, NDKKind, NDKSubscriptionCacheUsage, NDKUser } from "@nostr-dev-kit/ndk";
import { type ParsedSearch, matchesHasFilter } from "../search";
import { getNDK } from "./core";

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

  // Wrap fetchEvents with a timeout — NDK can hang forever if no relay supports the filter
  const fetchWithTimeout = (filter: NDKFilter & { search?: string }, timeoutMs = 8000): Promise<Set<NDKEvent>> => {
    return Promise.race([
      instance.fetchEvents(filter, opts),
      new Promise<Set<NDKEvent>>((resolve) => setTimeout(() => resolve(new Set()), timeoutMs)),
    ]);
  };

  const noteFilter = noteKinds.length > 0 ? buildFilter(noteKinds) : null;
  const articleFilter = articleKinds.length > 0 ? buildFilter(articleKinds) : null;
  const shouldSearchUsers = (!hasKindFilter || parsed.kinds.includes(0)) && hasSearch && !hasHashtags;

  const [noteEvents, articleEvents, userEvents] = await Promise.all([
    noteFilter ? fetchWithTimeout(noteFilter) : Promise.resolve(new Set<NDKEvent>()),
    articleFilter ? fetchWithTimeout(articleFilter) : Promise.resolve(new Set<NDKEvent>()),
    shouldSearchUsers ? fetchWithTimeout({ kinds: [NDKKind.Metadata], search: searchText, limit: 20 } as NDKFilter & { search: string }) : Promise.resolve(new Set<NDKEvent>()),
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
