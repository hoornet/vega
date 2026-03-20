import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { fetchGlobalFeed } from "../../lib/nostr";
import { useMuteStore } from "../../stores/mute";
import { parseContent, ContentSegment } from "../../lib/parsing";
import { NoteCard } from "../feed/NoteCard";
import { SkeletonNoteList } from "../shared/Skeleton";

type MediaTab = "all" | "videos" | "images" | "audio";

const MEDIA_TYPES: Record<MediaTab, ContentSegment["type"][]> = {
  all: ["image", "video", "audio", "youtube", "vimeo", "spotify", "tidal"],
  videos: ["video", "youtube", "vimeo"],
  images: ["image"],
  audio: ["audio", "spotify", "tidal"],
};

function hasMediaType(content: string, types: ContentSegment["type"][]): boolean {
  const segments = parseContent(content);
  return segments.some((s) => types.includes(s.type));
}

export function MediaFeed() {
  const [allNotes, setAllNotes] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MediaTab>("all");
  const { mutedPubkeys, contentMatchesMutedKeyword } = useMuteStore();

  useEffect(() => {
    setLoading(true);
    fetchGlobalFeed(300)
      .then((notes) => {
        const mediaNotes = notes.filter((n) => hasMediaType(n.content, MEDIA_TYPES.all));
        setAllNotes(mediaNotes);
      })
      .catch(() => setAllNotes([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = (tab === "all"
    ? allNotes
    : allNotes.filter((n) => hasMediaType(n.content, MEDIA_TYPES[tab]))
  ).filter((n) => !mutedPubkeys.includes(n.pubkey) && !contentMatchesMutedKeyword(n.content));

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1">
          <h1 className="text-text text-sm font-medium mr-3">Media</h1>
          {(["all", "videos", "images", "audio"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-[12px] transition-colors ${
                tab === t
                  ? "text-text border-b-2 border-accent"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && <SkeletonNoteList count={4} />}

        {!loading && filtered.length === 0 && (
          <div className="px-4 py-12 text-center space-y-2">
            <p className="text-text-dim text-[13px]">
              No {tab === "all" ? "media" : tab} found.
            </p>
            <p className="text-text-dim text-[11px] opacity-60">
              Try switching tabs or check back later.
            </p>
          </div>
        )}

        {filtered.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
