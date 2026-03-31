import { useState, useRef, useEffect } from "react";
import { NDKEvent, nip19 } from "@nostr-dev-kit/ndk";
import { fetchFollowSuggestions, fetchProfile, advancedSearch, fetchTrendingHashtags, fetchNoteById } from "../../lib/nostr";
import { parseSearchQuery, describeSearch } from "../../lib/search";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useDismissedSuggestionsStore } from "../../stores/dismissedSuggestions";
import { useUIStore } from "../../stores/ui";
import { shortenPubkey } from "../../lib/utils";
import { NoteCard } from "../feed/NoteCard";
import { ArticleCard } from "../article/ArticleCard";

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
  const { loggedIn, pubkey: myPubkey, follows, follow, unfollow } = useUserStore();
  const { openProfile: navToProfile } = useUIStore();
  const isOwn = user.pubkey === myPubkey;
  const isFollowing = follows.includes(user.pubkey);
  const [pending, setPending] = useState(false);
  const displayName = user.displayName || user.name || shortenPubkey(user.pubkey);

  const handleFollowToggle = async () => {
    setPending(true);
    try {
      if (isFollowing) await unfollow(user.pubkey);
      else await follow(user.pubkey);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border hover:bg-bg-hover transition-colors">
      <div className="shrink-0 cursor-pointer" onClick={() => navToProfile(user.pubkey)}>
        {user.picture ? (
          <img src={user.picture} alt="" className="w-9 h-9 rounded-sm object-cover bg-bg-raised"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-9 h-9 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navToProfile(user.pubkey)}>
        <div className="text-text text-[13px] font-medium truncate">{displayName}</div>
        {user.nip05 && <div className="text-text-dim text-[10px] truncate">{user.nip05}</div>}
        {user.about && <div className="text-text-dim text-[11px] truncate mt-0.5">{user.about}</div>}
      </div>
      {loggedIn && !isOwn && (
        <button
          onClick={handleFollowToggle}
          disabled={pending}
          className={`text-[11px] px-3 py-1 border transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
            isFollowing
              ? "border-border text-text-muted hover:text-danger hover:border-danger/40"
              : "border-accent/60 text-accent hover:bg-accent hover:text-white"
          }`}
        >
          {pending ? "…" : isFollowing ? "unfollow" : "follow"}
        </button>
      )}
    </div>
  );
}

interface Suggestion {
  pubkey: string;
  mutualCount: number;
  profile: ParsedUser | null;
}

function SuggestionFollowButton({ pubkey }: { pubkey: string }) {
  const { loggedIn, follows, follow, unfollow } = useUserStore();
  const isFollowing = follows.includes(pubkey);
  const [pending, setPending] = useState(false);

  if (!loggedIn) return null;

  const handleClick = async () => {
    setPending(true);
    try {
      if (isFollowing) await unfollow(pubkey);
      else await follow(pubkey);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={`text-[11px] px-3 py-1 border transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
        isFollowing
          ? "border-border text-text-muted hover:text-danger hover:border-danger/40"
          : "border-accent/60 text-accent hover:bg-accent hover:text-white"
      }`}
    >
      {pending ? "..." : isFollowing ? "unfollow" : "follow"}
    </button>
  );
}

export function SearchView() {
  const { pendingSearch } = useUIStore();
  const [query, setQuery] = useState(pendingSearch ?? "");
  const [noteResults, setNoteResults] = useState<NDKEvent[]>([]);
  const [userResults, setUserResults] = useState<ParsedUser[]>([]);
  const [articleResults, setArticleResults] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
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
  const { mutedPubkeys } = useMuteStore();
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
                name: (p as Record<string, string>).name || "",
                displayName: (p as Record<string, string>).display_name || (p as Record<string, string>).name || "",
                picture: (p as Record<string, string>).picture || "",
                nip05: (p as Record<string, string>).nip05 || "",
                about: (p as Record<string, string>).about || "",
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
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const totalResults = noteResults.length + userResults.length + articleResults.length;

  return (
    <div className="h-full flex flex-col">
      {/* Search bar */}
      <header className="border-b border-border px-4 py-2.5 shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            data-search-input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="search… try by:name, #tag, has:image, is:article, since:2026-01-01"
            autoFocus
            className="flex-1 bg-transparent text-text text-[13px] placeholder:text-text-dim focus:outline-none"
          />
          <button
            onClick={() => handleSearch()}
            disabled={!query.trim() || loading}
            className="text-[11px] px-3 py-1 border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            {loading ? "…" : "search"}
          </button>
        </div>
      </header>

      {/* Tabs — shown once a search has been run */}
      {searched && (
        <div className="border-b border-border flex shrink-0">
          {(["notes", "articles", "people"] as const).map((tab) => {
            const count = tab === "notes" ? noteResults.length : tab === "articles" ? articleResults.length : userResults.length;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-[11px] border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-accent text-accent"
                    : "border-transparent text-text-dim hover:text-text"
                }`}
              >
                {tab} {count > 0 ? `(${count})` : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* Search hint bar */}
      {searchHint && searched && (
        <div className="border-b border-border px-4 py-1.5 bg-bg-raised shrink-0">
          <span className="text-text-dim text-[10px]">{searchHint}</span>
        </div>
      )}

      {/* Results area */}
      <div className="flex-1 overflow-y-auto">

        {/* Loading indicator */}
        {loading && (
          <div className="px-4 py-12 flex flex-col items-center gap-3">
            <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-text-dim text-[12px]">
              Searching relays for <span className="text-text font-medium">{query}</span>
            </p>
          </div>
        )}

        {/* Idle / pre-search hint */}
        {!searched && !loading && (
          <div className="px-4 py-6 space-y-4">
            <div className="text-center space-y-2">
              <p className="text-text-dim text-[12px]">
                Type a keyword, <span className="text-accent">#hashtag</span>, or use search modifiers.
              </p>
              <p className="text-text-dim text-[11px] opacity-70">
                Full-text search uses dedicated search relays. Hashtag and keyword results are combined.
              </p>
            </div>

            {/* Search syntax help */}
            <div className="max-w-md mx-auto">
              <h3 className="text-text-dim text-[10px] uppercase tracking-widest mb-2">Search modifiers</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
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
              <p className="text-text-dim text-[10px] mt-2 opacity-60">
                Combine freely: <span className="font-mono text-text-muted">bitcoin by:dergigi has:image since:2026-01-01</span>
              </p>
            </div>
          </div>
        )}

        {/* Trending hashtags */}
        {!searched && !loading && (trending.length > 0 || trendingLoading) && (
          <div className="border-t border-border px-4 py-4">
            <h3 className="text-text-dim text-[10px] uppercase tracking-widest mb-2">Trending now</h3>
            {trendingLoading && (
              <p className="text-text-dim text-[11px]">Loading trends…</p>
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
                  className="px-2.5 py-1 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
                >
                  #{t.tag} <span className="text-text-dim text-[10px]">({t.count})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Discover — follow suggestions */}
        {!searched && !loading && loggedIn && (
          <div className="border-t border-border">
            <div className="px-4 py-2.5 border-b border-border">
              <h3 className="text-text text-[12px] font-medium">Discover people</h3>
              <p className="text-text-dim text-[10px] mt-0.5">Based on who your follows follow</p>
            </div>
            {suggestionsLoading && (
              <div className="px-4 py-6 text-text-dim text-[11px] text-center">Finding suggestions...</div>
            )}
            {visibleSuggestions.map((s) => s.profile && (
              <div key={s.pubkey} className="flex items-center gap-3 px-4 py-2.5 border-b border-border hover:bg-bg-hover transition-colors group/suggestion">
                <div className="shrink-0 cursor-pointer" onClick={() => useUIStore.getState().openProfile(s.pubkey)}>
                  {s.profile.picture ? (
                    <img src={s.profile.picture} alt="" className="w-9 h-9 rounded-sm object-cover bg-bg-raised"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-9 h-9 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs">
                      {(s.profile.displayName || s.profile.name || "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => useUIStore.getState().openProfile(s.pubkey)}>
                  <div className="text-text text-[13px] font-medium truncate">
                    {s.profile.displayName || s.profile.name || shortenPubkey(s.pubkey)}
                  </div>
                  <div className="text-text-dim text-[10px]">
                    {s.mutualCount} mutual follow{s.mutualCount !== 1 ? "s" : ""}
                    {s.profile.nip05 && <span className="ml-2">{s.profile.nip05}</span>}
                  </div>
                  {s.profile.about && (
                    <div className="text-text-dim text-[11px] truncate mt-0.5">{s.profile.about}</div>
                  )}
                </div>
                <SuggestionFollowButton pubkey={s.pubkey} />
                <button
                  onClick={() => dismiss(s.pubkey)}
                  className="text-text-dim hover:text-danger text-[14px] opacity-0 group-hover/suggestion:opacity-100 transition-opacity shrink-0 px-1"
                  title="Don't suggest again"
                >
                  ×
                </button>
              </div>
            ))}
            {suggestionsLoaded && visibleSuggestions.length === 0 && (
              <div className="px-4 py-6 text-text-dim text-[11px] text-center">
                Follow more people to see suggestions here.
              </div>
            )}
          </div>
        )}

        {/* Zero results */}
        {searched && totalResults === 0 && (
          <div className="px-4 py-8 text-center space-y-3">
            <p className="text-text-dim text-[12px]">
              No results for <span className="text-text font-medium">{query}</span>.
            </p>
            <p className="text-text-dim text-[11px] opacity-70">
              Try different keywords, a #hashtag, or check your relay connections.
            </p>
          </div>
        )}

        {/* People tab — zero results hint */}
        {searched && activeTab === "people" && userResults.length === 0 && totalResults > 0 && (
          <div className="px-4 py-6 text-center">
            <p className="text-text-dim text-[12px]">No people found for <span className="text-text">{query}</span>.</p>
          </div>
        )}

        {/* People results */}
        {activeTab === "people" && userResults.map((user) => (
          <UserRow key={user.pubkey} user={user} />
        ))}

        {/* Articles results */}
        {activeTab === "articles" && articleResults.map((event) => (
          <ArticleCard key={event.id} event={event} />
        ))}

        {/* Notes results */}
        {activeTab === "notes" && noteResults.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
