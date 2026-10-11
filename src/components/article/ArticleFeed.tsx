import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { NDKEvent, type NDKUserProfile } from "@nostr-dev-kit/ndk";
import { fetchArticleFeed, fetchProfiles, getNDK } from "../../lib/nostr";
import { useUserStore, useCanSign } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { useMuteStore } from "../../stores/mute";
import { useWoTStore } from "../../stores/wot";
import { dbLoadArticles, dbSaveNotes } from "../../lib/db";
import { peekCachedProfile, primeProfileCache } from "../../hooks/useProfile";
import { shouldShowArticle, type AuthorProfile, type ProfileLookup } from "../../lib/articleFilters";
import { ArticleCard } from "./ArticleCard";

type ArticleTab = "latest" | "following";

// Latest is filtered hard (see articleFilters.ts), so ask for more than we
// expect to show: of 80 sampled on 2026-10-11, 8 survived.
const LATEST_LIMIT = 100;
const FOLLOWING_LIMIT = 40;

export function ArticleFeed() {
  const canSign = useCanSign();
  const { loggedIn, follows } = useUserStore();
  const { setView } = useUIStore();
  const mutedPubkeyList = useMuteStore((s) => s.mutedPubkeys);
  const contentMatchesMutedKeyword = useMuteStore((s) => s.contentMatchesMutedKeyword);
  const languageFilter = useUIStore((s) => s.feedLanguageFilter);
  const hideRssArticles = useUIStore((s) => s.hideRssArticles);
  const wotEnabled = useWoTStore((s) => s.enabled);
  const wotSet = useWoTStore((s) => s.wotSet);
  const [tab, setTab] = useState<ArticleTab>("latest");
  const [articles, setArticles] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Author profiles for the Latest tab's "has a profile" rule. Kept in a ref
  // as well so the async resolver can see what is already known without
  // closing over stale state.
  const [profiles, setProfiles] = useState<Map<string, AuthorProfile | null>>(() => new Map());
  const profilesRef = useRef(profiles);
  const [resolvingProfiles, setResolvingProfiles] = useState(false);
  // Only the newest resolver run may clear the flag: a run cancelled by a tab
  // switch must not flip it while its successor is still fetching, and a
  // successor with nothing to resolve must still clear it.
  const resolveSeq = useRef(0);

  const mergeProfiles = useCallback((next: Map<string, AuthorProfile | null>) => {
    if (next.size === 0) return;
    const merged = new Map(profilesRef.current);
    for (const [pk, p] of next) merged.set(pk, p);
    profilesRef.current = merged;
    setProfiles(merged);
  }, []);

  /**
   * Resolve profiles for every author we have not seen yet: memory/SQLite
   * first (instant), then one batched relay fetch for the rest. Authors the
   * relays return nothing for are recorded as null, which Latest hides.
   */
  const resolveProfiles = useCallback(
    async (events: NDKEvent[], isCancelled: () => boolean) => {
      const runId = ++resolveSeq.current;
      const pubkeys = Array.from(new Set(events.map((e) => e.pubkey))).filter(
        (pk) => !profilesRef.current.has(pk),
      );
      if (pubkeys.length === 0) {
        setResolvingProfiles(false);
        return;
      }
      setResolvingProfiles(true);
      try {
        const known = new Map<string, AuthorProfile | null>();
        const peeked = await Promise.all(
          pubkeys.map(async (pk) => [pk, await peekCachedProfile(pk)] as const),
        );
        for (const [pk, p] of peeked) {
          if (p !== undefined) known.set(pk, (p as AuthorProfile | null) ?? null);
        }
        if (isCancelled()) return;
        mergeProfiles(known);

        const missing = pubkeys.filter((pk) => !known.has(pk));
        if (missing.length === 0) return;
        let fetched: Map<string, NDKUserProfile>;
        try {
          fetched = await fetchProfiles(missing);
        } catch {
          // The whole batch failed (relays unreachable), which says nothing
          // about any author. Leave them unknown so the next run asks again
          // instead of recording "no profile" for the life of the view.
          return;
        }
        if (isCancelled()) return;
        const resolved = new Map<string, AuthorProfile | null>();
        for (const pk of missing) {
          const p = fetched.get(pk) ?? null;
          resolved.set(pk, p);
          if (p) primeProfileCache(pk, p);
        }
        mergeProfiles(resolved);
      } finally {
        if (resolveSeq.current === runId) setResolvingProfiles(false);
      }
    },
    [mergeProfiles],
  );

  // Track follows length to avoid re-fetching latest when follows change
  const followsKey = tab === "following" ? follows.join(",") : "latest";

  useEffect(() => {
    if (tab === "following" && follows.length === 0) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    setLoading(true);

    (async () => {
      // 1) Instant: load from SQLite cache (latest tab only — following is filtered)
      if (tab === "latest") {
        const cached = await dbLoadArticles(LATEST_LIMIT);
        if (!cancelled && cached.length > 0) {
          const ndk = getNDK();
          const events = cached
            .map((raw) => { try { return new NDKEvent(ndk, JSON.parse(raw)); } catch { return null; } })
            .filter((e): e is NDKEvent => e !== null)
            .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
          if (events.length > 0) {
            setArticles(events);
            setLoading(false);
            void resolveProfiles(events, isCancelled);
          }
        }
      }

      // 2) Background: fetch from relays and merge
      const authors = tab === "following" ? follows : undefined;
      try {
        const result = await fetchArticleFeed(tab === "latest" ? LATEST_LIMIT : FOLLOWING_LIMIT, authors);
        if (!cancelled) {
          setArticles(result);
          if (tab === "latest") {
            await resolveProfiles(result, isCancelled);
            if (cancelled) return;
            // Cache only what passed the author rules, so the instant path
            // next time is not a page of spam that then filters down to nothing.
            const keep = result.filter((e) => {
              const p = profilesRef.current.get(e.pubkey);
              return p !== null && p !== undefined;
            });
            if (keep.length > 0) dbSaveNotes(keep.map((e) => JSON.stringify(e.rawEvent())));
          } else if (result.length > 0) {
            dbSaveNotes(result.map((e) => JSON.stringify(e.rawEvent())));
          }
        }
      } catch {
        if (!cancelled && articles.length === 0) setArticles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [followsKey]);

  const mutedPubkeys = useMemo(() => new Set(mutedPubkeyList), [mutedPubkeyList]);

  const visible = useMemo(
    () =>
      articles.filter((event) =>
        shouldShowArticle(event, {
          tab,
          mutedPubkeys,
          contentMatchesMutedKeyword,
          languageFilter,
          hideRssBridges: hideRssArticles,
          wotSet: wotEnabled ? wotSet : undefined,
          profile: profiles.get(event.pubkey) as ProfileLookup,
        }),
      ),
    [articles, tab, mutedPubkeys, contentMatchesMutedKeyword, languageFilter, hideRssArticles, wotEnabled, wotSet, profiles],
  );

  // Latest holds articles back until their author is known, so "nothing yet"
  // while profiles resolve is loading, not emptiness.
  const showLoading = loading || (tab === "latest" && visible.length === 0 && resolvingProfiles);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border-subtle px-4 py-2.5 flex items-center justify-between shrink-0">
        <h1 className="text-text text-title font-medium">Articles</h1>
        {canSign && (
          <button
            onClick={() => setView("article-editor")}
            className="text-ui px-3 py-1 border border-accent/60 text-accent hover:bg-accent hover:text-accent-text transition-colors rounded-sm"
          >
            Write article
          </button>
        )}
      </header>

      {/* Tabs */}
      <div className="border-b border-border-subtle flex shrink-0">
        {(["latest", "following"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            disabled={t === "following" && !loggedIn}
            className={`px-4 py-2 text-ui border-b-2 transition-colors ${
              tab === t
                ? "border-accent text-accent"
                : "border-transparent text-text-dim hover:text-text"
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Articles list */}
      <div className="flex-1 overflow-y-auto content-column">
        {showLoading && (
          <div className="px-4 py-8 text-text-dim text-body text-center">Loading articles…</div>
        )}

        {!showLoading && visible.length === 0 && (
          <div className="px-4 py-8 text-center space-y-2">
            <p className="text-text-dim text-body">
              {tab === "following"
                ? "No articles from people you follow yet."
                : articles.length > 0
                  ? "Nothing left after your filters."
                  : "No articles found on your relays."}
            </p>
            {tab === "following" && (
              <p className="text-text-dim text-caption">
                Try the "latest" tab to discover writers, then follow them.
              </p>
            )}
            {tab === "latest" && articles.length > 0 && (
              <p className="text-text-dim text-caption">
                Latest leaves out muted authors and keywords, accounts without a profile
                {hideRssArticles ? ", and RSS reposts" : ""}. Adjust these in Settings.
              </p>
            )}
          </div>
        )}

        {!showLoading && visible.map((event) => (
          <ArticleCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
