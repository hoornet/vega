import { useState } from "react";
import { NDKEvent, nip19 } from "@nostr-dev-kit/ndk";
import { useProfile } from "../../hooks/useProfile";
import { useReactionCount } from "../../hooks/useReactionCount";
import { useReplyCount } from "../../hooks/useReplyCount";
import { useZapCount } from "../../hooks/useZapCount";
import { useUserStore } from "../../stores/user";
import { useBookmarkStore } from "../../stores/bookmark";
import { publishReaction, publishRepost } from "../../lib/nostr";
import { ZapModal } from "../zap/ZapModal";
import { QuoteModal } from "./QuoteModal";

const REACTION_EMOJIS = ["❤️", "🤙", "🔥", "😂", "🫡", "👀", "⚡"];

interface NoteActionsProps {
  event: NDKEvent;
  onReplyToggle: () => void;
  showReply: boolean;
}

export function NoteActions({ event, onReplyToggle, showReply }: NoteActionsProps) {
  const profile = useProfile(event.pubkey);
  const name = profile?.displayName || profile?.name || event.pubkey.slice(0, 8) + "…";
  const avatar = profile?.picture;
  const { loggedIn } = useUserStore();
  const { bookmarkedIds, addBookmark, removeBookmark } = useBookmarkStore();
  const isBookmarked = bookmarkedIds.includes(event.id!);

  const likedKey = "wrystr_liked";
  const getLiked = () => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(likedKey) || "[]")); }
    catch { return new Set<string>(); }
  };
  const [liked, setLiked] = useState(() => getLiked().has(event.id));
  const [liking, setLiking] = useState(false);
  const [reactionCount, adjustReactionCount] = useReactionCount(event.id);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [replyCount] = useReplyCount(event.id);
  const [copied, setCopied] = useState(false);
  const zapData = useZapCount(event.id);
  const [showZap, setShowZap] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [reposted, setReposted] = useState(false);

  const handleReact = async (emoji?: string) => {
    if (!loggedIn || liked || liking) return;
    setLiking(true);
    setShowEmojiPicker(false);
    try {
      await publishReaction(event.id, event.pubkey, emoji || "+");
      const likedSet = getLiked();
      likedSet.add(event.id);
      localStorage.setItem(likedKey, JSON.stringify(Array.from(likedSet)));
      setLiked(true);
      adjustReactionCount(1);
    } finally {
      setLiking(false);
    }
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
    <>
      <div className="flex items-center gap-4 mt-2">
        <button
          onClick={onReplyToggle}
          className={`text-[11px] transition-colors ${
            showReply ? "text-accent" : "text-text-dim hover:text-text"
          }`}
        >
          reply{replyCount !== null && replyCount > 0 ? ` ${replyCount}` : ""}
        </button>
        <div className="relative flex items-center gap-1">
          <button
            onClick={() => handleReact("❤️")}
            disabled={liked || liking}
            className={`text-[11px] transition-colors ${
              liked ? "text-accent" : "text-text-dim hover:text-accent"
            } disabled:cursor-default`}
          >
            {liked ? "♥" : "♡"}{reactionCount !== null && reactionCount > 0 ? ` ${reactionCount}` : liked ? " liked" : " like"}
          </button>
          {!liked && !liking && (
            <button
              onClick={() => setShowEmojiPicker((v) => !v)}
              className="text-[10px] text-text-dim hover:text-accent transition-colors opacity-0 group-hover/card:opacity-100"
              title="React with emoji"
            >
              +
            </button>
          )}
          {showEmojiPicker && (
            <>
              <div className="fixed inset-0 z-[9]" onClick={() => setShowEmojiPicker(false)} />
              <div className="absolute bottom-6 left-0 bg-bg-raised border border-border shadow-lg z-10 flex gap-0.5 px-1.5 py-1">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReact(emoji)}
                    className="text-[16px] hover:scale-125 transition-transform px-0.5"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
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
    </>
  );
}

export function LoggedOutStats({ event }: { event: NDKEvent }) {
  const [reactionCount] = useReactionCount(event.id);
  const [replyCount] = useReplyCount(event.id);
  const zapData = useZapCount(event.id);
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const nevent = nip19.neventEncode({ id: event.id!, author: event.pubkey });
    await navigator.clipboard.writeText("nostr:" + nevent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
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
  );
}
