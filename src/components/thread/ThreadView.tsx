import { useEffect, useRef, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useAutoResize } from "../../hooks/useAutoResize";
import { useUIStore } from "../../stores/ui";
import { useCanSign } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { fetchNoteById, fetchThreadEvents, fetchAncestors, publishReply, ensureConnected } from "../../lib/nostr";
import { buildThreadTree, getRootEventId } from "../../lib/threadTree";
import type { ThreadNode } from "../../lib/threadTree";
import { debug } from "../../lib/debug";
import { logDiag } from "../../lib/feedDiagnostics";
import { AncestorChain } from "./AncestorChain";
import { ThreadNodeComponent } from "./ThreadNode";
import { NoteCard } from "../feed/NoteCard";
import { EmojiPicker } from "../shared/EmojiPicker";
import { ViewHeader } from "../shared/ViewHeader";
import { Button } from "../shared/Button";
import { Check } from "lucide-react";

export function ThreadView() {
  const { selectedNote, goBack } = useUIStore();
  const canSign = useCanSign();
  const { mutedPubkeys, contentMatchesMutedKeyword } = useMuteStore();

  const [rootEvent, setRootEvent] = useState<NDKEvent | null>(null);
  const [ancestors, setAncestors] = useState<NDKEvent[]>([]);
  const [tree, setTree] = useState<ThreadNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The focused note is shown at once, so `loading` is false long before the
  // replies arrive. Without this, "No replies yet." showed while they loaded.
  const [repliesLoading, setRepliesLoading] = useState(true);
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
      setRepliesLoading(true);
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

        logDiag({ ts: new Date().toISOString(), action: "thread_load_start", details: `rootId=${rootId ?? "none"} focusedId=${focusedEvent.id}` });

        if (rootId && rootId !== focusedEvent.id) {
          const t0 = Date.now();
          const [fetched, ancestorResult] = await Promise.all([
            fetchNoteById(rootId),
            fetchAncestors(focusedEvent),
          ]);
          logDiag({ ts: new Date().toISOString(), action: "thread_root_ancestors", durationMs: Date.now() - t0, details: `root=${fetched ? "ok" : "missing"} ancestors=${ancestorResult.length}` });
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

        logDiag({ ts: new Date().toISOString(), action: "thread_replies_start", details: `rootId=${root.id}` });
        const t1 = Date.now();
        const events = await fetchThreadEvents(root.id);
        logDiag({ ts: new Date().toISOString(), action: "thread_replies_done", durationMs: Date.now() - t1, details: `count=${events.length}` });
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
        debug.error("Failed to load thread:", err);
        if (!cancelled) setLoadError(`Failed to load: ${err}`);
      } finally {
        if (!cancelled) setRepliesLoading(false);
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
      <ViewHeader title="Thread" onBack={goBack} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto content-column">
        {/* Error banner */}
        {loadError && !loading && (
          <div className="px-4 py-2 bg-danger/10 border-b border-danger/20 flex items-center justify-between">
            <span className="text-danger text-caption">{loadError}</span>
            <Button size="sm" onClick={() => setRetryCount((c) => c + 1)}>Retry</Button>
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
            {showRootReply && canSign && (
              <div className="border-b border-border-subtle border-l-2 border-l-accent/40 ml-3 px-3 py-2">
                <textarea
                  ref={replyRef}
                  value={replyText}
                  onChange={(e) => { setReplyText(e.target.value); autoResize(e); }}
                  onKeyDown={handleKeyDown}
                  placeholder="Write a reply…"
                  rows={2}
                  className="w-full bg-transparent text-text text-body placeholder:text-text-dim resize-none focus:outline-none leading-relaxed"
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
                  <span className="text-text-dim text-caption">Ctrl+Enter</span>
                  <Button variant="primary" onClick={handleRootReply} disabled={!replyText.trim() && !replying} busy={replying}>
                    {replySent && <Check />}{replySent ? "Replied" : replying ? "Posting…" : "Reply"}
                  </Button>
                </div>
              </div>
            )}

            {/* Thread tree (children of root) */}
            {tree.children.length === 0 && !showRootReply && !(loadError && !repliesLoading) && (
              <div className="px-4 py-6 text-text-dim text-body text-center">
                {repliesLoading ? "Loading replies…" : "No replies yet."}
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
            <p className="text-text-dim text-body">Could not load thread.</p>
            <Button onClick={() => setRetryCount((c) => c + 1)}>Retry</Button>
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
