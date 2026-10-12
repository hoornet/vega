import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { fetchMediaFeed } from "../../lib/nostr";
import { useMuteStore } from "../../stores/mute";
import { parseContent, ContentSegment } from "../../lib/parsing";
import { NoteCard } from "../feed/NoteCard";
import { SkeletonNoteList } from "../shared/Skeleton";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";

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
    fetchMediaFeed(500)
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
      <ViewHeader title="Media" />
      <Tabs
        label="Media"
        panel="media-panel"
        tabs={[
          { id: "all", label: "All" },
          { id: "videos", label: "Videos" },
          { id: "images", label: "Images" },
          { id: "audio", label: "Audio" },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div {...tabPanelProps("media-panel", tab)} className="flex-1 overflow-y-auto content-column">
        {loading && <SkeletonNoteList count={4} />}

        {!loading && filtered.length === 0 && (
          <div className="px-4 py-12 text-center space-y-2">
            <p className="text-text-dim text-body">
              No {tab === "all" ? "media" : tab} found.
            </p>
            <p className="text-text-dim text-caption">
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
