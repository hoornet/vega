import { useState } from "react";
import { NDKEvent, nip19 } from "@nostr-dev-kit/ndk";
import { useProfile } from "../../hooks/useProfile";
import { useReactions } from "../../hooks/useReactions";
import { useReplyCount } from "../../hooks/useReplyCount";
import { useZapCount } from "../../hooks/useZapCount";
import { useUserStore } from "../../stores/user";
import { useBookmarkStore } from "../../stores/bookmark";
import { publishReaction, publishRepost } from "../../lib/nostr";
import { profileName } from "../../lib/utils";
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
  const name = profileName(profile, event.pubkey.slice(0, 8) + "…");
  const avatar = typeof profile?.picture === "string" ? profile.picture : undefined;
  const { loggedIn } = useUserStore();
  const { bookmarkedIds, addBookmark, removeBookmark } = useBookmarkStore();
  const isBookmarked = bookmarkedIds.includes(event.id!);

  const [reactionsData, addReaction] = useReactions(event.id);
  const [reacting, setReacting] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [replyCount] = useReplyCount(event.id);
  const [copied, setCopied] = useState(false);
  const zapData = useZapCount(event.id);
  const [showZap, setShowZap] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [reposted, setReposted] = useState(false);

  const myReactions = reactionsData?.myReactions ?? new Set<string>();

  const handleReact = async (emoji: string) => {
    if (!loggedIn || reacting || myReactions.has(emoji)) return;
    setReacting(true);
    setShowEmojiPicker(false);
    try {
      await publishReaction(event.id, event.pubkey, emoji);
      addReaction(emoji);
    } finally {
      setReacting(false);
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

  // Sort emoji groups: most popular first
  const sortedGroups = reactionsData
    ? Array.from(reactionsData.groups.entries()).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
        <button
          onClick={onReplyToggle}
          title="Reply"
          className={`text-[11px] transition-colors ${
            showReply ? "text-accent" : "text-text hover:text-accent"
          }`}
        >
          <span className="text-[14px]">↩</span>{replyCount !== null && replyCount > 0 ? ` ${replyCount}` : ""}
        </button>

        <span className="text-text-dim text-[10px] select-none">·</span>

        {/* Emoji reaction pills */}
        <div className="relative flex flex-wrap items-center gap-1">
          {sortedGroups.map(([emoji, count]) => (
            <button
              key={emoji}
              onClick={() => handleReact(emoji)}
              disabled={reacting || myReactions.has(emoji)}
              title="React"
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] rounded-sm border transition-colors ${
                myReactions.has(emoji)
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border hover:border-accent/40 hover:bg-accent/5 text-text-dim"
              } disabled:cursor-default disabled:opacity-50`}
            >
              <span className="text-[13px] leading-none">{emoji}</span>
              <span>{count}</span>
            </button>
          ))}

          {/* Add reaction button */}
          {loggedIn && (
            <button
              onClick={() => setShowEmojiPicker((v) => !v)}
              disabled={reacting}
              className="inline-flex items-center px-1.5 py-0.5 text-[12px] text-text-dim hover:text-accent border border-border hover:border-accent/40 rounded-sm transition-colors disabled:opacity-30"
              title="React with emoji"
              aria-label="React with emoji"
            >
              +
            </button>
          )}

          {/* Emoji picker popover */}
          {showEmojiPicker && (
            <>
              <div className="fixed inset-0 z-[9]" role="presentation" onClick={() => setShowEmojiPicker(false)} />
              <div className="absolute bottom-6 left-0 bg-bg-raised border border-border rounded-sm shadow-lg z-10 flex gap-0.5 px-1.5 py-1">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReact(emoji)}
                    disabled={myReactions.has(emoji)}
                    className={`text-[16px] hover:scale-125 transition-transform px-0.5 ${
                      myReactions.has(emoji) ? "opacity-30 cursor-default" : ""
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <span className="text-text-dim text-[10px] select-none">·</span>

        <button
          onClick={handleRepost}
          disabled={reposting || reposted}
          title="Repost"
          className={`text-[14px] transition-colors disabled:cursor-default ${
            reposted ? "text-accent" : "text-text hover:text-accent"
          }`}
        >
          ⟳{reposted ? <span className="text-[11px] ml-0.5">✓</span> : reposting ? <span className="text-[11px] ml-0.5">…</span> : ""}
        </button>

        <span className="text-text-dim text-[10px] select-none">·</span>

        <button
          onClick={() => setShowQuote(true)}
          title="Quote"
          className="text-[14px] text-text hover:text-accent transition-colors"
        >
          ❝
        </button>

        {(profile?.lud16 || profile?.lud06) && (
          <>
            <span className="text-text-dim text-[10px] select-none">·</span>
            <button
              onClick={() => setShowZap(true)}
              title="Zap"
              className="text-[11px] text-text hover:text-zap transition-colors"
            >
              {zapData && zapData.totalSats > 0
                ? `⚡ ${zapData.totalSats.toLocaleString()} sats`
                : "⚡"}
            </button>
          </>
        )}

        <span className="text-text-dim text-[10px] select-none">·</span>

        <button
          onClick={() => isBookmarked ? removeBookmark(event.id!) : addBookmark(event.id!)}
          title={isBookmarked ? "Remove bookmark" : "Bookmark"}
          className={`text-[14px] transition-colors ${
            isBookmarked ? "text-accent" : "text-text hover:text-accent"
          }`}
        >
          {isBookmarked ? "★" : "☆"}
        </button>

        <span className="text-text-dim text-[10px] select-none">·</span>

        <button
          onClick={handleShare}
          title="Copy link"
          className={`text-[14px] transition-colors ${
            copied ? "text-accent" : "text-text hover:text-accent"
          }`}
        >
          {copied ? <span className="text-[11px]">✓</span> : "⤴"}
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
  const [reactionsData] = useReactions(event.id);
  const [replyCount] = useReplyCount(event.id);
  const zapData = useZapCount(event.id);
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const nevent = nip19.neventEncode({ id: event.id!, author: event.pubkey });
    await navigator.clipboard.writeText("nostr:" + nevent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sortedGroups = reactionsData
    ? Array.from(reactionsData.groups.entries()).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      {replyCount !== null && replyCount > 0 && (
        <span className="text-text-dim text-[11px]">↩ {replyCount}</span>
      )}
      {sortedGroups.map(([emoji, count]) => (
        <span key={emoji} className="inline-flex items-center gap-0.5 text-text-dim text-[11px]">
          <span className="text-[13px] leading-none">{emoji}</span>
          <span>{count}</span>
        </span>
      ))}
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
