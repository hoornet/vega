import { useUIStore } from "../../stores/ui";
import { fetchHashtagFeed } from "../../lib/nostr";
import { NoteCard } from "./NoteCard";
import { ViewHeader } from "../shared/ViewHeader";
import { ListState, emptyOr } from "../shared/ListState";
import { useLoadedList } from "../../hooks/useLoadedList";

export function HashtagFeed() {
  const { pendingHashtag, goBack } = useUIStore();
  const tag = pendingHashtag ?? "";

  // Asked twice when the first answer is empty: relays are often slow on the first ask.
  const list = useLoadedList(() => fetchHashtagFeed(tag), [tag], { retryEmptyAfterMs: 3000, enabled: tag !== "" });
  const notes = list.items;
  const loaded = list.status === "loaded";

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title={`#${tag}`}
        onBack={goBack}
        meta={loaded ? `${notes.length} note${notes.length !== 1 ? "s" : ""}` : undefined}
      />

      <div className="flex-1 overflow-y-auto content-column">
        {notes.length === 0 && (
          <ListState
            state={emptyOr(list.status)}
            loadingLabel={`Loading notes for #${tag}…`}
            empty={`No notes found for #${tag}.`}
            what={`notes for #${tag}`}
            error={list.message}
            onRetry={list.reload}
          />
        )}

        {notes.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
