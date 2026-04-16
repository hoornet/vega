import { useEffect, useState, useCallback } from "react";
import { useFeedStore } from "../../stores/feed";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useUIStore } from "../../stores/ui";
import { useWoTStore } from "../../stores/wot";
import { fetchFollowFeed, getNDK, ensureConnected } from "../../lib/nostr";
import { diagWrapFetch, logDiag } from "../../lib/feedDiagnostics";
import { detectScript, getEventLanguageTag, FILTER_SCRIPTS } from "../../lib/language";
import { NoteCard } from "./NoteCard";
import { ArticleCard } from "../article/ArticleCard";
import { ComposeBox } from "./ComposeBox";
import { SkeletonNoteList } from "../shared/Skeleton";
import { RelayStatusBadge } from "./RelayStatusBadge";
import { NDKEvent } from "@nostr-dev-kit/ndk";

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export function Feed() {
  const notes = useFeedStore((s) => s.notes);
  const pendingNotes = useFeedStore((s) => s.pendingNotes);
  const flushPendingNotes = useFeedStore((s) => s.flushPendingNotes);
  const loading = useFeedStore((s) => s.loading);
  const error = useFeedStore((s) => s.error);
  const connect = useFeedStore((s) => s.connect);
  const loadCachedFeed = useFeedStore((s) => s.loadCachedFeed);
  const loadFeed = useFeedStore((s) => s.loadFeed);
  const trendingNotes = useFeedStore((s) => s.trendingNotes);
  const trendingLoading = useFeedStore((s) => s.trendingLoading);
  const loadTrendingFeed = useFeedStore((s) => s.loadTrendingFeed);
  const focusedNoteIndex = useFeedStore((s) => s.focusedNoteIndex);
  const lastUpdated = useFeedStore((s) => s.lastUpdated);
  const loggedIn = useUserStore((s) => s.loggedIn);
  const follows = useUserStore((s) => s.follows);
  const mutedPubkeys = useMuteStore((s) => s.mutedPubkeys);
  const contentMatchesMutedKeyword = useMuteStore((s) => s.contentMatchesMutedKeyword);
  const tab = useUIStore((s) => s.feedTab);
  const setTab = useUIStore((s) => s.setFeedTab);
  const openHashtag = useUIStore((s) => s.openHashtag);
  const feedLanguageFilter = useUIStore((s) => s.feedLanguageFilter);
  const setFeedLanguageFilter = useUIStore((s) => s.setFeedLanguageFilter);
  const wotEnabled = useWoTStore((s) => s.enabled);
  const wotSet = useWoTStore((s) => s.wotSet);
  const wotLoading = useWoTStore((s) => s.loading);
  const buildWoT = useWoTStore((s) => s.buildWoT);
  const myPubkey = useUserStore((s) => s.pubkey);
  const [followNotes, setFollowNotes] = useState<NDKEvent[]>([]);
  const [followLoading, setFollowLoading] = useState(false);
  const [, setTick] = useState(0);

  // Tick every 10s to keep "last updated" relative time fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Show cached notes immediately, then fetch fresh ones once connected
    loadCachedFeed();
    connect().then(() => loadFeed());
  }, []);


  useEffect(() => {
    if (tab === "following" && loggedIn && follows.length > 0) {
      loadFollowFeed();
    }
    if (tab === "trending") {
      loadTrendingFeed();
    }
  }, [tab, follows]);

  useEffect(() => {
    if (wotEnabled && myPubkey && follows.length > 0 && wotSet.size === 0 && !wotLoading) {
      buildWoT(myPubkey, follows);
    }
  }, [wotEnabled, myPubkey, follows]);

  const loadFollowFeed = useCallback(async () => {
    setFollowLoading(true);
    try {
      await ensureConnected();
      const events = await diagWrapFetch("follow_fetch", () => fetchFollowFeed(follows));
      setFollowNotes(events.slice(0, 30));
      const prev = useFeedStore.getState().lastUpdated;
      useFeedStore.setState({ lastUpdated: { ...prev, following: Date.now() } });
    } finally {
      setFollowLoading(false);
    }
  }, [follows]);

  const isFollowing = tab === "following";
  const isTrending = tab === "trending";
  const activeNotes = isTrending ? trendingNotes : isFollowing ? followNotes : notes;
  const isLoading = isTrending ? trendingLoading : isFollowing ? followLoading : loading;

  const filteredNotes = activeNotes.filter((event) => {
    if (mutedPubkeys.includes(event.pubkey)) return false;
    if (contentMatchesMutedKeyword(event.content)) return false;
    if (tab === "global" && wotEnabled && wotSet.size > 0 && !wotSet.has(event.pubkey)) return false;
    const c = event.content.trim();
    if (!c || c.startsWith("{") || c.startsWith("[")) return false;
    // Filter out notes that look like base64 blobs or relay protocol messages
    if (c.length > 500 && /^[A-Za-z0-9+/=]{50,}$/.test(c.slice(0, 100))) return false;
    if (c.startsWith("nlogpost:") || c.startsWith("T1772")) return false;
    // Language/script filter
    if (feedLanguageFilter) {
      const langTag = getEventLanguageTag(event.tags);
      if (langTag) {
        // Map ISO-639-1 codes to script names for comparison
        const langToScript: Record<string, string> = {
          en: "Latin", es: "Latin", fr: "Latin", de: "Latin", pt: "Latin", it: "Latin", nl: "Latin", pl: "Latin", sv: "Latin", da: "Latin", no: "Latin", fi: "Latin", ro: "Latin", tr: "Latin", cs: "Latin", hr: "Latin", hu: "Latin",
          zh: "CJK", ja: "CJK",
          ko: "Korean",
          ru: "Cyrillic", uk: "Cyrillic", bg: "Cyrillic", sr: "Cyrillic",
          ar: "Arabic", fa: "Arabic", ur: "Arabic",
          hi: "Devanagari", mr: "Devanagari", ne: "Devanagari",
          th: "Thai",
          he: "Hebrew",
          el: "Greek",
        };
        const script = langToScript[langTag];
        if (script && script !== feedLanguageFilter) return false;
      } else {
        const script = detectScript(c);
        if (script !== feedLanguageFilter) return false;
      }
    }
    return true;
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 flex flex-wrap items-center justify-between gap-y-1 shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab("global")}
            className={`px-3 py-1 text-[12px] transition-colors ${
              tab === "global"
                ? "text-text border-b-2 border-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            Global
          </button>
          {loggedIn && (
            <button
              onClick={() => setTab("following")}
              className={`px-3 py-1 text-[12px] transition-colors ${
                tab === "following"
                  ? "text-text border-b-2 border-accent"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Following
            </button>
          )}
          <button
            onClick={() => setTab("trending")}
            className={`px-3 py-1 text-[12px] transition-colors ${
              tab === "trending"
                ? "text-text border-b-2 border-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            Trending
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={feedLanguageFilter ?? ""}
            onChange={(e) => setFeedLanguageFilter(e.target.value || null)}
            className="bg-transparent text-text-dim text-[11px] border border-border px-1.5 py-0.5 focus:outline-none hover:border-text-dim transition-colors cursor-pointer"
          >
            <option value="">all scripts</option>
            {FILTER_SCRIPTS.map((s) => (
              <option key={s} value={s}>{s.toLowerCase()}</option>
            ))}
          </select>
          <RelayStatusBadge />
          {lastUpdated[tab] && (
            <span className="text-text-dim text-[11px]">{timeAgo(lastUpdated[tab])}</span>
          )}
          <button
            onClick={() => {
              logDiag({ ts: new Date().toISOString(), action: "refresh_click", details: `tab=${tab}` });
              (isTrending ? () => loadTrendingFeed(true) : isFollowing ? loadFollowFeed : loadFeed)();
            }}
            disabled={isLoading}
            className="text-text-muted hover:text-text text-[11px] px-2 py-1 border border-border hover:border-text-dim transition-colors disabled:opacity-40"
          >
            {isLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {/* Compose */}
      {loggedIn && !!getNDK().signer && (
        <ComposeBox onPublished={isFollowing ? undefined : loadFeed} onNoteInjected={isFollowing ? (event) => setFollowNotes((prev) => [event, ...prev]) : undefined} />
      )}

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {error && !isFollowing && !isTrending && (
          <div className="px-4 py-3 text-danger text-[12px] border-b border-border bg-danger/5">
            {error}
          </div>
        )}

        {isLoading && filteredNotes.length === 0 && (
          <SkeletonNoteList count={6} />
        )}

        {!isLoading && filteredNotes.length === 0 && (
          <div className="px-4 py-12 text-center space-y-2">
            <p className="text-text-dim text-[13px]">
              {isTrending
                ? "No trending notes right now."
                : isFollowing && follows.length === 0
                  ? "You're not following anyone yet."
                  : feedLanguageFilter
                    ? `No ${feedLanguageFilter} notes found.`
                    : "No notes to show."}
            </p>
            <p className="text-text-dim text-[11px] opacity-60">
              {isTrending
                ? "Check back in a bit."
                : isFollowing && follows.length === 0
                  ? "Use search to find people to follow."
                  : feedLanguageFilter
                    ? "Try clearing the script filter or refreshing."
                    : "Try refreshing or switching tabs."}
            </p>
            {isFollowing && follows.length === 0 && (() => {
              const stored = localStorage.getItem("wrystr_interests");
              const interests: string[] = stored ? JSON.parse(stored) : [];
              if (interests.length === 0) return null;
              return (
                <div className="pt-2">
                  <p className="text-text-dim text-[11px] mb-2">Explore your interests:</p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {interests.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => openHashtag(tag)}
                        className="px-2.5 py-1 text-[11px] border border-border text-text-dim hover:border-accent/40 hover:text-accent transition-colors"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* New notes banner — only shown on global tab */}
        {tab === "global" && pendingNotes.length > 0 && (
          <button
            onClick={flushPendingNotes}
            className="w-full py-2 text-[12px] text-accent border-b border-accent/20 bg-accent/5 hover:bg-accent/10 transition-colors"
          >
            {pendingNotes.length} new {pendingNotes.length === 1 ? "note" : "notes"} — click to load
          </button>
        )}

        {filteredNotes.map((event, index) =>
          event.kind === 30023 ? (
            <ArticleCard key={event.id} event={event} />
          ) : (
            <NoteCard key={event.id} event={event} focused={focusedNoteIndex === index} />
          )
        )}
      </div>
    </div>
  );
}
