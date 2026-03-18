import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useBookmarkStore } from "../../stores/bookmark";
import { useUserStore } from "../../stores/user";
import { fetchNoteById, fetchByAddr } from "../../lib/nostr";
import { NoteCard } from "../feed/NoteCard";
import { ArticleCard } from "../article/ArticleCard";
import { SkeletonNoteList } from "../shared/Skeleton";

type BookmarkTab = "notes" | "articles";

export function BookmarkView() {
  const { bookmarkedIds, bookmarkedArticleAddrs, fetchBookmarks } = useBookmarkStore();
  const { pubkey } = useUserStore();
  const [tab, setTab] = useState<BookmarkTab>("notes");
  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [articles, setArticles] = useState<NDKEvent[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingArticles, setLoadingArticles] = useState(false);

  useEffect(() => {
    if (pubkey) fetchBookmarks(pubkey);
  }, [pubkey]);

  useEffect(() => {
    if (bookmarkedIds.length === 0) {
      setNotes([]);
      return;
    }
    loadNotes();
  }, [bookmarkedIds]);

  useEffect(() => {
    if (bookmarkedArticleAddrs.length === 0) {
      setArticles([]);
      return;
    }
    loadArticles();
  }, [bookmarkedArticleAddrs]);

  const loadNotes = async () => {
    setLoadingNotes(true);
    try {
      const results = await Promise.all(
        bookmarkedIds.map((id) => fetchNoteById(id))
      );
      setNotes(
        results
          .filter((e): e is NDKEvent => e !== null)
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
      );
    } finally {
      setLoadingNotes(false);
    }
  };

  const loadArticles = async () => {
    setLoadingArticles(true);
    try {
      const results = await Promise.all(
        bookmarkedArticleAddrs.map((addr) => fetchByAddr(addr))
      );
      setArticles(
        results
          .filter((e): e is NDKEvent => e !== null)
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
      );
    } finally {
      setLoadingArticles(false);
    }
  };

  const totalCount = bookmarkedIds.length + bookmarkedArticleAddrs.length;
  const loading = tab === "notes" ? loadingNotes : loadingArticles;
  const items = tab === "notes" ? notes : articles;

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-4 py-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-text text-[13px] font-medium">Bookmarks</h2>
            <div className="flex border border-border text-[11px]">
              <button
                onClick={() => setTab("notes")}
                className={`px-3 py-0.5 transition-colors ${tab === "notes" ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text"}`}
              >
                Notes
              </button>
              <button
                onClick={() => setTab("articles")}
                className={`px-3 py-0.5 transition-colors ${tab === "articles" ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text"}`}
              >
                Articles
              </button>
            </div>
          </div>
          <span className="text-text-dim text-[11px]">{totalCount} saved</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && items.length === 0 && (
          <SkeletonNoteList count={3} />
        )}

        {!loading && items.length === 0 && (
          <div className="px-4 py-12 text-center space-y-2">
            <p className="text-text-dim text-[13px]">
              {tab === "notes" ? "No bookmarked notes." : "No bookmarked articles."}
            </p>
            <p className="text-text-dim text-[11px] opacity-60">
              {tab === "notes"
                ? <>Use the <span className="text-accent">save</span> button on any note to bookmark it here.</>
                : <>Use the <span className="text-accent">save</span> button on any article to add it to your reading list.</>
              }
            </p>
          </div>
        )}

        {tab === "notes" && notes.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}

        {tab === "articles" && articles.map((event) => (
          <ArticleCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
