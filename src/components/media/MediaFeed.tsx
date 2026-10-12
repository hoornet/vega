import { useState } from "react";
import { fetchMediaFeed } from "../../lib/nostr";
import { useMuteStore } from "../../stores/mute";
import { parseContent, ContentSegment } from "../../lib/parsing";
import { NoteCard } from "../feed/NoteCard";
import { SkeletonNoteList } from "../shared/Skeleton";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";
import { ListState, emptyOr } from "../shared/ListState";
import { useLoadedList } from "../../hooks/useLoadedList";

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
  const [tab, setTab] = useState<MediaTab>("all");
  const { mutedPubkeys, contentMatchesMutedKeyword } = useMuteStore();
  const list = useLoadedList(async () => (await fetchMediaFeed(500)).filter((n) => hasMediaType(n.content, MEDIA_TYPES.all)), []);
  const allNotes = list.items;

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
        {/* "No images found" is only true once the notes have loaded: a tab with nothing in it, or a feed that never arrived, are different things. */}
        {filtered.length === 0 && (
          <ListState
            state={emptyOr(list.status)}
            loadingLabel="Loading media…"
            loading={<SkeletonNoteList count={4} />}
            empty={`No ${tab === "all" ? "media" : tab} found.`}
            emptyHint="Try another tab, or check back later."
            what="media"
            error={list.message}
            onRetry={list.reload}
          />
        )}

        {filtered.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
