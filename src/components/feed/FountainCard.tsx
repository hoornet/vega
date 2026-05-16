import { useState, useEffect } from "react";
import type { ContentSegment } from "../../lib/parsing";
import type { PodcastEpisode } from "../../types/podcast";
import { resolveFountainEpisode } from "../../lib/podcast";
import { usePodcastStore } from "../../stores/podcast";
import { safeHttpUrl } from "../../lib/utils";

export function FountainCard({ seg }: { seg: ContentSegment }) {
  const [episode, setEpisode] = useState<PodcastEpisode | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const play = usePodcastStore((s) => s.play);

  useEffect(() => {
    resolveFountainEpisode(seg.value).then((ep) => {
      if (ep) setEpisode(ep);
      else setFailed(true);
      setLoading(false);
    });
  }, [seg.value]);

  if (failed) {
    // Fallback: render as a regular link
    return (
      <a
        href={safeHttpUrl(seg.value)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex items-center gap-3 rounded-sm bg-bg-raised border border-border p-3 hover:bg-bg-hover transition-colors cursor-pointer"
      >
        <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
          <span className="text-accent text-lg font-bold">F</span>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-text-muted">Fountain.fm</div>
          <div className="text-[12px] text-accent truncate">{seg.value}</div>
        </div>
      </a>
    );
  }

  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-3 rounded-sm bg-bg-raised border border-border p-3 animate-pulse">
        <div className="w-10 h-10 rounded-sm bg-bg shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="h-3 bg-bg rounded w-32 mb-1" />
          <div className="h-2 bg-bg rounded w-20" />
        </div>
      </div>
    );
  }

  if (!episode) return null;

  const handlePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (episode.enclosureUrl) {
      play(episode);
    }
  };

  return (
    <div
      className="mt-2 flex items-center gap-3 rounded-sm bg-bg-raised border border-border p-3 hover:bg-bg-hover transition-colors cursor-pointer"
      onClick={handlePlay}
    >
      {episode.artworkUrl ? (
        <img
          src={episode.artworkUrl}
          alt={`${episode.title || "Episode"} artwork`}
          className="w-12 h-12 rounded-sm object-cover shrink-0"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className="w-12 h-12 rounded-sm bg-accent/20 flex items-center justify-center shrink-0">
          <span className="text-accent text-lg font-bold">F</span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-text-muted">Fountain.fm</div>
        <div className="text-[12px] text-text truncate">{episode.title}</div>
        {episode.showTitle && (
          <div className="text-[10px] text-text-dim truncate">{episode.showTitle}</div>
        )}
      </div>
      {episode.enclosureUrl && (
        <button
          onClick={handlePlay}
          className="shrink-0 w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-accent/10 transition-colors"
          title="Play in Vega"
        >
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" className="text-accent ml-0.5">
            <polygon points="0,0 10,6 0,12" />
          </svg>
        </button>
      )}
    </div>
  );
}
