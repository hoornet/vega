import { useState, useEffect } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { fetchHashtagFeed } from "../../lib/nostr";
import { NoteCard } from "./NoteCard";

export function HashtagFeed() {
  const { pendingHashtag, goBack } = useUIStore();
  const tag = pendingHashtag ?? "";

  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tag) return;
    setLoading(true);
    setNotes([]);
    fetchHashtagFeed(tag)
      .then(setNotes)
      .finally(() => setLoading(false));
  }, [tag]);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-4 py-2.5 flex items-center gap-3 shrink-0">
        <button onClick={goBack} className="text-text-dim hover:text-text text-[11px] transition-colors">
          ← back
        </button>
        <h2 className="text-text text-[14px] font-medium">#{tag}</h2>
        {!loading && (
          <span className="text-text-dim text-[11px]">{notes.length} note{notes.length !== 1 ? "s" : ""}</span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">Loading notes for #{tag}…</div>
        )}

        {!loading && notes.length === 0 && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">No notes found for #{tag}</div>
        )}

        {notes.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
