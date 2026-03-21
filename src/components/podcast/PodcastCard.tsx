import type { PodcastShow } from "../../types/podcast";
import { usePodcastStore } from "../../stores/podcast";

interface PodcastCardProps {
  show: PodcastShow;
  onClick: () => void;
}

export function PodcastCard({ show, onClick }: PodcastCardProps) {
  const subscribed = usePodcastStore((s) => s.isSubscribed(show.feedUrl));
  const { subscribe, unsubscribe } = usePodcastStore.getState();

  return (
    <div className="flex items-start gap-3 p-3 rounded-sm bg-bg-raised border border-border hover:bg-bg-hover transition-colors text-left w-full">
      <button onClick={onClick} className="shrink-0">
        {show.artworkUrl ? (
          <img
            src={show.artworkUrl}
            alt=""
            className="w-16 h-16 rounded-sm object-cover bg-bg"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-16 h-16 rounded-sm bg-bg flex items-center justify-center text-2xl text-text-dim">
            P
          </div>
        )}
      </button>
      <button onClick={onClick} className="min-w-0 flex-1 text-left">
        <div className="text-[13px] text-text font-medium truncate">{show.title}</div>
        <div className="text-[11px] text-text-muted truncate">{show.author}</div>
        {show.description && (
          <div className="text-[11px] text-text-dim mt-1 line-clamp-2">
            {show.description.replace(/<[^>]+>/g, "").slice(0, 120)}
          </div>
        )}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (subscribed) unsubscribe(show.feedUrl);
          else subscribe(show);
        }}
        className={`shrink-0 text-[10px] px-2 py-1 rounded-sm border transition-colors ${
          subscribed
            ? "border-accent/40 text-accent"
            : "border-border text-text-muted hover:text-accent hover:border-accent/40"
        }`}
      >
        {subscribed ? "subscribed" : "+ subscribe"}
      </button>
    </div>
  );
}
