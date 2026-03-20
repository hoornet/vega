import { useEffect, useRef, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useProfile } from "../../hooks/useProfile";
import { useReactionCount } from "../../hooks/useReactionCount";
import { useZapCount } from "../../hooks/useZapCount";
import { fetchReplies, publishReaction, publishReply, publishRepost, getNDK } from "../../lib/nostr";
import { QuoteModal } from "../feed/QuoteModal";
import { EmojiPicker } from "../shared/EmojiPicker";
import { shortenPubkey, timeAgo } from "../../lib/utils";
import { NoteContent } from "../feed/NoteContent";
import { NoteCard } from "../feed/NoteCard";
import { ZapModal } from "../zap/ZapModal";

function RootNote({ event }: { event: NDKEvent }) {
  const { openProfile } = useUIStore();
  const { loggedIn } = useUserStore();
  const profile = useProfile(event.pubkey);
  const name = profile?.displayName || profile?.name || shortenPubkey(event.pubkey);
  const avatar = profile?.picture;
  const nip05 = profile?.nip05;
  const time = event.created_at ? timeAgo(event.created_at) : "";
  const [reactionCount, adjustReactionCount] = useReactionCount(event.id);
  const zapData = useZapCount(event.id);
  const [liked, setLiked] = useState(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem("wrystr_liked") || "[]")).has(event.id); }
    catch { return false; }
  });
  const [liking, setLiking] = useState(false);
  const [showZap, setShowZap] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const hasLightning = !!(profile?.lud16 || profile?.lud06);

  const handleLike = async () => {
    if (!loggedIn || liked || liking) return;
    setLiking(true);
    try {
      await publishReaction(event.id, event.pubkey);
      const likedSet = new Set<string>(JSON.parse(localStorage.getItem("wrystr_liked") || "[]"));
      likedSet.add(event.id);
      localStorage.setItem("wrystr_liked", JSON.stringify(Array.from(likedSet)));
      setLiked(true);
      adjustReactionCount(1);
    } finally {
      setLiking(false);
    }
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
    <div className="px-4 py-4 border-b border-border">
      <div className="flex gap-3 mb-3">
        <div className="shrink-0 cursor-pointer" onClick={() => openProfile(event.pubkey)}>
          {avatar ? (
            <img src={avatar} alt="" className="w-10 h-10 rounded-sm object-cover bg-bg-raised hover:opacity-80 transition-opacity" />
          ) : (
            <div className="w-10 h-10 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-sm">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div>
          <span
            className="text-text font-medium text-[13px] cursor-pointer hover:text-accent transition-colors"
            onClick={() => openProfile(event.pubkey)}
          >{name}</span>
          {nip05 && <div className="text-text-dim text-[10px]">{nip05}</div>}
        </div>
      </div>
      <NoteContent content={event.content} />
      <div className="text-text-dim text-[10px] mt-3">{time}</div>

      {/* Action row */}
      {loggedIn && !!getNDK().signer && (
        <div className="flex items-center gap-4 mt-3">
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
          {hasLightning && (
            <button
              onClick={() => setShowZap(true)}
              className="text-[11px] text-text-dim hover:text-zap transition-colors"
            >
              {zapData && zapData.totalSats > 0
                ? `⚡ ${zapData.totalSats.toLocaleString()} sats`
                : "⚡ zap"}
            </button>
          )}
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
    </div>
  );
}

export function ThreadView() {
  const { selectedNote, goBack } = useUIStore();
  const { loggedIn } = useUserStore();
  const { mutedPubkeys, contentMatchesMutedKeyword } = useMuteStore();
  if (!selectedNote) { goBack(); return null; }
  const event = selectedNote;

  const [replies, setReplies] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const [showReplyEmoji, setShowReplyEmoji] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchReplies(event.id).then((r) => {
      setReplies(r);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [event.id]);

  const handleReply = async () => {
    if (!replyText.trim() || replying) return;
    setReplying(true);
    try {
      const replyEvent = await publishReply(replyText.trim(), { id: event.id, pubkey: event.pubkey });
      setReplyText("");
      setReplySent(true);
      // Inject reply locally so it appears immediately
      setReplies((prev) => [...prev, replyEvent]);
      // Also try fetching from relay in background
      fetchReplies(event.id).then((updated) => setReplies(updated));
      setTimeout(() => setReplySent(false), 2000);
    } finally {
      setReplying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleReply();
    if (e.key === "Escape") replyRef.current?.blur();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 flex items-center gap-3 shrink-0">
        <button
          onClick={goBack}
          className="text-text-dim hover:text-text text-[11px] transition-colors"
        >
          ← back
        </button>
        <h1 className="text-text text-sm font-medium">Thread</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Root note */}
        <RootNote event={event} />

        {/* Reply composer */}
        {loggedIn && (
          <div className="border-b border-border px-4 py-3">
            <textarea
              ref={replyRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write a reply…"
              rows={2}
              className="w-full bg-transparent text-text text-[13px] placeholder:text-text-dim resize-none focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2 mt-1">
              <div className="relative">
                <button
                  onClick={() => setShowReplyEmoji((v) => !v)}
                  title="Insert emoji"
                  className="text-text-dim hover:text-text text-[12px] transition-colors"
                >
                  ☺
                </button>
                {showReplyEmoji && (
                  <EmojiPicker
                    onSelect={(emoji) => {
                      const ta = replyRef.current;
                      if (ta) {
                        const start = ta.selectionStart ?? replyText.length;
                        const end = ta.selectionEnd ?? replyText.length;
                        setReplyText(replyText.slice(0, start) + emoji + replyText.slice(end));
                        setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + emoji.length; ta.focus(); }, 0);
                      } else {
                        setReplyText((t) => t + emoji);
                      }
                    }}
                    onClose={() => setShowReplyEmoji(false)}
                  />
                )}
              </div>
              <span className="text-text-dim text-[10px]">Ctrl+Enter</span>
              <button
                onClick={handleReply}
                disabled={!replyText.trim() || replying}
                className="px-3 py-1 text-[11px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {replySent ? "replied ✓" : replying ? "posting…" : "reply"}
              </button>
            </div>
          </div>
        )}

        {/* Replies */}
        {loading && (
          <div className="px-4 py-6 text-text-dim text-[12px] text-center">
            Loading replies…
          </div>
        )}

        {!loading && replies.length === 0 && (
          <div className="px-4 py-6 text-text-dim text-[12px] text-center">
            No replies yet.
          </div>
        )}

        {replies
          .filter((r) => !mutedPubkeys.includes(r.pubkey) && !contentMatchesMutedKeyword(r.content))
          .map((reply) => (
          <NoteCard key={reply.id} event={reply} />
        ))}
      </div>
    </div>
  );
}
