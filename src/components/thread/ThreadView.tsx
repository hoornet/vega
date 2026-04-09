import { useEffect, useRef, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useAutoResize } from "../../hooks/useAutoResize";
import { useUIStore } from "../../stores/ui";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { fetchNoteById, fetchThreadEvents, fetchAncestors, publishReply, getNDK, ensureConnected } from "../../lib/nostr";
import { buildThreadTree, getRootEventId } from "../../lib/threadTree";
import type { ThreadNode } from "../../lib/threadTree";
import { AncestorChain } from "./AncestorChain";
import { ThreadNodeComponent } from "./ThreadNode";
import { NoteCard } from "../feed/NoteCard";
import { EmojiPicker } from "../shared/EmojiPicker";

export function ThreadView() {
  const { selectedNote, goBack } = useUIStore();
  const { loggedIn } = useUserStore();
  const { mutedPubkeys, contentMatchesMutedKeyword } = useMuteStore();

  const [rootEvent, setRootEvent] = useState<NDKEvent | null>(null);
  const [ancestors, setAncestors] = useState<NDKEvent[]>([]);
  const [tree, setTree] = useState<ThreadNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showRootReply, setShowRootReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const [showReplyEmoji, setShowReplyEmoji] = useState(false);
  const autoResize = useAutoResize(2, 8);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Guard AFTER all hooks to satisfy React rules of hooks
  if (!selectedNote) { goBack(); return null; }
  const focusedEvent = selectedNote;

  useEffect(() => {
    let cancelled = false;

    async function loadThread() {
      setLoadError(null);
      setTree(null);
      setAncestors([]);
      setRootEvent(null);
      setShowRootReply(false);

      // Show focused note immediately as a minimal tree (no waiting)
      const minimalTree = buildThreadTree(focusedEvent.id, [focusedEvent]);
      setRootEvent(focusedEvent);
      setTree(minimalTree);
      setLoading(false);

      try {
        // Ensure we have relay connectivity before fetching
        const connected = await ensureConnected();
        if (!connected && !cancelled) {
          setLoadError("No relay connections available. Check your network.");
          return;
        }

        const rootId = getRootEventId(focusedEvent);
        let root: NDKEvent = focusedEvent;
        let fetchedAncestors: NDKEvent[] = [];

        if (rootId && rootId !== focusedEvent.id) {
          // Fetch root and ancestors in parallel with thread replies
          const [fetched, ancestorResult] = await Promise.all([
            fetchNoteById(rootId),
            fetchAncestors(focusedEvent),
          ]);
          if (fetched) {
            root = fetched;
            fetchedAncestors = ancestorResult.filter((a) => a.id !== root.id);
            if (!cancelled) setAncestors(fetchedAncestors);
          } else if (!cancelled) {
            setLoadError("Could not fetch the root note — relay may be slow.");
          }
        }

        if (cancelled) return;
        setRootEvent(root);

        const events = await fetchThreadEvents(root.id);
        if (cancelled) return;

        // Build event list: root + thread replies + focused event + ancestors
        const allEvents = [root, ...events.filter((e) => e.id !== root.id)];
        if (focusedEvent.id !== root.id && !allEvents.some((e) => e.id === focusedEvent.id)) {
          allEvents.push(focusedEvent);
        }
        for (const anc of fetchedAncestors) {
          if (!allEvents.some((e) => e.id === anc.id)) {
            allEvents.push(anc);
          }
        }

        const built = buildThreadTree(root.id, allEvents);
        setTree(built);
      } catch (err) {
        console.error("Failed to load thread:", err);
        if (!cancelled) setLoadError(`Failed to load: ${err}`);
      }
    }

    loadThread();
    return () => { cancelled = true; };
  }, [focusedEvent.id, retryCount]);

  // Scroll to focused note after tree fully loads.
  // Use a short delay after each tree update; the last one wins.
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (focusedEvent.id === rootEvent?.id) return;
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const el = document.querySelector(`[data-note-id="${focusedEvent.id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
    return () => clearTimeout(scrollTimer.current);
  }, [tree, focusedEvent.id, rootEvent?.id]);

  // Called when any inline reply box publishes a reply
  const handleReplyPublished = (reply: NDKEvent) => {
    if (tree && rootEvent) {
      const allEvents = collectEvents(tree);
      allEvents.push(reply);
      const rebuilt = buildThreadTree(rootEvent.id, allEvents);
      setTree(rebuilt);
    }
  };

  // Root-level reply (reply to the root note)
  const handleRootReply = async () => {
    if (!replyText.trim() || replying || !rootEvent) return;
    setReplying(true);
    try {
      const reply = await publishReply(replyText.trim(), { id: rootEvent.id, pubkey: rootEvent.pubkey });
      setReplyText("");
      setReplySent(true);
      setShowRootReply(false);
      handleReplyPublished(reply);
      setTimeout(() => setReplySent(false), 2000);
    } finally {
      setReplying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleRootReply();
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Error banner */}
        {loadError && !loading && (
          <div className="px-4 py-2 bg-danger/10 border-b border-danger/20 flex items-center justify-between">
            <span className="text-danger text-[11px]">{loadError}</span>
            <button
              onClick={() => setRetryCount((c) => c + 1)}
              className="text-[11px] text-accent hover:text-accent-hover transition-colors px-2 py-0.5 border border-accent/30 hover:border-accent"
            >
              retry
            </button>
          </div>
        )}

        {/* Loading shimmer */}
        {loading && (
          <div className="px-4 py-6 space-y-4">
            <div className="animate-pulse space-y-3">
              <div className="h-10 bg-bg-raised rounded" />
              <div className="h-24 bg-bg-raised rounded" />
              <div className="h-16 bg-bg-raised rounded ml-4" />
              <div className="h-16 bg-bg-raised rounded ml-4" />
            </div>
          </div>
        )}

        {!loading && tree && rootEvent && (
          <>
            {/* Ancestors (when opening a deep reply) */}
            <AncestorChain ancestors={ancestors} />

            {/* Root note */}
            <div data-note-id={tree.event.id}>
              <NoteCard
                event={tree.event}
                focused={tree.event.id === focusedEvent.id}
                onReplyInThread={() => setShowRootReply((v) => !v)}
              />
            </div>

            {/* Root reply box (inline, right below root) */}
            {showRootReply && loggedIn && !!getNDK().signer && (
              <div className="border-b border-border border-l-2 border-l-accent/40 ml-3 px-3 py-2">
                <textarea
                  ref={replyRef}
                  value={replyText}
                  onChange={(e) => { setReplyText(e.target.value); autoResize(e); }}
                  onKeyDown={handleKeyDown}
                  placeholder="Write a reply…"
                  rows={2}
                  className="w-full bg-transparent text-text text-[12px] placeholder:text-text-dim resize-none focus:outline-none leading-relaxed"
                  autoFocus
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
                    onClick={handleRootReply}
                    disabled={!replyText.trim() || replying}
                    className="px-3 py-1 text-[11px] bg-accent hover:bg-accent-hover text-accent-text rounded-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {replySent ? "replied ✓" : replying ? "posting…" : "reply"}
                  </button>
                </div>
              </div>
            )}

            {/* Thread tree (children of root) */}
            {tree.children.length === 0 && !showRootReply && (
              <div className="px-4 py-6 text-text-dim text-[12px] text-center">
                No replies yet.
              </div>
            )}

            {tree.children
              .filter((c) => !mutedPubkeys.includes(c.event.pubkey) && !contentMatchesMutedKeyword(c.event.content))
              .map((child) => (
                <ThreadNodeComponent
                  key={child.event.id}
                  node={child}
                  rootEvent={rootEvent}
                  onReplyPublished={handleReplyPublished}
                  focusedId={focusedEvent.id}
                  mutedPubkeys={mutedPubkeys}
                  contentMatchesMutedKeyword={contentMatchesMutedKeyword}
                />
              ))}
          </>
        )}

        {!loading && !tree && (
          <div className="px-4 py-6 text-center space-y-2">
            <p className="text-text-dim text-[12px]">Could not load thread.</p>
            <button
              onClick={() => setRetryCount((c) => c + 1)}
              className="text-[11px] text-accent hover:text-accent-hover transition-colors px-3 py-1 border border-accent/30 hover:border-accent"
            >
              retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Collect all events from a tree into a flat array. */
function collectEvents(node: ThreadNode): NDKEvent[] {
  const result: NDKEvent[] = [node.event];
  for (const child of node.children) {
    result.push(...collectEvents(child));
  }
  return result;
}
