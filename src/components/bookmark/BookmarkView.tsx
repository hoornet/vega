import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useBookmarkStore } from "../../stores/bookmark";
import { useUserStore } from "../../stores/user";
import { fetchNoteById, fetchByAddr, getNDK } from "../../lib/nostr";
import { dbLoadBookmarkedNotes, dbSaveBookmarkedNotes } from "../../lib/db";
import { NoteCard } from "../feed/NoteCard";
import { ArticleCard } from "../article/ArticleCard";
import { SkeletonNoteList } from "../shared/Skeleton";

type BookmarkTab = "notes" | "articles";

function ArticleCardWithReadStatus({ event }: { event: NDKEvent }) {
  const { isArticleRead, markArticleRead, markArticleUnread } = useBookmarkStore();
  const addr = event.tags.find((t) => t[0] === "d")?.[1];
  const fullAddr = addr ? `30023:${event.pubkey}:${addr}` : null;
  const isRead = fullAddr ? isArticleRead(fullAddr) : false;

  return (
    <div className="relative group">
      {!isRead && fullAddr && (
        <div className="absolute left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-accent z-10" title="Unread" />
      )}
      <ArticleCard key={event.id} event={event} />
      {fullAddr && (
        <button
          onClick={() => isRead ? markArticleUnread(fullAddr) : markArticleRead(fullAddr)}
          className="absolute right-3 top-3 text-[10px] text-text-dim hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity z-10"
        >
          {isRead ? "mark unread" : "mark read"}
        </button>
      )}
    </div>
  );
}

export function BookmarkView() {
  const { bookmarkedIds, bookmarkedArticleAddrs, fetchBookmarks, unreadArticleCount } = useBookmarkStore();
  const { pubkey } = useUserStore();
  const [tab, setTab] = useState<BookmarkTab>("notes");
  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [articles, setArticles] = useState<NDKEvent[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingArticles, setLoadingArticles] = useState(false);

  useEffect(() => {
    if (pubkey) fetchBookmarks(pubkey);
  }, [pubkey]);

  // Load bookmarked notes: DB cache first (instant), then relay fetch for missing
  useEffect(() => {
    if (bookmarkedIds.length === 0) {
      setNotes([]);
      return;
    }
    let cancelled = false;
    setLoadingNotes(true);

    (async () => {
      // 1) Instant: load from SQLite cache
      if (pubkey) {
        const cached = await dbLoadBookmarkedNotes(pubkey);
        if (!cancelled && cached.length > 0) {
          const ndk = getNDK();
          const events = cached
            .map((raw) => { try { return new NDKEvent(ndk, JSON.parse(raw)); } catch { return null; } })
            .filter((e): e is NDKEvent => e !== null)
            .filter((e) => bookmarkedIds.includes(e.id));
          const cachedNotes = events.filter((e) => e.kind !== 30023)
            .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
          const cachedArticles = events.filter((e) => e.kind === 30023);
          if (cachedNotes.length > 0) {
            setNotes(cachedNotes);
            setLoadingNotes(false);
          }
          if (cachedArticles.length > 0) {
            setArticles((prev) => {
              const existingIds = new Set(prev.map((e) => e.id));
              return [...prev, ...cachedArticles.filter((e) => !existingIds.has(e.id))]
                .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
            });
          }
        }
      }

      // 2) Background: fetch from relays and merge
      try {
        const results = await Promise.all(
          bookmarkedIds.map((id) => fetchNoteById(id))
        );
        if (!cancelled) {
          const fetched = results.filter((e): e is NDKEvent => e !== null);
          // Separate articles (kind 30023) bookmarked via e-tag from notes
          const notesOnly = fetched.filter((e) => e.kind !== 30023)
            .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
          const articlesFromETag = fetched.filter((e) => e.kind === 30023);
          setNotes(notesOnly);
          // Merge any articles found via e-tag into the articles list
          if (articlesFromETag.length > 0) {
            setArticles((prev) => {
              const existingIds = new Set(prev.map((e) => e.id));
              const merged = [...prev, ...articlesFromETag.filter((e) => !existingIds.has(e.id))];
              return merged.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
            });
          }
          // Save to DB for next time
          if (pubkey && fetched.length > 0) {
            dbSaveBookmarkedNotes(fetched.map((e) => JSON.stringify(e.rawEvent())), pubkey);
          }
        }
      } finally {
        if (!cancelled) setLoadingNotes(false);
      }
    })();

    return () => { cancelled = true; };
  }, [bookmarkedIds]);

  // Load bookmarked articles (no DB cache yet — articles are fetched by addr)
  useEffect(() => {
    if (bookmarkedArticleAddrs.length === 0) {
      setArticles([]);
      return;
    }
    let cancelled = false;
    setLoadingArticles(true);

    (async () => {
      try {
        const results = await Promise.all(
          bookmarkedArticleAddrs.map((addr) => fetchByAddr(addr))
        );
        if (!cancelled) {
          setArticles(
            results
              .filter((e): e is NDKEvent => e !== null)
              .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
          );
        }
      } finally {
        if (!cancelled) setLoadingArticles(false);
      }
    })();

    return () => { cancelled = true; };
  }, [bookmarkedArticleAddrs]);

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
                className={`px-3 py-0.5 transition-colors relative ${tab === "articles" ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text"}`}
              >
                Articles
                {unreadArticleCount() > 0 && (
                  <span className="ml-1 text-[9px] bg-accent/20 text-accent px-1 rounded-sm">{unreadArticleCount()}</span>
                )}
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
          <ArticleCardWithReadStatus key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
