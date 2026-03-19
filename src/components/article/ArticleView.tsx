import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useUIStore } from "../../stores/ui";
import { useUserStore } from "../../stores/user";
import { useBookmarkStore } from "../../stores/bookmark";
import { fetchArticle, publishReaction } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { ZapModal } from "../zap/ZapModal";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTag(event: NDKEvent, name: string): string {
  return event.tags.find((t) => t[0] === name)?.[1] ?? "";
}

function getTags(event: NDKEvent, name: string): string[] {
  return event.tags.filter((t) => t[0] === name).map((t) => t[1]).filter(Boolean);
}

function renderMarkdown(md: string): string {
  const html = marked(md, { breaks: true }) as string;
  return DOMPurify.sanitize(html);
}

// ── Author row ────────────────────────────────────────────────────────────────

function AuthorRow({ pubkey, publishedAt, readingTime }: { pubkey: string; publishedAt: number | null; readingTime?: number }) {
  const { openProfile } = useUIStore();
  const profile = useProfile(pubkey);
  const name = profile?.displayName || profile?.name || pubkey.slice(0, 12) + "…";
  const date = publishedAt
    ? new Date(publishedAt * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <div className="flex items-center gap-3 mb-6">
      <button className="shrink-0" onClick={() => openProfile(pubkey)}>
        {profile?.picture ? (
          <img src={profile.picture} alt="" className="w-9 h-9 rounded-sm object-cover hover:opacity-80 transition-opacity"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-9 h-9 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-sm">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </button>
      <div>
        <button
          onClick={() => openProfile(pubkey)}
          className="text-text text-[13px] font-medium hover:text-accent transition-colors block"
        >
          {name}
        </button>
        {date && <span className="text-text-dim text-[11px]">{date}</span>}
        {readingTime && <span className="text-text-dim text-[11px]"> · {readingTime} min read</span>}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ArticleView() {
  const { pendingArticleNaddr, pendingArticleEvent, goBack } = useUIStore();
  const { loggedIn } = useUserStore();

  const [event, setEvent] = useState<NDKEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showZap, setShowZap] = useState(false);
  const [reacted, setReacted] = useState(false);
  const { isBookmarked, addBookmark, removeBookmark } = useBookmarkStore();

  const naddr = pendingArticleNaddr ?? "";

  const { markArticleRead } = useBookmarkStore();

  useEffect(() => {
    if (!naddr) { setLoading(false); return; }
    // Use cached event if available (from ArticleCard click), skip relay fetch
    if (pendingArticleEvent) {
      setEvent(pendingArticleEvent);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setEvent(null);
    fetchArticle(naddr)
      .then((e) => {
        if (!e) setError("Article not found — it may not be available on your current relays.");
        else setEvent(e);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [naddr]);

  // Auto-mark article as read when opened
  useEffect(() => {
    if (!event) return;
    const dTag = event.tags.find((t) => t[0] === "d")?.[1];
    if (dTag) {
      markArticleRead(`30023:${event.pubkey}:${dTag}`);
    }
  }, [event]);

  const title = event ? getTag(event, "title") : "";
  const summary = event ? getTag(event, "summary") : "";
  const image = event ? getTag(event, "image") : "";
  const publishedAt = event ? (parseInt(getTag(event, "published_at")) || event.created_at || null) : null;
  const articleTags = event ? getTags(event, "t") : [];
  const authorPubkey = event?.pubkey ?? "";
  const authorProfile = useProfile(authorPubkey);
  const authorName = authorProfile?.displayName || authorProfile?.name || authorPubkey.slice(0, 12) + "…";

  const bodyHtml = event?.content ? renderMarkdown(event.content) : "";
  const wordCount = event?.content?.trim().split(/\s+/).length ?? 0;
  const readingTime = Math.max(1, Math.ceil(wordCount / 230));
  const bookmarked = event?.id ? isBookmarked(event.id) : false;

  const handleReaction = async () => {
    if (!event?.id || reacted) return;
    setReacted(true);
    try {
      await publishReaction(event.id, event.pubkey);
    } catch {
      setReacted(false);
    }
  };

  const handleBookmark = () => {
    if (!event?.id) return;
    if (bookmarked) removeBookmark(event.id);
    else addBookmark(event.id);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
        <button onClick={goBack} className="text-text-dim hover:text-text text-[11px] transition-colors">
          ← back
        </button>
        <div className="flex items-center gap-2">
          {event && loggedIn && (
            <button
              onClick={handleBookmark}
              className={`text-[11px] px-3 py-1 border transition-colors ${
                bookmarked
                  ? "border-accent/40 text-accent"
                  : "border-border text-text-muted hover:text-accent hover:border-accent/40"
              }`}
              title={bookmarked ? "Remove bookmark" : "Bookmark article"}
            >
              {bookmarked ? "▪ saved" : "▫ save"}
            </button>
          )}
          {event && loggedIn && (
            <button
              onClick={() => setShowZap(true)}
              className="text-[11px] px-3 py-1 border border-border text-zap hover:border-zap/40 hover:bg-zap/5 transition-colors"
            >
              ⚡ zap {authorName}
            </button>
          )}
          {naddr && (
            <button
              onClick={() => navigator.clipboard.writeText(`nostr:${naddr}`)}
              className="text-[11px] px-3 py-1 border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
              title="Copy nostr: link"
            >
              copy link
            </button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-8 py-16 text-text-dim text-[12px] text-center">Loading article…</div>
        )}

        {error && (
          <div className="px-8 py-16 text-center space-y-3">
            <p className="text-danger text-[12px]">{error}</p>
            <a
              href={`https://njump.me/${naddr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent text-[11px] hover:text-accent-hover transition-colors"
            >
              Try opening on njump.me ↗
            </a>
          </div>
        )}

        {event && (
          <article className="max-w-2xl mx-auto px-6 py-8">
            {/* Cover image */}
            {image && (
              <div className="mb-6 -mx-2">
                <img
                  src={image}
                  alt=""
                  className="w-full max-h-72 object-cover rounded-sm"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}

            {/* Title */}
            <h1 className="text-text text-2xl font-bold leading-tight mb-3 tracking-tight">
              {title || "Untitled"}
            </h1>

            {/* Summary */}
            {summary && (
              <p className="text-text-muted text-[14px] leading-relaxed mb-4 italic border-l-2 border-border pl-3">
                {summary}
              </p>
            )}

            {/* Author + date + reading time */}
            <AuthorRow pubkey={authorPubkey} publishedAt={publishedAt} readingTime={readingTime} />

            {/* Tags */}
            {articleTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-6">
                {articleTags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 text-[10px] border border-border text-text-dim">
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Content */}
            <div
              className="prose-article"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />

            {/* Footer */}
            <div className="mt-10 pt-6 border-t border-border flex items-center justify-between">
              <button onClick={goBack} className="text-text-dim hover:text-text text-[11px] transition-colors">
                ← back
              </button>
              <div className="flex items-center gap-2">
                {loggedIn && (
                  <button
                    onClick={handleReaction}
                    disabled={reacted}
                    className={`text-[11px] px-3 py-1.5 border transition-colors disabled:cursor-not-allowed ${
                      reacted
                        ? "border-accent/40 text-accent"
                        : "border-border text-text-muted hover:text-accent hover:border-accent/40"
                    }`}
                  >
                    {reacted ? "♥ liked" : "♡ like"}
                  </button>
                )}
                {loggedIn && (
                  <button
                    onClick={handleBookmark}
                    className={`text-[11px] px-3 py-1.5 border transition-colors ${
                      bookmarked
                        ? "border-accent/40 text-accent"
                        : "border-border text-text-muted hover:text-accent hover:border-accent/40"
                    }`}
                  >
                    {bookmarked ? "▪ saved" : "▫ save"}
                  </button>
                )}
                {loggedIn && (
                  <button
                    onClick={() => setShowZap(true)}
                    className="text-[11px] px-4 py-1.5 bg-zap hover:bg-zap/90 text-white transition-colors"
                  >
                    ⚡ Zap {authorName}
                  </button>
                )}
              </div>
            </div>
          </article>
        )}
      </div>

      {showZap && event && (
        <ZapModal
          target={{ type: "profile", pubkey: authorPubkey }}
          recipientName={authorName}
          onClose={() => setShowZap(false)}
        />
      )}
    </div>
  );
}
