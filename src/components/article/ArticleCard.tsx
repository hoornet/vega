import { memo, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { Bookmark } from "lucide-react";
import { useProfile } from "../../hooks/useProfile";
import { useUIStore } from "../../stores/ui";
import { useCanSign } from "../../stores/user";
import { useBookmarkStore } from "../../stores/bookmark";
import { shortenPubkey, profileName } from "../../lib/utils";
import { articleAddr, articleNaddr, cardSummary, getTag, getTags, publishedAt, readingMinutes } from "../../lib/article";
import { Button } from "../shared/Button";

// The row an article is in a list: Articles, a profile's Articles tab, the
// reading list, search, and the Trending feed. Rebuilt after the October 2026
// UI review, when it was one wide grey block per article: the summary ran the
// full pane, up to five bordered tag chips that did nothing were the loudest
// thing after the title, and the thumbnail sat 870px from it.
//
// Byline, then the title in the reading face, then two lines of summary, then
// a quiet footer: reading time, up to two tags, Save. The cover is a small
// 3:2 picture beside the title, and the column goes when it fails to load.
// `feedEstimate.ts` guesses this card's height for the virtual feed: when its
// layout changes, measure and update `articleHeight` there.

/** How many tags the footer shows. The rest are on the article itself. */
export const CARD_TAGS = 2;

interface ArticleCardProps {
  event: NDKEvent;
  /** False on the author's own profile, where every card would name them. */
  showAuthor?: boolean;
  /** Reading-list state. Unread gets a dot before the title; read, a quiet title. Leave out when not tracked. */
  read?: boolean;
  /** More controls for the footer, before Save (the reading list's "Mark read"). */
  actions?: ReactNode;
}

export const ArticleCard = memo(function ArticleCard({ event, showAuthor = true, read, actions }: ArticleCardProps) {
  const { openArticle, openProfile, openHashtag } = useUIStore();
  const canSign = useCanSign();
  const profile = useProfile(event.pubkey);
  const addr = articleAddr(event);
  // One field, not the whole store: a card subscribed to everything re-rendered on any bookmark change.
  const saved = useBookmarkStore((s) => (addr ? s.isArticleBookmarked(addr) : false));
  const [coverFailed, setCoverFailed] = useState(false);

  const title = getTag(event, "title") || "Untitled";
  const summary = useMemo(() => cardSummary(getTag(event, "summary"), event.content ?? "", title), [event, title]);
  const image = getTag(event, "image");
  const tags = getTags(event, "t").slice(0, CARD_TAGS);
  const when = publishedAt(event);
  const naddr = articleNaddr(event);

  const authorName = profileName(profile, shortenPubkey(event.pubkey));
  const date = when
    ? new Date(when * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  if (!naddr) return null;

  const open = () => openArticle(naddr, event);
  // The card is a target as a whole, but anything inside it that is itself a
  // control (the author, a tag, Save) does its own thing and not that too.
  const cardClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    open();
  };
  const toggleSave = () => {
    if (!addr) return;
    const { addArticleBookmark, removeArticleBookmark } = useBookmarkStore.getState();
    if (saved) void removeArticleBookmark(addr);
    else void addArticleBookmark(addr);
  };

  return (
    <article
      className="border-b border-border-subtle px-4 py-4 hover:bg-bg-hover transition-colors cursor-pointer"
      onClick={cardClick}
    >
      {/* Byline */}
      <div className="flex items-center gap-2 mb-1.5 text-ui text-text-muted">
        {showAuthor && (
          <>
            <button type="button" className="shrink-0" onClick={() => openProfile(event.pubkey)} aria-label={`${authorName}'s profile`}>
              {profile?.picture ? (
                <img
                  src={profile.picture}
                  alt=""
                  className="w-5 h-5 rounded-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <span className="w-5 h-5 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-micro" aria-hidden>
                  {authorName.charAt(0).toUpperCase()}
                </span>
              )}
            </button>
            <button type="button" className="font-medium truncate hover:text-accent transition-colors" onClick={() => openProfile(event.pubkey)}>
              {authorName}
            </button>
          </>
        )}
        {date && <span className="shrink-0">{showAuthor ? `· ${date}` : date}</span>}
      </div>

      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          {/* Title: the one full-contrast thing on the card. The clamp is on a
              block inside the button: a clamp on the heading did not count the
              lines of an inline-block button, and a long title ran to four. */}
          <h3 className={`font-reading text-heading font-semibold ${read ? "text-text-muted" : "text-text"}`}>
            <button type="button" className="block w-full text-left" onClick={open}>
              <span className="line-clamp-2">
                {read === false && <><span aria-hidden className="inline-block size-1.5 rounded-full bg-accent mr-2 align-middle" /><span className="sr-only">Unread: </span></>}
                {title}
              </span>
            </button>
          </h3>
          {summary && (
            <p className="text-body text-text-muted line-clamp-2 mt-1">{summary}</p>
          )}
        </div>

        {/* Cover: a small 3:2 picture, and no empty frame when it fails */}
        {image && !coverFailed && (
          <img
            src={image}
            alt=""
            className="shrink-0 w-36 h-24 rounded-lg object-cover bg-bg-raised"
            onError={() => setCoverFailed(true)}
          />
        )}
      </div>

      {/* Footer: quiet facts, and the one control. A fixed minimum height, so
          the row is the same height signed in or out (the feed estimates it). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 min-h-7 text-caption text-text-muted">
        <span className="shrink-0">{readingMinutes(event.content)} min read</span>
        {tags.map((tag) => (
          <button key={tag} type="button" className="max-w-40 truncate hover:text-accent transition-colors" onClick={() => openHashtag(tag)}>
            #{tag}
          </button>
        ))}
        <span className="flex-1" />
        {actions}
        {canSign && addr && (
          <Button square size="sm" variant="ghost" pressed={saved} onClick={toggleSave} aria-label={saved ? "Remove from reading list" : "Save to reading list"} title={saved ? "Saved" : "Save"}>
            <Bookmark fill={saved ? "currentColor" : "none"} />
          </Button>
        )}
      </div>
    </article>
  );
});
