import { useEffect, useState } from "react";
import { useFeedStore } from "../../stores/feed";
import { useUserStore } from "../../stores/user";
import { fetchFollowFeed } from "../../lib/nostr";
import { NoteCard } from "./NoteCard";
import { ComposeBox } from "./ComposeBox";
import { NDKEvent } from "@nostr-dev-kit/ndk";

type FeedTab = "global" | "following";

export function Feed() {
  const { notes, loading, connected, error, connect, loadFeed } = useFeedStore();
  const { loggedIn, follows } = useUserStore();

  const [tab, setTab] = useState<FeedTab>("global");
  const [followNotes, setFollowNotes] = useState<NDKEvent[]>([]);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
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
    const c = event.content.trim();
    return c.length > 0 && !c.startsWith("{") && !c.startsWith("[");
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
      {loggedIn && <ComposeBox onPublished={loadFeed} />}

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {error && !isFollowing && (
          <div className="px-4 py-3 text-danger text-[12px] border-b border-border bg-danger/5">
            {error}
          </div>
        )}

        {isLoading && filteredNotes.length === 0 && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">
            {isFollowing ? "Loading notes from people you follow…" : "Connecting to relays…"}
          </div>
        )}

        {!isLoading && filteredNotes.length === 0 && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">
            {isFollowing && follows.length === 0
              ? "You're not following anyone yet."
              : "No notes yet."}
          </div>
        )}

        {filteredNotes.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
