import { NDKEvent, nip19 } from "@nostr-dev-kit/ndk";
import { useProfile } from "../../hooks/useProfile";
import { useUIStore } from "../../stores/ui";
import { shortenPubkey } from "../../lib/utils";

function getTag(event: NDKEvent, name: string): string {
  return event.tags.find((t) => t[0] === name)?.[1] ?? "";
}

function getTags(event: NDKEvent, name: string): string[] {
  return event.tags.filter((t) => t[0] === name).map((t) => t[1]).filter(Boolean);
}

function buildNaddr(event: NDKEvent): string {
  const d = getTag(event, "d");
  if (!d) return "";
  return nip19.naddrEncode({
    identifier: d,
    pubkey: event.pubkey,
    kind: event.kind!,
  });
}

export function ArticleCard({ event }: { event: NDKEvent }) {
  const { openArticle, openProfile } = useUIStore();
  const profile = useProfile(event.pubkey);

  const title = getTag(event, "title");
  const summary = getTag(event, "summary");
  const image = getTag(event, "image");
  const tags = getTags(event, "t");
  const publishedAt = parseInt(getTag(event, "published_at")) || event.created_at || null;
  const naddr = buildNaddr(event);

  const authorName = profile?.displayName || profile?.name || shortenPubkey(event.pubkey);
  const date = publishedAt
    ? new Date(publishedAt * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  const wordCount = event.content?.trim().split(/\s+/).length ?? 0;
  const readingTime = Math.max(1, Math.ceil(wordCount / 230));

  if (!naddr) return null;

  return (
    <div
      className="border-b border-border px-4 py-3 hover:bg-bg-hover transition-colors cursor-pointer"
      onClick={() => openArticle(naddr, event)}
    >
      <div className="flex gap-3">
        {/* Text content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 className="text-text text-[14px] font-medium leading-snug mb-1 line-clamp-2">
            {title || "Untitled"}
          </h3>

          {/* Summary */}
          {summary && (
            <p className="text-text-muted text-[12px] leading-relaxed mb-2 line-clamp-2">
              {summary}
            </p>
          )}

          {/* Author row */}
          <div className="flex items-center gap-2 mb-1.5">
            <button
              className="shrink-0"
              onClick={(e) => { e.stopPropagation(); openProfile(event.pubkey); }}
            >
              {profile?.picture ? (
                <img
                  src={profile.picture}
                  alt=""
                  className="w-5 h-5 rounded-sm object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div className="w-5 h-5 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-[9px]">
                  {authorName.charAt(0).toUpperCase()}
                </div>
              )}
            </button>
            <button
              className="text-text-dim text-[11px] hover:text-accent transition-colors"
              onClick={(e) => { e.stopPropagation(); openProfile(event.pubkey); }}
            >
              {authorName}
            </button>
            {date && <span className="text-text-dim text-[10px]">{date}</span>}
            <span className="text-text-dim text-[10px]">{readingTime} min read</span>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 5).map((tag) => (
                <span key={tag} className="px-1.5 py-0 text-[9px] border border-border text-text-dim">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Cover image thumbnail */}
        {image && (
          <div className="shrink-0 w-24 h-20 rounded-sm overflow-hidden bg-bg-raised">
            <img
              src={image}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
