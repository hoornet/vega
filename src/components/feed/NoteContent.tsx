import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { fetchNoteById } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { shortenPubkey } from "../../lib/utils";
import { ImageLightbox } from "../shared/ImageLightbox";
import { parseContent } from "../../lib/parsing";
import { renderTextSegments } from "./TextSegments";
import { VideoBlock, AudioBlock, YouTubeCard, VimeoCard, SpotifyCard, TidalCard } from "./MediaCards";
import { FountainCard } from "./FountainCard";

function ImageGrid({ images, onImageClick }: { images: string[]; onImageClick: (index: number) => void }) {
  const count = images.length;
  if (count === 0) return null;

  const maxVisible = Math.min(count, 4);
  const extraCount = count - 4;
  const visible = images.slice(0, maxVisible);

  if (count === 1) {
    return (
      <div className="mt-2">
        <img
          src={images[0]}
          alt="Posted image"
          loading="lazy"
          className="max-w-full max-h-80 rounded-sm object-cover bg-bg-raised border border-border cursor-zoom-in"
          onClick={(e) => { e.stopPropagation(); onImageClick(0); }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </div>
    );
  }

  if (count === 2) {
    return (
      <div className="mt-2 grid grid-cols-2 gap-1">
        {visible.map((src, idx) => (
          <img
            key={idx}
            src={src}
            alt="Posted image"
            loading="lazy"
            className="w-full aspect-[4/3] rounded-sm object-cover bg-bg-raised border border-border cursor-zoom-in"
            onClick={(e) => { e.stopPropagation(); onImageClick(idx); }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ))}
      </div>
    );
  }

  if (count === 3) {
    return (
      <div className="mt-2 grid grid-cols-2 grid-rows-2 gap-1" style={{ gridTemplateRows: "1fr 1fr" }}>
        <img
          src={visible[0]}
          alt="Posted image"
          loading="lazy"
          className="w-full h-full rounded-sm object-cover bg-bg-raised border border-border cursor-zoom-in row-span-2"
          style={{ aspectRatio: "3/4" }}
          onClick={(e) => { e.stopPropagation(); onImageClick(0); }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <img
          src={visible[1]}
          alt="Posted image"
          loading="lazy"
          className="w-full aspect-[4/3] rounded-sm object-cover bg-bg-raised border border-border cursor-zoom-in"
          onClick={(e) => { e.stopPropagation(); onImageClick(1); }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <img
          src={visible[2]}
          alt="Posted image"
          loading="lazy"
          className="w-full aspect-[4/3] rounded-sm object-cover bg-bg-raised border border-border cursor-zoom-in"
          onClick={(e) => { e.stopPropagation(); onImageClick(2); }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </div>
    );
  }

  // 4+ images: 2x2 grid with "+N more" overlay on 4th
  return (
    <div className="mt-2 grid grid-cols-2 gap-1">
      {visible.map((src, idx) => (
        <div key={idx} className="relative">
          <img
            src={src}
            alt="Posted image"
            loading="lazy"
            className="w-full aspect-[4/3] rounded-sm object-cover bg-bg-raised border border-border cursor-zoom-in"
            onClick={(e) => { e.stopPropagation(); onImageClick(idx); }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          {idx === 3 && extraCount > 0 && (
            <div
              className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-sm cursor-zoom-in"
              onClick={(e) => { e.stopPropagation(); onImageClick(idx); }}
            >
              <span className="text-white text-lg font-semibold">+{extraCount}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function QuotePreview({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<NDKEvent | null>(null);
  const { openThread, currentView } = useUIStore();
  const profile = useProfile(event?.pubkey ?? "");

  useEffect(() => {
    if (!eventId) return;
    fetchNoteById(eventId).then(setEvent);
  }, [eventId]);

  if (!event) return null;

  const rawName = profile?.displayName || profile?.name;
  const name = (typeof rawName === "string" ? rawName : null) || shortenPubkey(event.pubkey);
  const preview = event.content.slice(0, 160) + (event.content.length > 160 ? "…" : "");

  return (
    <div
      className="mt-2 border border-border bg-bg-raised px-3 py-2 cursor-pointer hover:bg-bg-hover transition-colors"
      onClick={(e) => { e.stopPropagation(); openThread(event, currentView as "feed" | "profile"); }}
    >
      <div className="flex items-center gap-2 mb-1">
        {profile?.picture && (
          <img src={profile.picture} alt={`${name}'s avatar`} className="w-4 h-4 rounded-sm object-cover shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        <span className="text-text-muted text-[11px] font-medium truncate">{name}</span>
      </div>
      <p className="text-text-dim text-[11px] leading-relaxed whitespace-pre-wrap break-words">{preview}</p>
    </div>
  );
}

interface NoteContentProps {
  content: string;
  /** Render only inline text (no media blocks). Used inside the clickable area. */
  inline?: boolean;
  /** Render only media blocks (videos, embeds, quotes). Used outside the clickable area. */
  mediaOnly?: boolean;
}

export function NoteContent({ content, inline, mediaOnly }: NoteContentProps) {
  const { openHashtag } = useUIStore();
  const segments = parseContent(content);
  const images: string[] = segments.filter((s) => s.type === "image").map((s) => s.value);
  const videos: string[] = segments.filter((s) => s.type === "video").map((s) => s.value);
  const audios: string[] = segments.filter((s) => s.type === "audio").map((s) => s.value);
  const youtubes = segments.filter((s) => s.type === "youtube");
  const vimeos = segments.filter((s) => s.type === "vimeo");
  const spotifys = segments.filter((s) => s.type === "spotify");
  const tidals = segments.filter((s) => s.type === "tidal");
  const fountains = segments.filter((s) => s.type === "fountain");
  const quoteIds: string[] = segments.filter((s) => s.type === "quote").map((s) => s.value);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // --- Inline text + images (safe inside clickable wrapper) ---
  if (inline) {
    return (
      <div>
        <div className="note-content text-text text-[13px] break-words whitespace-pre-wrap leading-relaxed">
          {renderTextSegments(segments, openHashtag, { resolveMentions: true })}
        </div>
        <ImageGrid images={images} onImageClick={setLightboxIndex} />
        {lightboxIndex !== null && (
          <ImageLightbox
            images={images}
            index={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onNavigate={setLightboxIndex}
          />
        )}
      </div>
    );
  }

  // --- Media blocks only (rendered OUTSIDE the clickable wrapper) ---
  if (mediaOnly) {
    const hasMedia = videos.length > 0 || audios.length > 0 || youtubes.length > 0
      || vimeos.length > 0 || spotifys.length > 0 || tidals.length > 0 || fountains.length > 0 || quoteIds.length > 0;
    if (!hasMedia) return null;

    return (
      <div onClick={(e) => e.stopPropagation()}>
        <VideoBlock sources={videos} />
        <AudioBlock sources={audios} />
        {youtubes.map((seg, i) => <YouTubeCard key={`yt-${i}`} seg={seg} />)}
        {vimeos.map((seg, i) => <VimeoCard key={`vim-${i}`} seg={seg} />)}
        {spotifys.map((seg, i) => <SpotifyCard key={`sp-${i}`} seg={seg} />)}
        {tidals.map((seg, i) => <TidalCard key={`td-${i}`} seg={seg} />)}
        {fountains.map((seg, i) => <FountainCard key={`fn-${i}`} seg={seg} />)}
        {quoteIds.map((id) => <QuotePreview key={id} eventId={id} />)}
      </div>
    );
  }

  // --- Default: full render (used in ThreadView, SearchView, etc.) ---
  return (
    <div>
      <div className="note-content text-text text-[13px] break-words whitespace-pre-wrap leading-relaxed">
        {renderTextSegments(segments, openHashtag)}
      </div>

      <ImageGrid images={images} onImageClick={setLightboxIndex} />

      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}

      <VideoBlock sources={videos} />
      <AudioBlock sources={audios} />
      {youtubes.map((seg, i) => <YouTubeCard key={`yt-${i}`} seg={seg} />)}
      {vimeos.map((seg, i) => <VimeoCard key={`vim-${i}`} seg={seg} />)}
      {spotifys.map((seg, i) => <SpotifyCard key={`sp-${i}`} seg={seg} />)}
      {tidals.map((seg, i) => <TidalCard key={`td-${i}`} seg={seg} />)}
      {fountains.map((seg, i) => <FountainCard key={`fn-${i}`} seg={seg} />)}
      {quoteIds.map((id) => <QuotePreview key={id} eventId={id} />)}
    </div>
  );
}
