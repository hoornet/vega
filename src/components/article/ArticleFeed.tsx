import { useState, useEffect } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { fetchArticleFeed } from "../../lib/nostr";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { ArticleCard } from "./ArticleCard";

type ArticleTab = "latest" | "following";

export function ArticleFeed() {
  const { loggedIn, follows } = useUserStore();
  const { setView } = useUIStore();
  const [tab, setTab] = useState<ArticleTab>("latest");
  const [articles, setArticles] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const authors = tab === "following" ? follows : undefined;
    fetchArticleFeed(40, authors)
      .then(setArticles)
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, [tab, follows]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
        <h1 className="text-text text-sm font-medium">Articles</h1>
        <button
          onClick={() => setView("article-editor")}
          className="text-[11px] px-3 py-1 border border-accent/60 text-accent hover:bg-accent hover:text-white transition-colors"
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
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">Loading articles...</div>
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
