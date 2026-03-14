import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useBookmarkStore } from "../../stores/bookmark";
import { useUserStore } from "../../stores/user";
import { fetchNoteById } from "../../lib/nostr";
import { NoteCard } from "../feed/NoteCard";
import { SkeletonNoteList } from "../shared/Skeleton";

export function BookmarkView() {
  const { bookmarkedIds, fetchBookmarks } = useBookmarkStore();
  const { pubkey } = useUserStore();
  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(false);

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

  const loadNotes = async () => {
    setLoading(true);
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
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-4 py-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-text text-[13px] font-medium">Bookmarks</h2>
          <span className="text-text-dim text-[11px]">{bookmarkedIds.length} saved</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && notes.length === 0 && (
          <SkeletonNoteList count={3} />
        )}

        {!loading && notes.length === 0 && (
          <div className="px-4 py-12 text-center space-y-2">
            <p className="text-text-dim text-[13px]">No bookmarks yet.</p>
            <p className="text-text-dim text-[11px] opacity-60">
              Use the <span className="text-accent">save</span> button on any note to bookmark it here.
            </p>
          </div>
        )}

        {notes.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
