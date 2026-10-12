import { useEffect, useState } from "react";
import { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk";
import { useBookmarkStore } from "../../stores/bookmark";
import { useUserStore } from "../../stores/user";
import { fetchNoteById, fetchByAddr, getNDK, fetchWithTimeout } from "../../lib/nostr";
import { dbLoadBookmarkedNotes, dbSaveBookmarkedNotes } from "../../lib/db";
import { NoteCard } from "../feed/NoteCard";
import { ArticleCard } from "../article/ArticleCard";
import { SkeletonNoteList } from "../shared/Skeleton";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";
import { ListState, stateWithoutRows } from "../shared/ListState";
import { fetchMark, wentUnanswered } from "../../lib/listLoad";

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
          className="absolute right-3 top-3 text-caption text-text-dim hover:text-accent opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity z-10"
        >
          {isRead ? "Mark unread" : "Mark read"}
        </button>
      )}
    </div>
  );
}

export function BookmarkView() {
  const { bookmarkedIds, bookmarkedArticleAddrs, fetchBookmarks, unreadArticleCount, listOutcome } = useBookmarkStore();
  const { pubkey } = useUserStore();
  const [tab, setTab] = useState<BookmarkTab>("notes");
  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [articles, setArticles] = useState<NDKEvent[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingArticles, setLoadingArticles] = useState(false);
  // Saved, asked for, and no relay answered. Different from "saved, and the relays do not have them".
  const [notesUnanswered, setNotesUnanswered] = useState(false);
  const [articlesUnanswered, setArticlesUnanswered] = useState(false);
  // How many of the saved items the relays returned: null until they have been asked.
  const [notesFetched, setNotesFetched] = useState<number | null>(null);
  const [articlesFetched, setArticlesFetched] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
    setNotesUnanswered(false);
    setNotesFetched(null);

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

      // 2) Background: batch fetch from relays (single filter is much faster than one-by-one)
      const mark = fetchMark();
      try {
        const batchSize = 50;
        const allFetched: NDKEvent[] = [];
        for (let i = 0; i < bookmarkedIds.length; i += batchSize) {
          const batch = bookmarkedIds.slice(i, i + batchSize);
          const filter: NDKFilter = { ids: batch };
          const events = await fetchWithTimeout(getNDK(), filter, 10000);
          allFetched.push(...Array.from(events));
        }
        // Fallback: try individual fetch for any IDs not found in batch
        const foundIds = new Set(allFetched.map((e) => e.id));
        const missing = bookmarkedIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0 && missing.length <= 10) {
          const fallback = await Promise.all(missing.map((id) => fetchNoteById(id)));
          allFetched.push(...fallback.filter((e): e is NDKEvent => e !== null));
        }
        if (!cancelled) {
          setNotesUnanswered(allFetched.length === 0 && wentUnanswered(mark));
          setNotesFetched(allFetched.length);
          const fetched = allFetched;
          // Separate articles (kind 30023) bookmarked via e-tag from notes
          const fetchedNotes = fetched.filter((e) => e.kind !== 30023);
          const articlesFromETag = fetched.filter((e) => e.kind === 30023);
          // Merge with existing (cached) notes — don't replace, so cached notes survive relay timeouts
          setNotes((prev) => {
            const byId = new Map(prev.map((e) => [e.id, e]));
            for (const e of fetchedNotes) byId.set(e.id, e);
            return Array.from(byId.values())
              .filter((e) => bookmarkedIds.includes(e.id!))
              .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
          });
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
      } catch {
        // Not "your relays did not have them": nobody got as far as saying so.
        if (!cancelled) setNotesUnanswered(true);
      } finally {
        if (!cancelled) setLoadingNotes(false);
      }
    })();

    return () => { cancelled = true; };
  }, [bookmarkedIds, reloadKey]);

  // Load bookmarked articles (no DB cache yet — articles are fetched by addr)
  useEffect(() => {
    if (bookmarkedArticleAddrs.length === 0) {
      setArticles([]);
      return;
    }
    let cancelled = false;
    setLoadingArticles(true);
    setArticlesUnanswered(false);
    setArticlesFetched(null);

    (async () => {
      const mark = fetchMark();
      try {
        const results = await Promise.all(
          bookmarkedArticleAddrs.map((addr) => fetchByAddr(addr))
        );
        if (!cancelled) {
          const found = results.filter((e): e is NDKEvent => e !== null);
          const unanswered = found.length === 0 && wentUnanswered(mark);
          setArticlesUnanswered(unanswered);
          setArticlesFetched(found.length);
          // Nobody answered: the articles already on screen stay.
          if (!unanswered) setArticles(found.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)));
        }
      } catch {
        if (!cancelled) setArticlesUnanswered(true);
      } finally {
        if (!cancelled) setLoadingArticles(false);
      }
    })();

    return () => { cancelled = true; };
  }, [bookmarkedArticleAddrs, reloadKey]);

  const totalCount = bookmarkedIds.length + bookmarkedArticleAddrs.length;
  const loading = tab === "notes" ? loadingNotes : loadingArticles;
  const items = tab === "notes" ? notes : articles;
  const savedHere = tab === "notes" ? bookmarkedIds.length : bookmarkedArticleAddrs.length;
  const unanswered = tab === "notes" ? notesUnanswered : articlesUnanswered;
  const fetched = tab === "notes" ? notesFetched : articlesFetched;
  // Saved, asked for, and the relays answered with none of them. Not the same
  // as a tab with nothing to show: saved ids that turn out to be articles are
  // found, and listed under Articles.
  const missing = savedHere > 0 && fetched === 0 && !unanswered;
  // Without an account there is no list to ask for: what this device holds is all there is.
  const listKnown = pubkey ? listOutcome : "answered";

  return (
    <div className="h-full flex flex-col">
      {/* No "0 saved" beside a list that could not be read. */}
      <ViewHeader title="Bookmarks" meta={totalCount > 0 || listKnown === "answered" ? `${totalCount} saved` : undefined} />
      {/* The number on Articles is how many are still unread, not how many
          are saved, so it is a badge and not a quiet total. */}
      <Tabs
        label="Bookmarks"
        panel="bookmarks-panel"
        tabs={[
          { id: "notes", label: "Notes" },
          { id: "articles", label: "Articles", unread: unreadArticleCount() || undefined },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div {...tabPanelProps("bookmarks-panel", tab)} className="flex-1 overflow-y-auto content-column">
        {/* Three different things used to read "No bookmarked notes." under a
            header that said "12 saved": nothing saved, saved but the relays
            did not answer, and saved but the relays no longer have them. */}
        {items.length === 0 && (
          <ListState
            state={savedHere > 0
              ? loading || (fetched === null && !unanswered) ? "loading" : unanswered ? "unreachable" : "empty"
              : stateWithoutRows(loading, 0, listKnown)}
            loadingLabel="Loading bookmarks…"
            loading={<SkeletonNoteList count={3} />}
            empty={missing
              ? `${savedHere} saved, but your relays did not have ${savedHere === 1 ? "it" : "any of them"}.`
              : tab === "notes" ? "No bookmarked notes." : "No bookmarked articles."}
            emptyHint={missing
              ? "They may have been deleted, or be on a relay that is not in your list."
              : savedHere > 0
                ? "What you saved is under the other tab."
                : tab === "notes"
                  ? "Use the bookmark icon on any note to save it here."
                  : "Use Save on any article to add it to your reading list."}
            what={tab === "notes" ? "your saved notes" : "your saved articles"}
            onRetry={() => { if (savedHere > 0) setReloadKey((n) => n + 1); else if (pubkey) void fetchBookmarks(pubkey); }}
          />
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
