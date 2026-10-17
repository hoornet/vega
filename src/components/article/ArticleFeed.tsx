import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { NDKEvent, type NDKUserProfile } from "@nostr-dev-kit/ndk";
import { fetchArticleFeed, fetchProfiles, getNDK } from "../../lib/nostr";
import { useUserStore, useCanSign } from "../../stores/user";
import { useUIStore, hasChosenArticlesTab, type ArticlesTab } from "../../stores/ui";
import { useMuteStore } from "../../stores/mute";
import { useWoTStore } from "../../stores/wot";
import { dbLoadArticles, dbSaveNotes } from "../../lib/db";
import { peekCachedProfile, primeProfileCache } from "../../hooks/useProfile";
import { shouldShowArticle, type AuthorProfile, type ProfileLookup } from "../../lib/articleFilters";
import { ArticleCard } from "./ArticleCard";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";
import { Button } from "../shared/Button";
import { ListState, stateWithoutRows, followListState } from "../shared/ListState";
import { fetchMark, wentUnanswered, type LoadOutcome } from "../../lib/listLoad";

interface ArticleList {
  /** What these are rows of: "latest", or the follow list they were asked for. */
  key: string;
  articles: NDKEvent[];
  loading: boolean;
  /** How the last relay fetch ended. "No articles" is only said when a relay answered. */
  outcome: LoadOutcome;
}
const NOT_ASKED: ArticleList = { key: "", articles: [], loading: true, outcome: "pending" };

// Latest is filtered hard (see articleFilters.ts), so ask for more than we
// expect to show: of 80 sampled on 2026-10-11, 8 survived.
const LATEST_LIMIT = 100;
const FOLLOWING_LIMIT = 40;

export function ArticleFeed() {
  const canSign = useCanSign();
  const { loggedIn, follows, followsStatus, fetchFollows } = useUserStore();
  const { setView, articlesTab, setArticlesTab } = useUIStore();
  // Following needs an account. Signed out it is Latest, decided here and not
  // written to the store: while a session is still being restored the user is
  // not signed in yet either, and a store write then kept them on Latest.
  const tab: ArticlesTab = loggedIn ? articlesTab : "latest";
  const mutedPubkeyList = useMuteStore((s) => s.mutedPubkeys);
  const contentMatchesMutedKeyword = useMuteStore((s) => s.contentMatchesMutedKeyword);
  const languageFilter = useUIStore((s) => s.feedLanguageFilter);
  const hideRssArticles = useUIStore((s) => s.hideRssArticles);
  const wotEnabled = useWoTStore((s) => s.enabled);
  const wotSet = useWoTStore((s) => s.wotSet);
  // The rows, with what they are rows of: a tab, and on Following a follow
  // list. A load nobody answers keeps the rows it finds, so they must be this
  // list's own: Latest's articles were once kept "from before" under
  // Following, where the laxer filter also showed the spam Latest hides.
  const [list, setList] = useState<ArticleList>(NOT_ASKED);
  const [reloadKey, setReloadKey] = useState(0);

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
  // Read during render, so a tab switch shows the new tab as not asked at
  // once, and never one frame of the other tab's rows, loading flag or outcome.
  const { articles, loading, outcome } = list.key === followsKey ? list : NOT_ASKED;

  // An account that follows nobody is sent to Latest, where the writers are,
  // once the follow list has actually loaded empty: not while it loads, and
  // not when it could not be loaded. Not the user's choice, so not remembered.
  useEffect(() => {
    if (tab !== "following") return;
    if (followsStatus === "loaded" && follows.length === 0 && !hasChosenArticlesTab()) setArticlesTab("latest", { remember: false });
  }, [tab, followsStatus, follows.length, setArticlesTab]);

  useEffect(() => {
    if (tab === "following" && follows.length === 0) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    const key = followsKey;
    /** Change this list. Another list's rows are dropped, not carried over. */
    const put = (patch: Partial<ArticleList>) =>
      setList((prev) => ({ ...(prev.key === key ? prev : NOT_ASKED), key, ...patch }));
    put({ loading: true });
    const mark = fetchMark();

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
            put({ articles: events, loading: false });
            void resolveProfiles(events, isCancelled);
          }
        }
      }

      // 2) Background: fetch from relays and merge
      const authors = tab === "following" ? follows : undefined;
      try {
        const result = await fetchArticleFeed(tab === "latest" ? LATEST_LIMIT : FOLLOWING_LIMIT, authors);
        if (!cancelled && result.length === 0 && wentUnanswered(mark)) {
          // Nobody answered. Whatever this list already shows stays there
          // (the cache, or what an earlier load found): an empty result used
          // to replace it, and the list went blank.
          put({ outcome: "unreachable" });
        } else if (!cancelled) {
          put({ articles: result, outcome: "answered" });
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
        if (!cancelled) put({ outcome: "error" });
      } finally {
        if (!cancelled) put({ loading: false });
      }
    })();

    return () => { cancelled = true; };
  }, [followsKey, reloadKey]);

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
      <ViewHeader
        title="Articles"
        actions={canSign ? (
          <Button onClick={() => setView("article-editor")}>Write article</Button>
        ) : undefined}
      />
      <Tabs
        label="Articles"
        panel="articles-panel"
        tabs={[
          { id: "following", label: "Following", disabled: !loggedIn },
          { id: "latest", label: "Latest" },
        ] satisfies { id: ArticlesTab; label: string; disabled?: boolean }[]}
        value={tab}
        onChange={(id) => setArticlesTab(id)}
      />

      {/* Articles list */}
      <div {...tabPanelProps("articles-panel", tab)} className="flex-1 overflow-y-auto content-column">
        {/* Following needs the follow list. Until it has loaded, "no articles from people you follow" is not known. */}
        {tab === "following" && follows.length === 0 ? (
          <ListState
            state={followListState(followsStatus)}
            loadingLabel="Loading the people you follow…"
            empty="You're not following anyone yet."
            emptyHint="Try the Latest tab to discover writers, then follow them."
            what="the list of people you follow"
            onRetry={() => void fetchFollows()}
          />
        ) : (showLoading || visible.length === 0) ? (
          <ListState
            state={stateWithoutRows(showLoading, articles.length, outcome)}
            loadingLabel="Loading articles…"
            empty={tab === "following"
              ? "No articles from people you follow yet."
              : articles.length > 0
                ? "Nothing left after your filters."
                : "No articles found on your relays."}
            emptyHint={tab === "following"
              ? "Try the Latest tab to discover writers, then follow them."
              : articles.length > 0
                ? `Latest leaves out muted authors and keywords, accounts without a profile${hideRssArticles ? ", and automatic news reposts" : ""}. Adjust these in Settings.`
                : undefined}
            what="articles"
            onRetry={() => setReloadKey((n) => n + 1)}
          />
        ) : (
          visible.map((event) => <ArticleCard key={event.id} event={event} />)
        )}
      </div>
    </div>
  );
}
