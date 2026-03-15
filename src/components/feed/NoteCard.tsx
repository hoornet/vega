import { useState, useRef, useEffect } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useProfile } from "../../hooks/useProfile";
import { useReactionCount } from "../../hooks/useReactionCount";
import { useReplyCount } from "../../hooks/useReplyCount";
import { useZapCount } from "../../hooks/useZapCount";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useBookmarkStore } from "../../stores/bookmark";
import { useUIStore } from "../../stores/ui";
import { timeAgo, shortenPubkey } from "../../lib/utils";
import { nip19 } from "@nostr-dev-kit/ndk";
import { publishReaction, publishReply, publishRepost, getNDK, fetchNoteById } from "../../lib/nostr";
import { NoteContent } from "./NoteContent";
import { ZapModal } from "../zap/ZapModal";
import { QuoteModal } from "./QuoteModal";

interface NoteCardProps {
  event: NDKEvent;
  focused?: boolean;
}

function getParentEventId(event: NDKEvent): string | null {
  const eTags = event.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) return null;
  return eTags.find((t) => t[3] === "reply")?.[1]
    ?? eTags.find((t) => t[3] === "root")?.[1]
    ?? eTags[eTags.length - 1][1];
}

function ParentAuthorName({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const name = profile?.displayName || profile?.name || pubkey.slice(0, 8) + "…";
  return <span className="text-accent">@{name}</span>;
}

export function NoteCard({ event, focused }: NoteCardProps) {
  const profile = useProfile(event.pubkey);
  const name = profile?.displayName || profile?.name || shortenPubkey(event.pubkey);
  const avatar = profile?.picture;
  const nip05 = profile?.nip05;
  const time = event.created_at ? timeAgo(event.created_at) : "";

  const { loggedIn, pubkey: ownPubkey, follows, follow, unfollow } = useUserStore();
  const { mutedPubkeys, mute, unmute } = useMuteStore();
  const isMuted = mutedPubkeys.includes(event.pubkey);
  const { bookmarkedIds, addBookmark, removeBookmark } = useBookmarkStore();
  const isBookmarked = bookmarkedIds.includes(event.id!);
  const { openProfile, openThread, currentView } = useUIStore();

  const parentEventId = getParentEventId(event);
  const parentAuthorPubkey = event.tags.find((t) => t[0] === "p")?.[1] ?? null;

  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focused]);
  const likedKey = "wrystr_liked";
  const getLiked = () => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(likedKey) || "[]")); }
    catch { return new Set<string>(); }
  };
  const [liked, setLiked] = useState(() => getLiked().has(event.id));
  const [liking, setLiking] = useState(false);
  const [reactionCount, adjustReactionCount] = useReactionCount(event.id);
  const [replyCount, adjustReplyCount] = useReplyCount(event.id);
  const [copied, setCopied] = useState(false);
  const zapData = useZapCount(event.id);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySent, setReplySent] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [showZap, setShowZap] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLike = async () => {
    if (!loggedIn || liked || liking) return;
    setLiking(true);
    try {
      await publishReaction(event.id, event.pubkey);
      const liked = getLiked();
      liked.add(event.id);
      localStorage.setItem(likedKey, JSON.stringify(Array.from(liked)));
      setLiked(true);
      adjustReactionCount(1);
    } finally {
      setLiking(false);
    }
  };

  const handleReply = () => {
    setShowReply((v) => !v);
    if (!showReply) setTimeout(() => replyRef.current?.focus(), 50);
  };

  const handleReplySubmit = async () => {
    if (!replyText.trim() || replying) return;
    setReplying(true);
    setReplyError(null);
    try {
      await publishReply(replyText.trim(), { id: event.id, pubkey: event.pubkey });
      setReplyText("");
      setReplySent(true);
      adjustReplyCount(1);
      setTimeout(() => { setShowReply(false); setReplySent(false); }, 1500);
    } catch (err) {
      setReplyError(`Failed: ${err}`);
    } finally {
      setReplying(false);
    }
  };

  const handleReplyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleReplySubmit();
    if (e.key === "Escape") setShowReply(false);
  };

  const handleShare = async () => {
    const nevent = nip19.neventEncode({ id: event.id!, author: event.pubkey });
    await navigator.clipboard.writeText("nostr:" + nevent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRepost = async () => {
    if (reposting || reposted) return;
    setReposting(true);
    try {
      await publishRepost(event);
      setReposted(true);
    } finally {
      setReposting(false);
    }
  };

  return (
    <article
      ref={cardRef}
      className={`border-b border-border px-4 py-3 hover:bg-bg-hover transition-colors duration-100 group/card${focused ? " ring-1 ring-inset ring-accent/30" : ""}`}
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="shrink-0 cursor-pointer" onClick={() => openProfile(event.pubkey)}>
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="w-9 h-9 rounded-sm object-cover bg-bg-raised hover:opacity-80 transition-opacity"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="w-9 h-9 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs hover:border-accent/40 transition-colors">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span
              className="text-text font-medium truncate text-[13px] cursor-pointer hover:text-accent transition-colors"
              onClick={() => openProfile(event.pubkey)}
            >{name}</span>
            {nip05 && (
              <span className="text-text-dim text-[10px] truncate max-w-40">{nip05}</span>
            )}
            <span className="text-text-dim text-[11px] shrink-0">{time}</span>
            {/* Context menu — hidden until card hover, not shown for own notes */}
            {loggedIn && event.pubkey !== ownPubkey && (
              <div className="relative ml-auto">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="text-text-dim hover:text-text text-[14px] px-1 leading-none opacity-0 group-hover/card:opacity-100 transition-opacity"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-[9]" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-5 bg-bg-raised border border-border shadow-lg z-10 w-32">
                      <button
                        onClick={() => { setMenuOpen(false); follows.includes(event.pubkey) ? unfollow(event.pubkey) : follow(event.pubkey); }}
                        className="w-full text-left px-3 py-2 text-[11px] text-text-muted hover:text-accent hover:bg-bg-hover transition-colors"
                      >
                        {follows.includes(event.pubkey) ? `unfollow` : `follow`}
                      </button>
                      <button
                        onClick={() => { setMenuOpen(false); isMuted ? unmute(event.pubkey) : mute(event.pubkey); }}
                        className="w-full text-left px-3 py-2 text-[11px] text-text-muted hover:text-danger hover:bg-bg-hover transition-colors"
                      >
                        {isMuted ? `unmute` : `mute`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {parentEventId && parentAuthorPubkey && (
            <div className="text-text-dim text-[11px] mb-1.5 flex items-center gap-1">
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const parent = await fetchNoteById(parentEventId);
                  if (parent) openThread(parent, currentView as "feed" | "profile");
                }}
                className="hover:text-accent transition-colors"
              >
                ↩ replying to
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openProfile(parentAuthorPubkey);
                }}
                className="hover:text-accent transition-colors"
              >
                <ParentAuthorName pubkey={parentAuthorPubkey} />
              </button>
            </div>
          )}

          <div
            className="cursor-pointer"
            onClick={() => openThread(event, currentView as "feed" | "profile")}
          >
            <NoteContent content={event.content} inline />
          </div>
          <NoteContent content={event.content} mediaOnly />

          {/* Actions */}
          {loggedIn && !!getNDK().signer && (
            <div className="flex items-center gap-4 mt-2">
              <button
                onClick={handleReply}
                className={`text-[11px] transition-colors ${
                  showReply ? "text-accent" : "text-text-dim hover:text-text"
                }`}
              >
                reply{replyCount !== null && replyCount > 0 ? ` ${replyCount}` : ""}
              </button>
              <button
                onClick={handleLike}
                disabled={liked || liking}
                className={`text-[11px] transition-colors ${
                  liked ? "text-accent" : "text-text-dim hover:text-accent"
                } disabled:cursor-default`}
              >
                {liked ? "♥" : "♡"}{reactionCount !== null && reactionCount > 0 ? ` ${reactionCount}` : liked ? " liked" : " like"}
              </button>
              <button
                onClick={handleRepost}
                disabled={reposting || reposted}
                className={`text-[11px] transition-colors disabled:cursor-default ${
                  reposted ? "text-accent" : "text-text-dim hover:text-accent"
                }`}
              >
                {reposted ? "reposted ✓" : reposting ? "…" : "repost"}
              </button>
              <button
                onClick={() => setShowQuote(true)}
                className="text-[11px] text-text-dim hover:text-text transition-colors"
              >
                quote
              </button>
              {(profile?.lud16 || profile?.lud06) && (
                <button
                  onClick={() => setShowZap(true)}
                  className="text-[11px] text-text-dim hover:text-zap transition-colors"
                >
                  {zapData && zapData.totalSats > 0
                    ? `⚡ ${zapData.totalSats.toLocaleString()} sats`
                    : "⚡ zap"}
                </button>
              )}
              <button
                onClick={() => isBookmarked ? removeBookmark(event.id!) : addBookmark(event.id!)}
                className={`text-[11px] transition-colors ${
                  isBookmarked ? "text-accent" : "text-text-dim hover:text-accent"
                }`}
              >
                {isBookmarked ? "▪ saved" : "▫ save"}
              </button>
              <button
                onClick={handleShare}
                className={`text-[11px] transition-colors ${
                  copied ? "text-accent" : "text-text-dim hover:text-text"
                }`}
              >
                {copied ? "copied ✓" : "share"}
              </button>
            </div>
          )}

          {/* Stats visible when logged out */}
          {!loggedIn && (
            <div className="flex items-center gap-3 mt-1.5">
              {replyCount !== null && replyCount > 0 && (
                <span className="text-text-dim text-[11px]">↩ {replyCount}</span>
              )}
              {reactionCount !== null && reactionCount > 0 && (
                <span className="text-text-dim text-[11px]">♥ {reactionCount}</span>
              )}
              {zapData !== null && zapData.totalSats > 0 && (
                <span className="text-zap text-[11px]">⚡ {zapData.totalSats.toLocaleString()} sats</span>
              )}
              <button
                onClick={handleShare}
                className={`text-[11px] transition-colors ${
                  copied ? "text-accent" : "text-text-dim hover:text-text"
                }`}
              >
                {copied ? "copied ✓" : "share"}
              </button>
            </div>
          )}

          {showZap && (
            <ZapModal
              target={{ type: "note", event, recipientPubkey: event.pubkey }}
              recipientName={name}
              onClose={() => setShowZap(false)}
            />
          )}

          {showQuote && (
            <QuoteModal
              event={event}
              authorName={name}
              authorAvatar={avatar}
              onClose={() => setShowQuote(false)}
            />
          )}

          {/* Inline reply box */}
          {showReply && (
            <div className="mt-2 border-l-2 border-border pl-3">
              <textarea
                ref={replyRef}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={handleReplyKeyDown}
                placeholder={`Reply to ${name}…`}
                rows={2}
                className="w-full bg-transparent text-text text-[12px] placeholder:text-text-dim resize-none focus:outline-none"
              />
              {replyError && <p className="text-danger text-[10px] mb-1">{replyError}</p>}
              <div className="flex items-center justify-end gap-2 mt-1">
                <span className="text-text-dim text-[10px]">Ctrl+Enter</span>
                <button
                  onClick={handleReplySubmit}
                  disabled={!replyText.trim() || replying}
                  className="px-2 py-0.5 text-[10px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {replySent ? "replied ✓" : replying ? "posting…" : "reply"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
