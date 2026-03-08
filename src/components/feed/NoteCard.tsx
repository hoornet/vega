import { useState, useRef } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useProfile } from "../../hooks/useProfile";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { timeAgo, shortenPubkey } from "../../lib/utils";
import { publishReaction, publishReply } from "../../lib/nostr";
import { NoteContent } from "./NoteContent";

interface NoteCardProps {
  event: NDKEvent;
}

export function NoteCard({ event }: NoteCardProps) {
  const profile = useProfile(event.pubkey);
  const name = profile?.displayName || profile?.name || shortenPubkey(event.pubkey);
  const avatar = profile?.picture;
  const nip05 = profile?.nip05;
  const time = event.created_at ? timeAgo(event.created_at) : "";

  const { loggedIn } = useUserStore();
  const { openProfile, openThread, currentView } = useUIStore();
  const likedKey = "wrystr_liked";
  const getLiked = () => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(likedKey) || "[]")); }
    catch { return new Set<string>(); }
  };
  const [liked, setLiked] = useState(() => getLiked().has(event.id));
  const [liking, setLiking] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySent, setReplySent] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const handleLike = async () => {
    if (!loggedIn || liked || liking) return;
    setLiking(true);
    try {
      await publishReaction(event.id, event.pubkey);
      const liked = getLiked();
      liked.add(event.id);
      localStorage.setItem(likedKey, JSON.stringify(Array.from(liked)));
      setLiked(true);
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

  return (
    <article className="border-b border-border px-4 py-3 hover:bg-bg-hover transition-colors duration-100">
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
          </div>

          <div
            className="cursor-pointer"
            onClick={() => openThread(event, currentView as "feed" | "profile")}
          >
            <NoteContent content={event.content} />
          </div>

          {/* Actions */}
          {loggedIn && (
            <div className="flex items-center gap-4 mt-2">
              <button
                onClick={handleReply}
                className={`text-[11px] transition-colors ${
                  showReply ? "text-accent" : "text-text-dim hover:text-text"
                }`}
              >
                reply
              </button>
              <button
                onClick={handleLike}
                disabled={liked || liking}
                className={`text-[11px] transition-colors ${
                  liked ? "text-accent" : "text-text-dim hover:text-accent"
                } disabled:cursor-default`}
              >
                {liked ? "♥ liked" : "♡ like"}
              </button>
            </div>
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
