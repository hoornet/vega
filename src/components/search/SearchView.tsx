import { useState, useRef, useEffect } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { searchNotes, searchUsers, searchArticles, getStoredRelayUrls, fetchFollowSuggestions, fetchProfile } from "../../lib/nostr";
import { getNip50Relays } from "../../lib/nostr/relayInfo";
import { useUserStore } from "../../stores/user";
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
  const [nip50Relays, setNip50Relays] = useState<string[] | null>(null); // null = not checked yet
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  const isHashtag = query.trim().startsWith("#");

  // Check relay NIP-50 support once on mount (background, non-blocking)
  useEffect(() => {
    const urls = getStoredRelayUrls();
    getNip50Relays(urls).then(setNip50Relays);
  }, []);

  const { loggedIn, follows } = useUserStore();

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
    const q = (overrideQuery ?? query).trim();
    if (!q) return;
    if (overrideQuery) setQuery(overrideQuery);
    setLoading(true);
    setSearched(false);
    try {
      const isTag = q.startsWith("#");
      const [notes, userEvents, articleEvents] = await Promise.all([
        searchNotes(q),
        isTag ? Promise.resolve([]) : searchUsers(q),
        searchArticles(q),
      ]);
      setNoteResults(notes);
      setUserResults(userEvents.map(parseUserEvent));
      setArticleResults(articleEvents);
      setActiveTab(notes.length > 0 ? "notes" : articleEvents.length > 0 ? "articles" : "people");
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  // Switch query to hashtag format and re-run
  const tryAsHashtag = () => {
    const raw = query.trim().replace(/^#+/, "");
    const hashQuery = `#${raw}`;
    setQuery(hashQuery);
    handleSearch(hashQuery);
  };

  const totalResults = noteResults.length + userResults.length + articleResults.length;
  const allRelays = getStoredRelayUrls();
  const nip50Count = nip50Relays?.length ?? null;
  const noNip50 = nip50Relays !== null && nip50Relays.length === 0;

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
            placeholder="search notes, #hashtags, or people…"
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

      {/* Tabs — shown once a search has been run (except for hashtag, which is notes-only) */}
      {searched && !isHashtag && (
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

      {/* Results area */}
      <div className="flex-1 overflow-y-auto">

        {/* Idle / pre-search hint */}
        {!searched && !loading && (
          <div className="px-4 py-8 text-center space-y-2">
            <p className="text-text-dim text-[12px]">
              Use <span className="text-accent">#hashtag</span> to browse topics, or type a keyword for full-text search.
            </p>
            {nip50Relays !== null && (
              <p className="text-text-dim text-[11px] opacity-70">
                {nip50Count === 0
                  ? "None of your relays support full-text search — #hashtag search always works."
                  : `${nip50Count} of ${allRelays.length} relay${allRelays.length !== 1 ? "s" : ""} support full-text search.`}
              </p>
            )}
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
            {suggestions.map((s) => s.profile && (
              <div key={s.pubkey} className="flex items-center gap-3 px-4 py-2.5 border-b border-border hover:bg-bg-hover transition-colors">
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
              </div>
            ))}
            {suggestionsLoaded && suggestions.length === 0 && (
              <div className="px-4 py-6 text-text-dim text-[11px] text-center">
                Follow more people to see suggestions here.
              </div>
            )}
          </div>
        )}

        {/* Zero results for full-text search */}
        {searched && totalResults === 0 && !isHashtag && (
          <div className="px-4 py-8 text-center space-y-3">
            <p className="text-text-dim text-[12px]">
              No results for <span className="text-text font-medium">{query}</span>.
            </p>

            {/* Relay NIP-50 status */}
            {nip50Relays !== null && (
              <p className="text-text-dim text-[11px]">
                {noNip50
                  ? "None of your relays support full-text search."
                  : `${nip50Count} of ${allRelays.length} relay${allRelays.length !== 1 ? "s" : ""} support full-text search.`}
              </p>
            )}

            {/* Hashtag suggestion */}
            {!query.startsWith("#") && (
              <div>
                <p className="text-text-dim text-[11px] mb-2">Try a hashtag search instead:</p>
                <button
                  onClick={tryAsHashtag}
                  className="px-3 py-1.5 text-[12px] border border-accent/50 text-accent hover:bg-accent hover:text-white transition-colors"
                >
                  Search #{query.replace(/^#+/, "")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Zero results for hashtag search */}
        {searched && totalResults === 0 && isHashtag && (
          <div className="px-4 py-8 text-center">
            <p className="text-text-dim text-[12px]">No notes found for <span className="text-text">{query}</span>.</p>
            <p className="text-text-dim text-[11px] mt-1 opacity-70">Try a different hashtag or check your relay connections.</p>
          </div>
        )}

        {/* People tab — zero results hint */}
        {searched && activeTab === "people" && userResults.length === 0 && totalResults > 0 && (
          <div className="px-4 py-6 text-center">
            <p className="text-text-dim text-[12px]">No people found for <span className="text-text">{query}</span>.</p>
            {noNip50 && (
              <p className="text-text-dim text-[11px] mt-1 opacity-70">People search requires NIP-50 relay support.</p>
            )}
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
        {(activeTab === "notes" || isHashtag) && noteResults.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
