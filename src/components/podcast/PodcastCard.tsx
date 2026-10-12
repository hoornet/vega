import type { PodcastShow } from "../../types/podcast";
import { usePodcastStore } from "../../stores/podcast";
import { stripHtmlTags } from "../../lib/utils";
import { Button } from "../shared/Button";
import { Check, Plus } from "lucide-react";

interface PodcastCardProps {
  show: PodcastShow;
  onClick: () => void;
}

export function PodcastCard({ show, onClick }: PodcastCardProps) {
  const subscribed = usePodcastStore((s) => s.isSubscribed(show.feedUrl));
  const { subscribe, unsubscribe } = usePodcastStore.getState();

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-bg-raised border border-border hover:bg-bg-hover transition-colors text-left w-full">
      <button onClick={onClick} className="shrink-0">
        {show.artworkUrl ? (
          <img
            src={show.artworkUrl}
            alt={`${show.title || "Podcast"} artwork`}
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
        <div className="text-body text-text font-medium truncate">{show.title}</div>
        <div className="text-caption text-text-muted truncate">{show.author}</div>
        {show.description && (
          <div className="text-caption text-text-dim mt-1 line-clamp-2">
            {stripHtmlTags(show.description).slice(0, 120)}
          </div>
        )}
      </button>
      {/* The card hovers, and the accent tint is not held at 4.5:1 on a hovered surface: subscribed is a ghost, accent text and no fill. */}
      {subscribed ? (
        <Button size="sm" variant="ghost" pressed onClick={(e) => { e.stopPropagation(); unsubscribe(show.feedUrl); }}><Check />Subscribed</Button>
      ) : (
        <Button size="sm" pressed={false} onClick={(e) => { e.stopPropagation(); subscribe(show); }}><Plus />Subscribe</Button>
      )}
    </div>
  );
}
