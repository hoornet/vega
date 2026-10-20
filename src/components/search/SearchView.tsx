import { useState, useRef, useEffect } from "react";
import { NDKEvent, nip19 } from "@nostr-dev-kit/ndk";
import { fetchFollowSuggestions, fetchProfile, advancedSearch, fetchTrendingHashtags, fetchNoteById } from "../../lib/nostr";
import { parseSearchQuery, describeSearch } from "../../lib/search";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useDismissedSuggestionsStore } from "../../stores/dismissedSuggestions";
import { useUIStore } from "../../stores/ui";
import { nameOf } from "../../lib/utils";
import { AvatarInitial } from "../shared/AvatarInitial";
import { NoteCard } from "../feed/NoteCard";
import { ArticleCard } from "../article/ArticleCard";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";
import { Button } from "../shared/Button";
import { FollowButton } from "../shared/FollowButton";
import { ListState } from "../shared/ListState";
import { fetchMark, wentUnanswered } from "../../lib/listLoad";

interface ParsedUser {
  pubkey: string;
  name: string;
  displayName: string;
  picture: string;
  nip05: string;
  about: string;
}

function parseUserEvent(event: NDKEvent): ParsedUser {
  let meta: Record<string, string> = {};
  try { meta = JSON.parse(event.content); } catch { /* ignore */ }
  return {
    pubkey: event.pubkey,
    name: meta.name || "",
    displayName: meta.display_name || meta.name || "",
    picture: meta.picture || "",
    nip05: meta.nip05 || "",
    about: meta.about || "",
  };
}

function UserRow({ user }: { user: ParsedUser }) {
  const { openProfile: navToProfile } = useUIStore();
  const displayName = nameOf(user, user.pubkey);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border-subtle hover:bg-bg-hover transition-colors">
      <button className="shrink-0 cursor-pointer" aria-label={`View profile of ${displayName}`} onClick={() => navToProfile(user.pubkey)}>
        {user.picture ? (
          <img src={user.picture} alt={`${displayName}'s avatar`} className="w-9 h-9 rounded-full object-cover bg-bg-raised"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-9 h-9 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs">
            <AvatarInitial profile={user} />
          </div>
        )}
      </button>
      <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => navToProfile(user.pubkey)}>
        <div className="text-text text-body font-medium truncate">{displayName}</div>
        {user.nip05 && <div className="text-text-dim text-caption truncate">{user.nip05}</div>}
        {user.about && <div className="text-text-dim text-caption truncate mt-0.5">{user.about}</div>}
      </button>
      <FollowButton pubkey={user.pubkey} />
    </div>
  );
}

interface Suggestion {
  pubkey: string;
  mutualCount: number;
  profile: ParsedUser | null;
}

export function SearchView() {
  const { pendingSearch } = useUIStore();
  const [query, setQuery] = useState(pendingSearch ?? "");
  const [noteResults, setNoteResults] = useState<NDKEvent[]>([]);
  const [userResults, setUserResults] = useState<ParsedUser[]>([]);
  const [articleResults, setArticleResults] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // How the last search ended. "No results" is only said when a relay answered.
  const [outcome, setOutcome] = useState<{ kind: "answered" } | { kind: "unreachable" } | { kind: "error"; message: string }>({ kind: "answered" });
  const [activeTab, setActiveTab] = useState<"notes" | "people" | "articles">("notes");
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [trending, setTrending] = useState<{ tag: string; count: number }[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingLoaded, setTrendingLoaded] = useState(false);
  // Load trending hashtags on mount
  useEffect(() => {
    if (trendingLoaded) return;
    setTrendingLoading(true);
    fetchTrendingHashtags().then((results) => {
      setTrending(results);
      setTrendingLoaded(true);
    }).catch(() => {}).finally(() => setTrendingLoading(false));
  }, []);

  const { loggedIn, follows } = useUserStore();
  const { mutedPubkeys, contentMatchesMutedKeyword } = useMuteStore();
  const { dismissedPubkeys, dismiss } = useDismissedSuggestionsStore();

  const visibleSuggestions = suggestions.filter(
    (s) => !dismissedPubkeys.includes(s.pubkey) && !mutedPubkeys.includes(s.pubkey) && !follows.includes(s.pubkey)
  );

  // Load follow suggestions on mount (only for logged-in users with follows)
  useEffect(() => {
    if (!loggedIn || follows.length === 0 || suggestionsLoaded) return;
    setSuggestionsLoading(true);
    fetchFollowSuggestions(follows).then(async (results) => {
      // Load profiles for top suggestions
      const withProfiles: Suggestion[] = await Promise.all(
        results.slice(0, 20).map(async (s) => {
          try {
            const p = await fetchProfile(s.pubkey);
            return {
              ...s,
              profile: p ? {
                pubkey: s.pubkey,
                name: (p as Record<string, unknown>).name as string || "",
                displayName: (p as Record<string, unknown>).display_name as string || (p as Record<string, unknown>).name as string || "",
                picture: (p as Record<string, unknown>).picture as string || "",
                nip05: (p as Record<string, unknown>).nip05 as string || "",
                about: (p as Record<string, unknown>).about as string || "",
              } : null,
            };
          } catch {
            return { ...s, profile: null };
          }
        })
      );
      setSuggestions(withProfiles.filter((s) => s.profile !== null));
      setSuggestionsLoading(false);
      setSuggestionsLoaded(true);
    }).catch(() => setSuggestionsLoading(false));
  }, [loggedIn, follows.length]);

  // Run pending search from hashtag/mention click
  useEffect(() => {
    if (pendingSearch) {
      useUIStore.setState({ pendingSearch: null });
      handleSearch(pendingSearch);
    }
  }, []);

  const handleSearch = async (overrideQuery?: string) => {
    // Strip nostr: URI prefix (NIP-21) so pasted share links work
    const q = (overrideQuery ?? query).trim().replace(/^nostr:/i, "");
    if (!q) return;
    if (overrideQuery) setQuery(overrideQuery);

    // Bare npub/nprofile → navigate directly to profile
    if (/^(npub1|nprofile1)[a-z0-9]+$/i.test(q)) {
      try {
        const decoded = nip19.decode(q);
        const pubkey = decoded.type === "npub" ? decoded.data
          : decoded.type === "nprofile" ? decoded.data.pubkey : null;
        if (pubkey) {
          useUIStore.getState().openProfile(pubkey);
          return;
        }
      } catch { /* not valid, fall through to normal search */ }
    }

    // Bare note1/nevent1/naddr1 → navigate directly to thread/article
    if (/^(note1|nevent1|naddr1)[a-z0-9]+$/i.test(q)) {
      try {
        const decoded = nip19.decode(q);
        if (decoded.type === "note") {
          const event = await fetchNoteById(decoded.data);
          if (event) { useUIStore.getState().openThread(event); return; }
        } else if (decoded.type === "nevent") {
          const event = await fetchNoteById(decoded.data.id);
          if (event) { useUIStore.getState().openThread(event); return; }
        } else if (decoded.type === "naddr") {
          useUIStore.getState().openArticle(q);
          return;
        }
      } catch { /* not valid, fall through to normal search */ }
    }
    setLoading(true);
    setSearched(false);
    setSearchHint(null);
    setNoteResults([]);
    setArticleResults([]);
    setUserResults([]);
    setOutcome({ kind: "answered" });
    const mark = fetchMark();
    try {
      const parsed = parseSearchQuery(q);
      const isAdvanced = parsed.authors.length > 0 || parsed.unresolvedNip05.length > 0 ||
        parsed.kinds.length > 0 || parsed.hasFilters.length > 0 ||
        parsed.since !== null || parsed.until !== null || parsed.mentions.length > 0 ||
        parsed.orQueries !== null;

      if (isAdvanced) {
        setSearchHint(describeSearch(parsed));
      }

      const results = await advancedSearch(parsed);
      setNoteResults(results.notes);
      setUserResults(results.users.map(parseUserEvent));
      setArticleResults(results.articles);
      setActiveTab(results.notes.length > 0 ? "notes" : results.articles.length > 0 ? "articles" : "people");
      // Only read when there is nothing to show (see the zero-results state below).
      if (wentUnanswered(mark)) setOutcome({ kind: "unreachable" });
    } catch (err) {
      // There was no catch: a search that threw ended as "No results" and an unhandled rejection.
      setOutcome({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  // Respect the mute list in search results (issue #7): hide notes/articles
  // from muted pubkeys or matching a muted keyword, and people who are muted.
  const isMutedEvent = (e: NDKEvent) =>
    mutedPubkeys.includes(e.pubkey) || contentMatchesMutedKeyword(e.content);
  const filteredNoteResults = noteResults.filter((e) => !isMutedEvent(e));
  const filteredArticleResults = articleResults.filter((e) => !isMutedEvent(e));
  const filteredUserResults = userResults.filter((u) => !mutedPubkeys.includes(u.pubkey));

  const totalResults = filteredNoteResults.length + filteredUserResults.length + filteredArticleResults.length;

  return (
    <div className="h-full flex flex-col">
      {/* The search field is this view's header. */}
      <ViewHeader
        hiddenTitle="Search"
        actions={
          <Button onClick={() => handleSearch()} disabled={!query.trim()} busy={loading}>Search</Button>
        }
      >
        <input
          ref={inputRef}
          data-search-input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="search… try by:name, #tag, has:image, is:article, since:2026-01-01"
          aria-label="Search Nostr"
          autoFocus
          className="w-full bg-transparent text-text text-ui placeholder:text-text-dim focus:outline-none"
        />
      </ViewHeader>

      {/* Tabs — shown once a search has been run */}
      {searched && (
        <Tabs
          label="Search results"
          panel="search-panel"
          tabs={[
            { id: "notes", label: "Notes", count: filteredNoteResults.length || undefined },
            { id: "articles", label: "Articles", count: filteredArticleResults.length || undefined },
            { id: "people", label: "People", count: filteredUserResults.length || undefined },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
      )}

      {/* Search hint bar */}
      {searchHint && searched && (
        <div className="border-b border-border-subtle px-4 py-1.5 bg-bg-raised shrink-0">
          <span className="text-text-dim text-caption">{searchHint}</span>
        </div>
      )}

      {/* Results area */}
      <div {...(searched ? tabPanelProps("search-panel", activeTab) : {})} className="flex-1 overflow-y-auto content-column">

        {/* Loading indicator */}
        {loading && (
          <div className="px-4 py-12 flex flex-col items-center gap-3">
            <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-text-dim text-body">
              Searching relays for <span className="text-text font-medium">{query}</span>
            </p>
          </div>
        )}

        {/* Idle / pre-search hint */}
        {!searched && !loading && (
          <div className="px-4 py-6 space-y-4">
            <div className="text-center space-y-2">
              <p className="text-text-dim text-body">
                Type a keyword, <span className="text-accent">#hashtag</span>, or use search modifiers.
              </p>
              <p className="text-text-dim text-caption">
                Full-text search uses dedicated search relays. Hashtag and keyword results are combined.
              </p>
            </div>

            {/* Search syntax help */}
            <div className="max-w-md mx-auto">
              <h3 className="text-text-dim text-micro uppercase tracking-widest mb-2">Search modifiers</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
                <span className="text-accent font-mono">by:user@domain</span>
                <span className="text-text-dim">notes from NIP-05 author</span>
                <span className="text-accent font-mono">by:npub1...</span>
                <span className="text-text-dim">notes from pubkey</span>
                <span className="text-accent font-mono">#bitcoin</span>
                <span className="text-text-dim">hashtag search</span>
                <span className="text-accent font-mono">has:image</span>
                <span className="text-text-dim">with images</span>
                <span className="text-accent font-mono">has:video</span>
                <span className="text-text-dim">with video</span>
                <span className="text-accent font-mono">is:article</span>
                <span className="text-text-dim">long-form only</span>
                <span className="text-accent font-mono">since:2026-01-01</span>
                <span className="text-text-dim">after date</span>
                <span className="text-accent font-mono">until:2026-03-01</span>
                <span className="text-text-dim">before date</span>
                <span className="text-accent font-mono">A OR B</span>
                <span className="text-text-dim">match either term</span>
              </div>
              <p className="text-text-dim text-caption mt-2">
                Combine freely: <span className="font-mono text-text-muted">bitcoin by:dergigi has:image since:2026-01-01</span>
              </p>
            </div>
          </div>
        )}

        {/* Trending hashtags */}
        {!searched && !loading && (trending.length > 0 || trendingLoading) && (
          <div className="border-t border-border-subtle px-4 py-4">
            <h3 className="text-text-dim text-micro uppercase tracking-widest mb-2">Trending now</h3>
            {trendingLoading && (
              <p className="text-text-dim text-caption">Loading trends…</p>
            )}
            <div className="flex flex-wrap gap-2">
              {trending.map((t) => (
                <button
                  key={t.tag}
                  onClick={() => {
                    const hashQuery = `#${t.tag}`;
                    setQuery(hashQuery);
                    handleSearch(hashQuery);
                  }}
                  className="px-2.5 py-1 text-ui border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors rounded-sm"
                >
                  #{t.tag} <span className="text-text-dim text-caption">({t.count})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Discover — follow suggestions */}
        {!searched && !loading && loggedIn && (
          <div className="border-t border-border-subtle">
            <div className="px-4 py-2.5 border-b border-border-subtle">
              <h3 className="text-text text-body font-medium">Discover people</h3>
              <p className="text-text-dim text-caption mt-0.5">Based on who your follows follow</p>
            </div>
            {suggestionsLoading && (
              <div className="px-4 py-6 text-text-dim text-caption text-center">Finding suggestions…</div>
            )}
            {visibleSuggestions.map((s) => s.profile && (
              <div key={s.pubkey} className="flex items-center gap-3 px-4 py-2.5 border-b border-border-subtle hover:bg-bg-hover transition-colors group/suggestion">
                <button className="shrink-0 cursor-pointer" aria-label={`View profile of ${nameOf(s.profile, s.pubkey)}`} onClick={() => useUIStore.getState().openProfile(s.pubkey)}>
                  {s.profile.picture ? (
                    <img src={s.profile.picture} alt={`${nameOf(s.profile, s.pubkey)}'s avatar`} className="w-9 h-9 rounded-full object-cover bg-bg-raised"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs">
                      <AvatarInitial profile={s.profile} />
                    </div>
                  )}
                </button>
                <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => useUIStore.getState().openProfile(s.pubkey)}>
                  <div className="text-text text-body font-medium truncate">
                    {nameOf(s.profile, s.pubkey)}
                  </div>
                  <div className="text-text-dim text-caption">
                    {s.mutualCount} mutual follow{s.mutualCount !== 1 ? "s" : ""}
                    {s.profile.nip05 && <span className="ml-2">{s.profile.nip05}</span>}
                  </div>
                  {s.profile.about && (
                    <div className="text-text-dim text-caption truncate mt-0.5">{s.profile.about}</div>
                  )}
                </button>
                <FollowButton pubkey={s.pubkey} />
                <button
                  onClick={() => dismiss(s.pubkey)}
                  className="text-text-dim hover:text-danger text-[14px] opacity-0 group-hover/suggestion:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0 px-1"
                  title="Don't suggest again"
                >
                  ×
                </button>
              </div>
            ))}
            {suggestionsLoaded && visibleSuggestions.length === 0 && (
              <div className="px-4 py-6 text-text-dim text-caption text-center">
                Follow more people to see suggestions here.
              </div>
            )}
          </div>
        )}

        {/* Zero results */}
        {searched && totalResults === 0 && (
          <ListState
            state={outcome.kind === "answered" ? "empty" : outcome.kind}
            empty={<>No results for <span className="text-text font-medium">{query}</span>.</>}
            emptyHint="Try different keywords or a #hashtag."
            // Text search goes to search relays that are not the user's own, so "your relays" would be wrong.
            unreachable="No relay answered this search."
            what="search results"
            error={outcome.kind === "error" ? outcome.message : undefined}
            onRetry={() => handleSearch()}
          />
        )}

        {/* People tab — zero results hint */}
        {searched && activeTab === "people" && filteredUserResults.length === 0 && totalResults > 0 && (
          <div className="px-4 py-6 text-center">
            <p className="text-text-dim text-body">No people found for <span className="text-text">{query}</span>.</p>
          </div>
        )}

        {/* People results */}
        {activeTab === "people" && filteredUserResults.map((user) => (
          <UserRow key={user.pubkey} user={user} />
        ))}

        {/* Articles results */}
        {activeTab === "articles" && filteredArticleResults.map((event) => (
          <ArticleCard key={event.id} event={event} />
        ))}

        {/* Notes results */}
        {activeTab === "notes" && filteredNoteResults.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
