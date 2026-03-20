import { useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { parseContent } from "../../lib/parsing";
import { ImageLightbox } from "../shared/ImageLightbox";

const MEDIA_SEGMENT_TYPES = new Set(["image", "video", "audio", "youtube", "vimeo"]);

interface MediaItem {
  type: "image" | "video" | "audio";
  url: string;
  thumbnailId?: string;
  noteId: string;
}

function extractMediaItems(notes: NDKEvent[]): MediaItem[] {
  const items: MediaItem[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    const segments = parseContent(note.content);
    for (const seg of segments) {
      if (!MEDIA_SEGMENT_TYPES.has(seg.type)) continue;
      if (seen.has(seg.value)) continue;
      seen.add(seg.value);
      if (seg.type === "image") {
        items.push({ type: "image", url: seg.value, noteId: note.id! });
      } else if (seg.type === "video" || seg.type === "youtube" || seg.type === "vimeo") {
        items.push({ type: "video", url: seg.value, thumbnailId: seg.mediaId, noteId: note.id! });
      } else if (seg.type === "audio") {
        items.push({ type: "audio", url: seg.value, noteId: note.id! });
      }
    }
  }
  return items;
}

export function ProfileMediaGallery({ notes, loading }: { notes: NDKEvent[]; loading: boolean }) {
  const { openThread } = useUIStore();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  if (loading) {
    return <div className="px-4 py-8 text-text-dim text-[12px] text-center">Loading media…</div>;
  }

  const items = extractMediaItems(notes);
  const imageUrls = items.filter((i) => i.type === "image").map((i) => i.url);

  if (items.length === 0) {
    return <div className="px-4 py-8 text-text-dim text-[12px] text-center">No media found.</div>;
  }

  const openNote = (noteId: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (note) openThread(note, "profile");
  };

  let imageIndex = 0;

  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-1 p-2">
        {items.map((item, idx) => {
          if (item.type === "image") {
            const currentImageIdx = imageIndex++;
            return (
              <div
                key={idx}
                className="aspect-square overflow-hidden bg-bg-raised cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setLightboxIdx(currentImageIdx)}
              >
                <img
                  src={item.url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            );
          }
          if (item.type === "video") {
            return (
              <div
                key={idx}
                className="aspect-square overflow-hidden bg-bg-raised cursor-pointer hover:opacity-80 transition-opacity relative flex items-center justify-center"
                onClick={() => openNote(item.noteId)}
              >
                {item.thumbnailId ? (
                  <img
                    src={`https://img.youtube.com/vi/${item.thumbnailId}/mqdefault.jpg`}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full bg-bg-raised" />
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white text-lg">▶</span>
                </div>
              </div>
            );
          }
          // audio
          return (
            <div
              key={idx}
              className="aspect-square overflow-hidden bg-bg-raised cursor-pointer hover:opacity-80 transition-opacity flex items-center justify-center"
              onClick={() => openNote(item.noteId)}
            >
              <div className="text-center">
                <span className="text-3xl text-text-dim">♪</span>
                <p className="text-text-dim text-[10px] mt-1 px-2 truncate">{item.url.split("/").pop()}</p>
              </div>
            </div>
          );
        })}
      </div>

      {lightboxIdx !== null && (
        <ImageLightbox
          images={imageUrls}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onNavigate={(i) => setLightboxIdx(i)}
        />
      )}
    </>
  );
}
