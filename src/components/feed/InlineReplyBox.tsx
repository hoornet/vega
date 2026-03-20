import { useState, useRef } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { publishReply } from "../../lib/nostr";
import { useReplyCount } from "../../hooks/useReplyCount";
import { EmojiPicker } from "../shared/EmojiPicker";

interface InlineReplyBoxProps {
  event: NDKEvent;
  name: string;
}

export function InlineReplyBox({ event, name }: InlineReplyBoxProps) {
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySent, setReplySent] = useState(false);
  const [showReplyEmoji, setShowReplyEmoji] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [, adjustReplyCount] = useReplyCount(event.id);

  const handleReplySubmit = async () => {
    if (!replyText.trim() || replying) return;
    setReplying(true);
    setReplyError(null);
    try {
      await publishReply(replyText.trim(), { id: event.id, pubkey: event.pubkey });
      setReplyText("");
      setReplySent(true);
      adjustReplyCount(1);
      setTimeout(() => { setReplySent(false); }, 1500);
    } catch (err) {
      setReplyError(`Failed: ${err}`);
    } finally {
      setReplying(false);
    }
  };

  const handleReplyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleReplySubmit();
    if (e.key === "Escape") {
      // Parent controls visibility — just blur
      replyRef.current?.blur();
    }
  };

  return (
    <div className="mt-2 border-l-2 border-border pl-3">
      <textarea
        ref={replyRef}
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        onKeyDown={handleReplyKeyDown}
        placeholder={`Reply to ${name}…`}
        rows={2}
        className="w-full bg-transparent text-text text-[12px] placeholder:text-text-dim resize-none focus:outline-none"
        autoFocus
      />
      {replyError && <p className="text-danger text-[10px] mb-1">{replyError}</p>}
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
          onClick={handleReplySubmit}
          disabled={!replyText.trim() || replying}
          className="px-2 py-0.5 text-[10px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {replySent ? "replied ✓" : replying ? "posting…" : "reply"}
        </button>
      </div>
    </div>
  );
}
