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
import { ListState } from "../shared/ListState";
import { fetchMark, wentUnanswered } from "../../lib/listLoad";
import { tellPublish } from "../../lib/publishFeedback";

export function ThreadView() {
  const { selectedNote, goBack } = useUIStore();
  const canSign = useCanSign();
  const { mutedPubkeys, contentMatchesMutedKeyword } = useMuteStore();

  const [rootEvent, setRootEvent] = useState<NDKEvent | null>(null);
  const [ancestors, setAncestors] = useState<NDKEvent[]>([]);
  const [tree, setTree] = useState<ThreadNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The network did not answer the replies fetch: with none to show, "No replies yet." would be a guess.
  const [repliesUnanswered, setRepliesUnanswered] = useState(false);
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
  // Replies published from this view, for the note it is showing. The list
  // of replies that arrives replaces what is on screen, and one asked for
  // before a reply was sent does not have it.
  const publishedHere = useRef<{ note: string | null; replies: NDKEvent[] }>({ note: null, replies: [] });

  // No note to show (the stack was cleared under this view): go back, from
  // an effect, not during render. The return is below every hook: a return
  // above them renders fewer hooks than before and takes the app down, as the
  // Zaps view did on sign-out.
  const focusedEvent = selectedNote;
  useEffect(() => {
    if (!focusedEvent) goBack();
  }, [focusedEvent, goBack]);

  useEffect(() => {
    if (!focusedEvent) return;
    // Bound here: the guard above does not narrow inside loadThread.
    const focused: NDKEvent = focusedEvent;
    let cancelled = false;
    // Another note: its replies are not this one's. The same note again ("Try again") keeps them.
    if (publishedHere.current.note !== focused.id) publishedHere.current = { note: focused.id, replies: [] };

    async function loadThread() {
      setLoadError(null);
      setRepliesLoading(true);
      setRepliesUnanswered(false);
      setTree(null);
      setAncestors([]);
      setRootEvent(null);
      setShowRootReply(false);

      // Show focused note immediately as a minimal tree (no waiting)
      const minimalTree = buildThreadTree(focused.id, [focused]);
      setRootEvent(focused);
      setTree(minimalTree);
      setLoading(false);

      try {
        // Ensure we have relay connectivity before fetching
        const connected = await ensureConnected();
        if (!connected && !cancelled) {
          setLoadError("No relay connections available. Check your network.");
          return;
        }

        const rootId = getRootEventId(focused);
        let root: NDKEvent = focused;
        let fetchedAncestors: NDKEvent[] = [];

        logDiag({ ts: new Date().toISOString(), action: "thread_load_start", details: `rootId=${rootId ?? "none"} focusedId=${focused.id}` });

        if (rootId && rootId !== focused.id) {
          const t0 = Date.now();
          const [fetched, ancestorResult] = await Promise.all([
            fetchNoteById(rootId),
            fetchAncestors(focused),
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
        const mark = fetchMark();
        const events = await fetchThreadEvents(root.id);
        // Only read when there are no replies to show.
        if (!cancelled && wentUnanswered(mark)) setRepliesUnanswered(true);
        logDiag({ ts: new Date().toISOString(), action: "thread_replies_done", durationMs: Date.now() - t1, details: `count=${events.length}` });
        if (cancelled) return;

        // Build event list: root + thread replies + focused event + ancestors
        const allEvents = [root, ...events.filter((e) => e.id !== root.id)];
        if (focused.id !== root.id && !allEvents.some((e) => e.id === focused.id)) {
          allEvents.push(focused);
        }
        for (const anc of fetchedAncestors) {
          if (!allEvents.some((e) => e.id === anc.id)) {
            allEvents.push(anc);
          }
        }
        // Replies published from this view while the fetch was on its way.
        // The fetch was asked before they existed, so it does not have them,
        // and this list replaces what is on screen: a reply sent while
        // "replies loading" went out, showed, and vanished.
        for (const reply of publishedHere.current.replies) {
          if (!allEvents.some((e) => e.id === reply.id)) allEvents.push(reply);
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
  }, [focusedEvent?.id, retryCount]);

  // Scroll to focused note after tree fully loads.
  // Use a short delay after each tree update; the last one wins.
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!focusedEvent || focusedEvent.id === rootEvent?.id) return;
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const el = document.querySelector(`[data-note-id="${focusedEvent.id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
    return () => clearTimeout(scrollTimer.current);
  }, [tree, focusedEvent?.id, rootEvent?.id]);

  if (!focusedEvent) return null;

  // Called when any inline reply box publishes a reply
  const handleReplyPublished = (reply: NDKEvent) => {
    // Written under the note this render shows. If another note has been
    // opened since, it is not that note's reply, and went under it as one.
    if (publishedHere.current.note !== focusedEvent.id) return;
    publishedHere.current.replies.push(reply);
    // From the tree as it is now, not as it was when Reply was pressed. The
    // replies may have arrived in between, and a tree rebuilt from the older
    // one took them all off the screen and left this reply alone.
    setTree((current) => (current ? buildThreadTree(current.event.id, [...collectEvents(current), reply]) : current));
  };

  // Root-level reply (reply to the root note)
  const handleRootReply = async () => {
    if (!replyText.trim() || replying || !rootEvent) return;
    setReplying(true);
    // No toast when it works: the reply appears in the thread. There was no
    // catch: the button came back and nothing said the reply had not gone out.
    const told = await tellPublish(() => publishReply(replyText.trim(), { id: rootEvent.id, pubkey: rootEvent.pubkey }), { kept: "Your reply is still in the box." });
    setReplying(false);
    if (!told.ok) return;
    setReplyText("");
    setReplySent(true);
    setShowRootReply(false);
    handleReplyPublished(told.value);
    setTimeout(() => setReplySent(false), 2000);
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
              <ListState
                state={repliesLoading ? "loading" : repliesUnanswered ? "unreachable" : "empty"}
                loadingLabel="Loading replies…"
                empty="No replies yet."
                what="replies"
                onRetry={() => setRetryCount((c) => c + 1)}
              />
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
