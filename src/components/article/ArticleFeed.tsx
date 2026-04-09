import { useState, useEffect } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { fetchArticleFeed, getNDK } from "../../lib/nostr";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { dbLoadArticles, dbSaveNotes } from "../../lib/db";
import { ArticleCard } from "./ArticleCard";

type ArticleTab = "latest" | "following";

export function ArticleFeed() {
  const { loggedIn, follows } = useUserStore();
  const { setView } = useUIStore();
  const [tab, setTab] = useState<ArticleTab>("latest");
  const [articles, setArticles] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Track follows length to avoid re-fetching latest when follows change
  const followsKey = tab === "following" ? follows.join(",") : "latest";

  useEffect(() => {
    if (tab === "following" && follows.length === 0) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      // 1) Instant: load from SQLite cache (latest tab only — following is filtered)
      if (tab === "latest") {
        const cached = await dbLoadArticles(40);
        if (!cancelled && cached.length > 0) {
          const ndk = getNDK();
          const events = cached
            .map((raw) => { try { return new NDKEvent(ndk, JSON.parse(raw)); } catch { return null; } })
            .filter((e): e is NDKEvent => e !== null)
            .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
          if (events.length > 0) {
            setArticles(events);
            setLoading(false);
          }
        }
      }

      // 2) Background: fetch from relays and merge
      const authors = tab === "following" ? follows : undefined;
      try {
        const result = await fetchArticleFeed(40, authors);
        if (!cancelled) {
          setArticles(result);
          // Save to notes table for next time
          if (result.length > 0) {
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
        <h1 className="text-text text-sm font-medium">Articles</h1>
        <button
          onClick={() => setView("article-editor")}
          className="text-[11px] px-3 py-1 border border-accent/60 text-accent hover:bg-accent hover:text-accent-text transition-colors"
        >
          write article
        </button>
      </header>

      {/* Tabs */}
      <div className="border-b border-border flex shrink-0">
        {(["latest", "following"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            disabled={t === "following" && !loggedIn}
            className={`px-4 py-2 text-[11px] border-b-2 transition-colors ${
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
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">Loading articles…</div>
        )}

        {!loading && articles.length === 0 && (
          <div className="px-4 py-8 text-center space-y-2">
            <p className="text-text-dim text-[12px]">
              {tab === "following"
                ? "No articles from people you follow yet."
                : "No articles found on your relays."}
            </p>
            {tab === "following" && (
              <p className="text-text-dim text-[10px]">
                Try the "latest" tab to discover writers, then follow them.
              </p>
            )}
          </div>
        )}

        {articles.map((event) => (
          <ArticleCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
