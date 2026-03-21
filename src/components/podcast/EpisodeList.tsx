import { useState, useEffect } from "react";
import type { PodcastShow, PodcastEpisode } from "../../types/podcast";
import { getEpisodes } from "../../lib/podcast";
import { usePodcastStore } from "../../stores/podcast";

function SubscribeButton({ show }: { show: PodcastShow }) {
  const subscribed = usePodcastStore((s) => s.isSubscribed(show.feedUrl));
  const { subscribe, unsubscribe } = usePodcastStore.getState();
  return (
    <button
      onClick={() => subscribed ? unsubscribe(show.feedUrl) : subscribe(show)}
      className={`shrink-0 text-[11px] px-3 py-1 rounded-sm border transition-colors ${
        subscribed
          ? "border-accent/40 text-accent"
          : "border-border text-text-muted hover:text-accent hover:border-accent/40"
      }`}
    >
      {subscribed ? "subscribed" : "+ subscribe"}
    </button>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

interface EpisodeListProps {
  show: PodcastShow;
  onBack: () => void;
}

export function EpisodeList({ show, onBack }: EpisodeListProps) {
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const play = usePodcastStore((s) => s.play);
  const currentGuid = usePodcastStore((s) => s.currentEpisode?.guid);
  const progressMap = usePodcastStore((s) => s.progressMap);

  useEffect(() => {
    if (!show.podcastIndexId) return;
    setLoading(true);
    getEpisodes(show.podcastIndexId).then((eps) => {
      // Enrich episodes with show info
      setEpisodes(eps.map((ep) => ({
        ...ep,
        showTitle: show.title,
        showArtworkUrl: show.artworkUrl,
      })));
      setLoading(false);
    });
  }, [show.podcastIndexId]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border p-4 flex items-start gap-4 shrink-0">
        <button
          onClick={onBack}
          className="text-text-muted hover:text-accent text-[12px] mt-1 shrink-0"
        >
          back
        </button>
        {show.artworkUrl && (
          <img
            src={show.artworkUrl}
            alt=""
            className="w-20 h-20 rounded-sm object-cover shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[15px] text-text font-semibold">{show.title}</h2>
              <div className="text-[12px] text-text-muted">{show.author}</div>
            </div>
            <SubscribeButton show={show} />
          </div>
          {show.description && (
            <div className="text-[11px] text-text-dim mt-1 line-clamp-3">
              {show.description.replace(/<[^>]+>/g, "").slice(0, 200)}
            </div>
          )}
        </div>
      </div>

      {/* Episodes */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-text-dim text-[12px]">Loading episodes...</div>
        ) : episodes.length === 0 ? (
          <div className="p-4 text-text-dim text-[12px]">No episodes found</div>
        ) : (
          episodes.map((ep) => {
            const isPlaying = currentGuid === ep.guid;
            const progress = progressMap[ep.guid];
            const hasProgress = progress && progress.position > 10;
            return (
              <button
                key={ep.guid}
                onClick={() => play(ep)}
                className={`w-full text-left px-4 py-3 border-b border-border hover:bg-bg-hover transition-colors flex items-center gap-3 ${
                  isPlaying ? "bg-accent/5" : ""
                }`}
              >
                <div className="w-6 shrink-0 flex items-center justify-center">
                  {isPlaying ? (
                    <span className="text-accent text-[12px]">*</span>
                  ) : (
                    <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" className="text-text-dim">
                      <polygon points="0,0 10,6 0,12" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-text truncate">{ep.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-text-dim">{formatDate(ep.pubDate)}</span>
                    {ep.duration > 0 && (
                      <span className="text-[10px] text-text-dim">{formatDuration(ep.duration)}</span>
                    )}
                    {hasProgress && (
                      <span className="text-[10px] text-accent">resumed</span>
                    )}
                    {ep.value && ep.value.length > 0 && (
                      <span className="text-[10px] text-amber-500">V4V</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
