import { useEffect, useState } from "react";
import { useFeedStore } from "../../stores/feed";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useUIStore } from "../../stores/ui";
import { fetchFollowFeed, getNDK } from "../../lib/nostr";
import { detectScript, getEventLanguageTag, FILTER_SCRIPTS } from "../../lib/language";
import { NoteCard } from "./NoteCard";
import { ComposeBox } from "./ComposeBox";
import { SkeletonNoteList } from "../shared/Skeleton";
import { NDKEvent } from "@nostr-dev-kit/ndk";

export function Feed() {
  const { notes, loading, connected, error, connect, loadCachedFeed, loadFeed, focusedNoteIndex } = useFeedStore();
  const { loggedIn, follows } = useUserStore();
  const { mutedPubkeys } = useMuteStore();
  const { feedTab: tab, setFeedTab: setTab, feedLanguageFilter, setFeedLanguageFilter } = useUIStore();
  const [followNotes, setFollowNotes] = useState<NDKEvent[]>([]);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    // Show cached notes immediately, then fetch fresh ones once connected
    loadCachedFeed();
    connect().then(() => loadFeed());
  }, []);


  useEffect(() => {
    if (tab === "following" && loggedIn && follows.length > 0) {
      loadFollowFeed();
    }
  }, [tab, follows]);

  const loadFollowFeed = async () => {
    setFollowLoading(true);
    try {
      const events = await fetchFollowFeed(follows);
      setFollowNotes(events);
    } finally {
      setFollowLoading(false);
    }
  };

  const isFollowing = tab === "following";
  const activeNotes = isFollowing ? followNotes : notes;
  const isLoading = isFollowing ? followLoading : loading;

  const filteredNotes = activeNotes.filter((event) => {
    if (mutedPubkeys.includes(event.pubkey)) return false;
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
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
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
        </div>
        <div className="flex items-center gap-3">
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
          {connected && (
            <span className="text-success text-[11px] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
              connected
            </span>
          )}
          <button
            onClick={isFollowing ? loadFollowFeed : loadFeed}
            disabled={isLoading}
            className="text-text-muted hover:text-text text-[11px] px-2 py-1 border border-border hover:border-text-dim transition-colors disabled:opacity-40"
          >
            {isLoading ? "loading…" : "refresh"}
          </button>
        </div>
      </header>

      {/* Compose */}
      {loggedIn && !!getNDK().signer && (
        <ComposeBox onPublished={isFollowing ? undefined : loadFeed} onNoteInjected={isFollowing ? (event) => setFollowNotes((prev) => [event, ...prev]) : undefined} />
      )}

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {error && !isFollowing && (
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
              {isFollowing && follows.length === 0
                ? "You're not following anyone yet."
                : feedLanguageFilter
                  ? `No ${feedLanguageFilter} notes found.`
                  : "No notes to show."}
            </p>
            <p className="text-text-dim text-[11px] opacity-60">
              {isFollowing && follows.length === 0
                ? "Use search to find people to follow."
                : feedLanguageFilter
                  ? "Try clearing the script filter or refreshing."
                  : "Try refreshing or switching tabs."}
            </p>
          </div>
        )}

        {filteredNotes.map((event, index) => (
          <NoteCard key={event.id} event={event} focused={focusedNoteIndex === index} />
        ))}
      </div>
    </div>
  );
}
