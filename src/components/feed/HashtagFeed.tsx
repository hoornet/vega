import { useState, useEffect } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { fetchHashtagFeed } from "../../lib/nostr";
import { NoteCard } from "./NoteCard";
import { ViewHeader } from "../shared/ViewHeader";

export function HashtagFeed() {
  const { pendingHashtag, goBack } = useUIStore();
  const tag = pendingHashtag ?? "";

  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    setLoading(true);
    setNotes([]);
    (async () => {
      let result = await fetchHashtagFeed(tag).catch(() => [] as NDKEvent[]);
      if (result.length === 0 && !cancelled) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) return;
        result = await fetchHashtagFeed(tag).catch(() => [] as NDKEvent[]);
      }
      if (!cancelled) {
        setNotes(result);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tag]);

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title={`#${tag}`}
        onBack={goBack}
        meta={!loading ? `${notes.length} note${notes.length !== 1 ? "s" : ""}` : undefined}
      />

      <div className="flex-1 overflow-y-auto content-column">
        {loading && (
          <div className="px-4 py-8 text-text-dim text-body text-center">Loading notes for #{tag}…</div>
        )}

        {!loading && notes.length === 0 && (
          <div className="px-4 py-8 text-text-dim text-body text-center">No notes found for #{tag}</div>
        )}

        {notes.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
