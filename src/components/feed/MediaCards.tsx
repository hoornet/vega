import { ContentSegment } from "../../lib/parsing";
import { usePodcastStore } from "../../stores/podcast";

export function VideoBlock({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {sources.map((src, i) => (
        <video
          key={i}
          src={src}
          controls
          playsInline
          preload="metadata"
          className="max-w-full max-h-80 rounded-sm bg-bg-raised border border-border"
          onError={(e) => { (e.target as HTMLVideoElement).style.display = "none"; }}
        />
      ))}
    </div>
  );
}

function cleanAudioName(url: string): string {
  const raw = url.split("/").pop()?.split("?")[0] ?? url;
  // Remove file extension
  const name = raw.replace(/\.(mp3|m4a|ogg|opus|wav|flac|aac)$/i, "");
  // Decode URI components and replace common separators with spaces
  try {
    return decodeURIComponent(name).replace(/[-_]+/g, " ");
  } catch {
    return name.replace(/[-_]+/g, " ");
  }
}

export function AudioBlock({ sources }: { sources: string[] }) {
  const play = usePodcastStore((s) => s.play);
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {sources.map((src, i) => {
        const name = cleanAudioName(src);
        return (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              play({
                guid: `audio:${src}`,
                title: name,
                enclosureUrl: src,
                pubDate: 0,
                duration: 0,
                description: "",
                showTitle: "",
                showArtworkUrl: "",
              });
            }}
            className="rounded-sm bg-bg-raised border border-border p-3 flex items-center gap-3 hover:bg-bg-hover transition-colors text-left w-full"
          >
            <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
              <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" className="text-accent ml-0.5">
                <polygon points="0,0 10,6 0,12" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-text truncate">{name}</div>
              <div className="text-[10px] text-text-dim">audio · play in vega</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function YouTubeCard({ seg }: { seg: ContentSegment }) {
  return (
    <a
      href={seg.value}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex items-center gap-3 rounded-sm bg-bg-raised border border-border p-3 hover:bg-bg-hover transition-colors cursor-pointer"
    >
      <img
        src={`https://img.youtube.com/vi/${seg.mediaId}/hqdefault.jpg`}
        alt="Video thumbnail"
        className="w-28 h-16 rounded-sm object-cover shrink-0"
        loading="lazy"
      />
      <div className="min-w-0">
        <div className="text-[11px] text-text-muted">YouTube</div>
        <div className="text-[12px] text-accent truncate">{seg.value}</div>
      </div>
    </a>
  );
}

export function VimeoCard({ seg }: { seg: ContentSegment }) {
  return (
    <a
      href={seg.value}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex items-center gap-3 rounded-sm bg-bg-raised border border-border p-3 hover:bg-bg-hover transition-colors cursor-pointer"
    >
      <div className="w-10 h-10 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><polygon points="6,3 17,10 6,17" /></svg>
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-text-muted">Vimeo</div>
        <div className="text-[12px] text-accent truncate">{seg.value}</div>
      </div>
    </a>
  );
}

export function SpotifyCard({ seg }: { seg: ContentSegment }) {
  return (
    <a
      href={seg.value}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex items-center gap-3 rounded-sm bg-bg-raised border border-border p-3 hover:bg-bg-hover transition-colors cursor-pointer"
    >
      <div className="w-10 h-10 rounded-full bg-[#1DB954]/20 flex items-center justify-center shrink-0">
        <span className="text-[#1DB954] text-lg font-bold">S</span>
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-text-muted">Spotify · {seg.mediaType}</div>
        <div className="text-[12px] text-accent truncate">{seg.value}</div>
      </div>
    </a>
  );
}

export function TidalCard({ seg }: { seg: ContentSegment }) {
  return (
    <a
      href={seg.value}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex items-center gap-3 rounded-sm bg-bg-raised border border-border p-3 hover:bg-bg-hover transition-colors cursor-pointer"
    >
      <div className="w-10 h-10 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
        <span className="text-lg font-bold">T</span>
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-text-muted">Tidal · {seg.mediaType}</div>
        <div className="text-[12px] text-accent truncate">{seg.value}</div>
      </div>
    </a>
  );
}
