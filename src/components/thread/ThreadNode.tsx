import { useState, useRef } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import type { ThreadNode as ThreadNodeType } from "../../lib/threadTree";
import { NoteCard } from "../feed/NoteCard";
import { publishReply } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { shortenPubkey, profileName } from "../../lib/utils";
import { EmojiPicker } from "../shared/EmojiPicker";
import { useAutoResize } from "../../hooks/useAutoResize";

interface ThreadNodeProps {
  node: ThreadNodeType;
  rootEvent: NDKEvent;
  onReplyPublished: (reply: NDKEvent) => void;
  focusedId?: string;
  mutedPubkeys: string[];
  contentMatchesMutedKeyword: (content: string) => boolean;
}

const MAX_VISIBLE_CHILDREN = 3;
const MAX_INDENT_DEPTH = 3;

function InlineThreadReply({ replyTo, rootEvent, onPublished }: {
  replyTo: NDKEvent;
  rootEvent: NDKEvent;
  onPublished: (reply: NDKEvent) => void;
}) {
  const profile = useProfile(replyTo.pubkey);
  const name = profileName(profile, shortenPubkey(replyTo.pubkey));
  const [text, setText] = useState("");
  const [replying, setReplying] = useState(false);
  const [sent, setSent] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const autoResize = useAutoResize(2, 8);

  const handleSubmit = async () => {
    if (!text.trim() || replying) return;
    setReplying(true);
    try {
      const rootArg = replyTo.id !== rootEvent.id
        ? { id: rootEvent.id, pubkey: rootEvent.pubkey }
        : undefined;
      const reply = await publishReply(text.trim(), { id: replyTo.id, pubkey: replyTo.pubkey }, rootArg);
      setText("");
      setSent(true);
      onPublished(reply);
      setTimeout(() => setSent(false), 2000);
    } finally {
      setReplying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit();
    if (e.key === "Escape") ref.current?.blur();
  };

  return (
    <div className="border-l-2 border-accent/40 ml-4 pl-3 py-2">
      <div className="text-text-dim text-[10px] mb-1">replying to <span className="text-accent">@{name}</span></div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => { setText(e.target.value); autoResize(e); }}
        onKeyDown={handleKeyDown}
        placeholder="Write a reply…"
        rows={2}
        className="w-full bg-transparent text-text text-[12px] placeholder:text-text-dim resize-none focus:outline-none"
        autoFocus
      />
      <div className="flex items-center justify-end gap-2 mt-1">
        <div className="relative">
          <button
            onClick={() => setShowEmoji((v) => !v)}
            title="Insert emoji"
            className="text-text-dim hover:text-text text-[12px] transition-colors"
          >
            ☺
          </button>
          {showEmoji && (
            <EmojiPicker
              onSelect={(emoji) => {
                const ta = ref.current;
                if (ta) {
                  const start = ta.selectionStart ?? text.length;
                  const end = ta.selectionEnd ?? text.length;
                  setText(text.slice(0, start) + emoji + text.slice(end));
                  setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + emoji.length; ta.focus(); }, 0);
                } else {
                  setText((t) => t + emoji);
                }
              }}
              onClose={() => setShowEmoji(false)}
            />
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || replying}
          className="px-3 py-1 text-[11px] bg-accent hover:bg-accent-hover text-accent-text rounded-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {sent ? "replied ✓" : replying ? "posting…" : "reply"}
        </button>
      </div>
    </div>
  );
}

/** Check if any descendant of a node has the given event ID. */
function subtreeContains(node: ThreadNodeType, id: string): boolean {
  for (const child of node.children) {
    if (child.event.id === id) return true;
    if (subtreeContains(child, id)) return true;
  }
  return false;
}

export function ThreadNodeComponent({ node, rootEvent, onReplyPublished, focusedId, mutedPubkeys, contentMatchesMutedKeyword }: ThreadNodeProps) {
  // Auto-expand if the focused note is hidden inside a collapsed section
  const focusedInChildren = focusedId ? subtreeContains(node, focusedId) : false;
  const [expanded, setExpanded] = useState(focusedInChildren);
  const [showReplyBox, setShowReplyBox] = useState(false);

  // Filter out muted children
  const visibleChildren = node.children.filter(
    (c) => !mutedPubkeys.includes(c.event.pubkey) && !contentMatchesMutedKeyword(c.event.content)
  );

  const hiddenCount = node.children.length - visibleChildren.length;
  const shouldCollapse = visibleChildren.length > MAX_VISIBLE_CHILDREN && !expanded;
  const shownChildren = shouldCollapse ? visibleChildren.slice(0, 2) : visibleChildren;
  const remainingCount = visibleChildren.length - shownChildren.length;

  // Use relative indent: each level adds one step, but only up to MAX_INDENT_DEPTH
  const shouldIndent = node.depth > 0 && node.depth <= MAX_INDENT_DEPTH;
  const isFocused = node.event.id === focusedId;

  return (
    <div
      className={shouldIndent ? "border-l-2 border-border ml-4 pl-1" : node.depth > MAX_INDENT_DEPTH ? "border-l-2 border-border pl-1" : ""}
    >
      <NoteCard
        event={node.event}
        focused={isFocused}
        onReplyInThread={() => setShowReplyBox((v) => !v)}
      />

      {showReplyBox && (
        <div className={shouldIndent ? "ml-2" : ""}>
          <InlineThreadReply
            replyTo={node.event}
            rootEvent={rootEvent}
            onPublished={(reply) => {
              setShowReplyBox(false);
              onReplyPublished(reply);
            }}
          />
        </div>
      )}

      {shownChildren.map((child) => (
        <ThreadNodeComponent
          key={child.event.id}
          node={child}
          rootEvent={rootEvent}
          onReplyPublished={onReplyPublished}
          focusedId={focusedId}
          mutedPubkeys={mutedPubkeys}
          contentMatchesMutedKeyword={contentMatchesMutedKeyword}
        />
      ))}

      {remainingCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-accent hover:text-accent-hover text-[11px] py-1.5 ml-4 transition-colors"
        >
          show {remainingCount} more {remainingCount === 1 ? "reply" : "replies"}
        </button>
      )}

      {hiddenCount > 0 && (
        <div className="text-text-dim text-[10px] py-1 ml-4 italic">
          {hiddenCount} {hiddenCount === 1 ? "reply" : "replies"} hidden (muted)
        </div>
      )}
    </div>
  );
}
