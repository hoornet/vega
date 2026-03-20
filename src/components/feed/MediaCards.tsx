import { ContentSegment } from "../../lib/parsing";

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

export function AudioBlock({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {sources.map((src, i) => {
        const filename = src.split("/").pop()?.split("?")[0] ?? src;
        return (
          <div key={i} className="rounded-sm bg-bg-raised border border-border p-2">
            <div className="text-[11px] text-text-muted mb-1 truncate">{filename}</div>
            <audio controls preload="metadata" className="w-full h-8" src={src} />
          </div>
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
        alt=""
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
      <div className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="white"><polygon points="6,3 17,10 6,17" /></svg>
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
      <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
        <span className="text-white text-lg font-bold">T</span>
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-text-muted">Tidal · {seg.mediaType}</div>
        <div className="text-[12px] text-accent truncate">{seg.value}</div>
      </div>
    </a>
  );
}
