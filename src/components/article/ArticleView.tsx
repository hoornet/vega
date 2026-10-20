import { useEffect, useId, useState, useRef, useCallback } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useAutoResize } from "../../hooks/useAutoResize";
import { useUIStore } from "../../stores/ui";
import { useCanSign, useUserStore } from "../../stores/user";
import { useBookmarkStore } from "../../stores/bookmark";
import { useRepostedStore, repostKey } from "../../stores/reposted";
import { repostNote } from "../../lib/repost";
import { fetchArticle, fetchAuthorArticles, publishReaction, publishNote } from "../../lib/nostr";
import { nip19 } from "@nostr-dev-kit/ndk";
import { useProfile } from "../../hooks/useProfile";
import { useLoadedList } from "../../hooks/useLoadedList";
import { nameOf } from "../../lib/utils";
import { AvatarInitial } from "../shared/AvatarInitial";
import { articleAddr, getTag, getTags, publishedAt as articlePublishedAt, readingProgress } from "../../lib/article";
import { useDraftStore } from "../../stores/drafts";
import { ZapModal } from "../zap/ZapModal";
import { ArticleBody } from "./ArticleBody";
import { ViewHeader } from "../shared/ViewHeader";
import { Button } from "../shared/Button";
import { FollowButton } from "../shared/FollowButton";
import { ArticleCard } from "./ArticleCard";
import { ArrowLeft, Bookmark, Check, Heart, Link, MessageCircle, Pencil, Repeat2, Zap } from "lucide-react";
import { copyText } from "../../lib/clipboard";
import { tellPublish } from "../../lib/publishFeedback";

// The reader. Its typography lives in index.css under `.reader-page`,
// `.reader` and `.prose-article`: sizes in em on a fluid base, so the measure
// follows the window and the text-size preset, and not steps of the UI scale.
//
// App.tsx keys this view by the article's address, so opening another article
// (from "More from", or Back) is a new instance: a comment or a like still on
// its way for the last one cannot land on this one, and nothing here has to
// be reset by hand.

// ── Types ────────────────────────────────────────────────────────────────────

interface TocHeading {
  id: string;
  text: string;
  level: number;
}

/** Read means the reader got this far down, or the whole article fit the pane. */
export const READ_AT_PERCENT = 90;
/** How many of the writer's other articles are offered at the end. */
export const MORE_FROM_AUTHOR = 3;

// ── Author card, at the end ──────────────────────────────────────────────────

function AuthorCard({ pubkey, onZap }: { pubkey: string; onZap: () => void }) {
  const { openProfile } = useUIStore();
  const canSign = useCanSign();
  const own = useUserStore((s) => s.pubkey) === pubkey;
  const profile = useProfile(pubkey);
  const name = nameOf(profile, pubkey);
  const bio = typeof profile?.about === "string" ? profile.about.replace(/\s+/g, " ").trim() : "";

  return (
    <section aria-label="About the writer" className="mt-10 rounded-lg border border-border p-4 flex gap-4 items-start">
      <button type="button" className="shrink-0" onClick={() => openProfile(pubkey)} aria-label={`${name}'s profile`}>
        {profile?.picture ? (
          <img src={profile.picture} alt="" className="w-12 h-12 rounded-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <span className="w-12 h-12 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-title" aria-hidden>
            <AvatarInitial profile={profile} />
          </span>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <button type="button" onClick={() => openProfile(pubkey)} className="text-text text-body font-medium hover:text-accent transition-colors block truncate max-w-full">
          {name}
        </button>
        {bio && <p className="text-ui text-text-muted line-clamp-2 mt-0.5">{bio}</p>}
      </div>
      <div className="flex gap-2 shrink-0 flex-wrap justify-end">
        {canSign && !own && <Button onClick={onZap}><Zap className="text-zap" />Zap</Button>}
        <FollowButton pubkey={pubkey} />
      </div>
    </section>
  );
}

// ── More from this writer ─────────────────────────────────────────────────────

function MoreFromAuthor({ pubkey, except }: { pubkey: string; except: string | null }) {
  const profile = useProfile(pubkey);
  const name = nameOf(profile, pubkey);
  // The body may carry ids of its own (DOMPurify keeps them), so this one is made unique.
  const headingId = useId();
  // Asked a second time after an empty answer, as the profile's own lists are:
  // one relay's quick "nothing" is not the writer's whole shelf (seen once
  // in the capture harness: 0 in 55 ms, then 8 in 290 ms).
  const list = useLoadedList(() => fetchAuthorArticles(pubkey, MORE_FROM_AUTHOR + 6), [pubkey], { enabled: !!pubkey, retryEmptyAfterMs: 3000 });
  // Newest first, one per address: two relays can hold two revisions of one article.
  const seen = new Set<string>();
  const others = list.items
    .filter((e) => articleAddr(e) !== except && getTag(e, "title"))
    .sort((a, b) => (articlePublishedAt(b) ?? 0) - (articlePublishedAt(a) ?? 0))
    .filter((e) => { const a = articleAddr(e) ?? e.id; if (seen.has(a)) return false; seen.add(a); return true; })
    .slice(0, MORE_FROM_AUTHOR);
  // Nothing is said when there is nothing, or when the relays did not answer:
  // the end of an article is not the place for an error about another list.
  if (list.status !== "loaded" || others.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="text-body font-medium text-text mb-1">More from {name}</h2>
      <div className="-mx-4" data-more-from>
        {others.map((e) => <ArticleCard key={e.id} event={e} showAuthor={false} />)}
      </div>
    </section>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ArticleView() {
  const { pendingArticleNaddr, pendingArticleEvent, goBack } = useUIStore();
  const canSign = useCanSign();
  const account = useUserStore((s) => s.pubkey);

  const [event, setEvent] = useState<NDKEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showZap, setShowZap] = useState(false);
  const [reacted, setReacted] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [commentText, setCommentText] = useState("");
  const autoResize = useAutoResize(3, 10);
  const { isBookmarked, addBookmark, removeBookmark, isArticleBookmarked, addArticleBookmark, removeArticleBookmark, markArticleRead } = useBookmarkStore();

  // Reading progress bar + TOC
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [activeId, setActiveId] = useState("");
  /** The address marked read for this article, so it is marked once. */
  const markedRead = useRef<string | null>(null);

  const naddr = pendingArticleNaddr ?? "";

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

  const title = event ? getTag(event, "title") : "";
  const summary = event ? getTag(event, "summary") : "";
  const image = event ? getTag(event, "image") : "";
  const publishedAt = event ? articlePublishedAt(event) : null;
  const articleTags = event ? getTags(event, "t") : [];
  const authorPubkey = event?.pubkey ?? "";
  const authorProfile = useProfile(authorPubkey);
  const authorName = nameOf(authorProfile, authorPubkey);

  const addr = event ? articleAddr(event) : null;
  const bookmarked = addr ? isArticleBookmarked(addr) : (event?.id ? isBookmarked(event.id) : false);
  const reposted = useRepostedStore((s) => (event ? s.byKey[repostKey(account, event.id)] : undefined));

  // Extract headings from the rendered content (ArticleBody renders it, in the same commit) and assign IDs
  useEffect(() => {
    const el = contentRef.current;
    if (!el) { setHeadings([]); return; }
    const nodes = el.querySelectorAll("h2, h3");
    const items: TocHeading[] = [];
    nodes.forEach((node, i) => {
      const id = `toc-${i}`;
      node.id = id;
      items.push({ id, text: node.textContent || "", level: parseInt(node.tagName[1]) });
    });
    setHeadings(items);
    if (items.length > 0) setActiveId(items[0].id);
  }, [event, title]);

  // How far through the text the reader is: measured to the end of the body,
  // not of the page, which goes on with the footer, the writer and their
  // other articles. Without a layout (the body has no height yet, or none at
  // all in a test) the whole page stands in for the body.
  const progressIn = useCallback((el: HTMLElement) => {
    const body = contentRef.current;
    const rect = body?.getBoundingClientRect();
    const bodyEnd = rect && rect.height > 0 ? rect.bottom - el.getBoundingClientRect().top + el.scrollTop : el.scrollHeight;
    return readingProgress(el.scrollTop, el.clientHeight, bodyEnd);
  }, []);

  // Read means read: the article was opened and the reader got most of the
  // way down, or all of it fit the pane. Opening it used to mark it read, so a
  // mis-click cleared the unread dot and the sidebar badge.
  const noteRead = useCallback((el: HTMLElement) => {
    if (!addr || markedRead.current === addr) return;
    if (progressIn(el) < READ_AT_PERCENT) return;
    markedRead.current = addr;
    markArticleRead(addr);
  }, [addr, markArticleRead, progressIn]);

  // A picture that loads can make a short article fit the pane, or stop fitting it.
  const onImageFit = useCallback(() => { if (scrollRef.current) noteRead(scrollRef.current); }, [noteRead]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setProgress(progressIn(el));
    noteRead(el);

    // Track active heading — find the last heading above the top ~80px of scroll area
    const scrollRect = el.getBoundingClientRect();
    let active = "";
    for (const { id } of headings) {
      const heading = document.getElementById(id);
      if (!heading) continue;
      const top = heading.getBoundingClientRect().top - scrollRect.top;
      if (top <= 80) active = id;
    }
    if (active) setActiveId(active);
  }, [headings, noteRead, progressIn]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !event) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    // A short article never scrolls. If all of it is in view, it has been read.
    noteRead(el);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [event, handleScroll, noteRead]);

  const scrollToHeading = useCallback((id: string) => {
    const el = document.getElementById(id);
    const scrollEl = scrollRef.current;
    if (!el || !scrollEl) return;
    const scrollRect = scrollEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offset = elRect.top - scrollRect.top + scrollEl.scrollTop - 16;
    scrollEl.scrollTo({ top: offset, behavior: "smooth" });
  }, []);

  const handleReaction = async () => {
    if (!event?.id || reacted) return;
    setReacted(true);
    // The heart un-filled and nothing said why.
    const told = await tellPublish(() => publishReaction(event.id, event.pubkey), { kept: "Your like was not sent." });
    if (!told.ok) setReacted(false);
  };

  const handleBookmark = () => {
    if (!event) return;
    if (addr) {
      if (bookmarked) removeArticleBookmark(addr);
      else addArticleBookmark(addr);
    } else if (event.id) {
      if (bookmarked) removeBookmark(event.id);
      else addBookmark(event.id);
    }
  };

  // The feed's repost: claimed per account and note in the reposted store (it
  // used to be local state here, gone when the article was opened again), and
  // a failure says so with "Try again".
  const handleRepost = () => {
    if (!event || !account) return;
    void repostNote(account, event);
  };

  const commenting = useRef(false);
  const handleComment = async () => {
    if (!event || !commentText.trim()) return;
    const dTag = getTag(event, "d");
    const naddrStr = nip19.naddrEncode({ identifier: dTag, pubkey: event.pubkey, kind: 30023 });
    const text = `${commentText.trim()}\n\nnostr:${naddrStr}`;
    // The box closes and the article looks as it did. A comment is a note of
    // its own, so say that it went out and offer to open it. A failure used
    // to be ignored: the box stayed open and nothing said why.
    // One at a time: a second press while the first was on its way posted the comment twice.
    if (commenting.current) return;
    commenting.current = true;
    const told = await tellPublish(() => publishNote(text), { done: "Comment posted.", kept: "Your comment is still in the box.", view: (note) => note });
    commenting.current = false;
    if (!told.ok) return;
    setCommentText("");
    setShowComment(false);
  };

  // The box opens under the footer, where Comment is; it used to open at the
  // top of the view and throw the reader back to the title.
  const commentBox = useRef<HTMLDivElement>(null);
  const openComment = () => {
    setShowComment(true);
    requestAnimationFrame(() => commentBox.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
  };

  // The web link opens anywhere; the nostr: address only in a Nostr client.
  const webLink = naddr ? `https://njump.me/${naddr}` : "";

  // Your own article opens in the editor as a draft that keeps its address,
  // so publishing replaces it. Every publish used to mint a new one.
  const { setView } = useUIStore();
  const editArticle = () => {
    if (!event) return;
    const dTag = getTag(event, "d") || undefined;
    const drafts = useDraftStore.getState();
    // One draft per article: a second Edit returns to the edit in progress
    // instead of making a twin whose stale publish would replace the newer one.
    const existing = dTag ? drafts.drafts.find((d) => d.dTag === dTag) : undefined;
    if (existing) drafts.setActiveDraft(existing.id);
    else drafts.createDraft({ title, content: event.content ?? "", summary, image, tags: articleTags.join(", "), dTag, publishedAt: publishedAt ?? undefined });
    setView("article-editor");
  };

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        onBack={goBack}
        actions={
          <>
            {event && canSign && (
              <Button square variant="ghost" pressed={bookmarked} onClick={handleBookmark} aria-label={bookmarked ? "Remove from reading list" : "Save to reading list"} title={bookmarked ? "Saved" : "Save"}>
                <Bookmark fill={bookmarked ? "currentColor" : "none"} />
              </Button>
            )}
            {event && canSign && (
              <Button square variant="ghost" onClick={() => setShowZap(true)} aria-label={`Zap ${authorName}`} title="Zap">
                <Zap className="text-zap" />
              </Button>
            )}
            {event && canSign && (
              <Button square variant="ghost" disabled={reposted === "done"} busy={reposted === "pending"} onClick={handleRepost} aria-label={reposted === "done" ? "Reposted" : "Repost"} title={reposted === "done" ? "Reposted" : "Repost"}>
                {reposted === "done" ? <Check /> : <Repeat2 />}
              </Button>
            )}
            {event && canSign && (
              <Button square variant="ghost" aria-expanded={showComment} onClick={() => (showComment ? setShowComment(false) : openComment())} aria-label="Comment" title="Comment">
                <MessageCircle />
              </Button>
            )}
            {event && canSign && account === event.pubkey && (
              <Button square variant="ghost" onClick={editArticle} aria-label="Edit article" title="Edit">
                <Pencil />
              </Button>
            )}
            {naddr && (
              <Button square variant="ghost" onClick={() => void copyText(webLink, "Link copied.")} aria-label="Copy link" title="Copy link">
                <Link />
              </Button>
            )}
          </>
        }
      />

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Reading progress bar */}
        {event && (
          <div className="sticky top-0 z-10 h-0.5 bg-transparent">
            <div
              className="h-full bg-accent transition-[width] duration-150 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {loading && (
          <div className="px-8 py-16 text-text-muted text-body text-center">Loading article…</div>
        )}

        {error && (
          <div className="px-8 py-16 text-center space-y-3">
            <p className="text-danger text-body">{error}</p>
            <a
              href={`https://njump.me/${naddr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent text-caption hover:text-accent-hover transition-colors"
            >
              Try opening on njump.me ↗
            </a>
          </div>
        )}

        {event && (
          // Three columns on a wide pane: the text in the middle, the contents
          // list beside it. It used to be pinned to the far edge of the window.
          // Three columns when the pane (not the window: the sidebar takes up to
          // 360px of it) is wide enough for the text and a contents list beside it.
          // The container query is on a wrapper, not on the grid: with inline-size
          // containment on the grid itself Chromium gave the two `1fr` sides 449
          // and 240px and the text sat 98px off centre.
          <div className="@container">
          <div className="reader-page grid grid-cols-1 @[1180px]:grid-cols-[1fr_minmax(0,calc(34em+3rem))_1fr]">
            <article className="reader @[1180px]:col-start-2">
              <ArticleBody title={title} summary={summary} image={image} pubkey={authorPubkey} publishedAt={publishedAt} content={event.content ?? ""} contentRef={contentRef} onImageFit={onImageFit} />

              {/* Tags, at the end: where to go next, not a row of chips before the first word */}
              {articleTags.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-8">
                  {articleTags.map((tag) => (
                    <TagChip key={tag} tag={tag} />
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="mt-8 pt-6 border-t border-border-subtle flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" className="-ml-3" onClick={goBack}><ArrowLeft />Back</Button>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {canSign && (
                    <Button disabled={reacted} onClick={handleReaction}><Heart fill={reacted ? "currentColor" : "none"} />{reacted ? "Liked" : "Like"}</Button>
                  )}
                  {canSign && (
                    <Button pressed={bookmarked} onClick={handleBookmark}><Bookmark fill={bookmarked ? "currentColor" : "none"} />{bookmarked ? "Saved" : "Save"}</Button>
                  )}
                  {canSign && (
                    <Button disabled={reposted === "done"} busy={reposted === "pending"} onClick={handleRepost}>{reposted === "done" ? <Check /> : <Repeat2 />}{reposted === "done" ? "Reposted" : "Repost"}</Button>
                  )}
                  {canSign && (
                    <Button aria-expanded={showComment} onClick={() => (showComment ? setShowComment(false) : openComment())}><MessageCircle />Comment</Button>
                  )}
                  {canSign && (
                    <Button variant="primary" tone="zap" onClick={() => setShowZap(true)}><Zap /><span className="max-w-48 truncate">Zap {authorName}</span></Button>
                  )}
                </div>
              </div>

              {/* Comment box, under the row that opens it */}
              {showComment && (
                <div ref={commentBox} className="mt-4">
                  <textarea
                    value={commentText}
                    onChange={(e) => { setCommentText(e.target.value); autoResize(e); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleComment(); } }}
                    placeholder="Write a comment…"
                    aria-label="Comment"
                    rows={3}
                    className="w-full bg-bg-raised border border-border-strong rounded-lg px-3 py-2 text-body font-ui text-text placeholder:text-text-dim resize-none focus:outline-none focus:border-accent leading-relaxed"
                    autoFocus
                  />
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-text-muted text-caption">Shift+Enter for new line</span>
                    <Button variant="primary" onClick={handleComment} disabled={!commentText.trim()}>Post</Button>
                  </div>
                </div>
              )}

              <AuthorCard pubkey={authorPubkey} onZap={() => setShowZap(true)} />
              <MoreFromAuthor pubkey={authorPubkey} except={addr} />
            </article>

            {/* Contents, beside the text on a wide pane */}
            {headings.length >= 2 && (
              <nav aria-label="Contents" className="hidden @[1180px]:block @[1180px]:col-start-3 justify-self-start pl-8 w-60 py-10">
                <div className="sticky top-4 max-h-[calc(var(--window-h)-8rem)] overflow-y-auto overflow-x-hidden">
                  <p className="text-text-muted text-micro uppercase tracking-wider mb-3">Contents</p>
                  {headings.map(({ id, text, level }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => scrollToHeading(id)}
                      aria-current={activeId === id ? "true" : undefined}
                      // Indent with padding, not a margin: a margin on a full-width row overflowed the column by its own width.
                      className={`block text-left w-full py-1 text-caption leading-snug transition-colors line-clamp-2 border-l-2 ${
                        level === 3 ? "pl-6" : "pl-3"
                      } ${
                        activeId === id
                          ? "text-text border-accent"
                          : "text-text-muted border-transparent hover:text-text"
                      }`}
                      title={text}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </nav>
            )}
          </div>
          </div>
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

function TagChip({ tag }: { tag: string }) {
  const { openHashtag } = useUIStore();
  return (
    <button type="button" onClick={() => openHashtag(tag)} className="text-ui font-ui text-text-muted hover:text-accent transition-colors">
      #{tag}
    </button>
  );
}
