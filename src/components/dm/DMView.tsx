import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NDKEvent, NDKKind } from "@nostr-dev-kit/ndk";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { useNotificationsStore } from "../../stores/notifications";
import { fetchDMConversations, fetchDMThread, sendDM, decryptDM, getNDK, ensureConnected, isPoolSilent } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { useAutoResize } from "../../hooks/useAutoResize";
import { useToastFloor } from "../../hooks/useToastFloor";
import { timeAgo, shortenPubkey, profileName } from "../../lib/utils";
import { debug } from "../../lib/debug";
import { parseContent } from "../../lib/parsing";
import { tryHandleUrlInternally, tryOpenNostrEntity } from "../feed/TextSegments";
import { ViewHeader } from "../shared/ViewHeader";
import { Button } from "../shared/Button";
import { Plus, MessageSquarePlus } from "lucide-react";
import { NewMessageDialog } from "./NewMessageDialog";
import { explainPublishError } from "../../lib/publishErrors";

// ── Helpers ──────────────────────────────────────────────────────────────────

function partnerOf(event: NDKEvent, myPubkey: string): string {
  return event.pubkey === myPubkey
    ? (event.tags.find((t) => t[0] === "p")?.[1] ?? "")
    : event.pubkey;
}

function groupConversations(events: NDKEvent[], myPubkey: string): Map<string, NDKEvent[]> {
  const map = new Map<string, NDKEvent[]>();
  for (const e of events) {
    const partner = partnerOf(e, myPubkey);
    if (!partner) continue;
    const list = map.get(partner) ?? [];
    list.push(e);
    map.set(partner, list);
  }
  // Sort each conversation newest-first
  for (const [k, list] of map) {
    map.set(k, list.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)));
  }
  return map;
}

// ── Conversation list row ─────────────────────────────────────────────────────

function ConvRow({
  partnerPubkey,
  lastEvent,
  selected,
  onSelect,
}: {
  partnerPubkey: string;
  lastEvent: NDKEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const profile = useProfile(partnerPubkey);
  const name = profileName(profile, shortenPubkey(partnerPubkey));
  const time = lastEvent.created_at ? timeAgo(lastEvent.created_at) : "";

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
        selected ? "bg-accent/10 border-l-2 border-accent" : "hover:bg-bg-hover border-l-2 border-transparent"
      }`}
    >
      {profile?.picture ? (
        <img src={profile.picture} alt={`${name}'s avatar`} className="w-8 h-8 rounded-full object-cover shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <div className="w-8 h-8 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs shrink-0">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span title={name} className="text-text text-body font-medium truncate">{name}</span>
          <span className="text-text-dim text-caption shrink-0">{time}</span>
        </div>
        <div className="text-text-dim text-caption truncate">
          {lastEvent.kind === NDKKind.PrivateDirectMessage ? "🔒 NIP-17" : "🔒 NIP-04"}
        </div>
      </div>
    </button>
  );
}

// ── DM text renderer ─────────────────────────────────────────────────────────

function DMText({ text }: { text: string }) {
  const segments = useMemo(() => parseContent(text), [text]);
  return (
    <span className="whitespace-pre-wrap break-words">
      {segments.map((seg, i) => {
        if (seg.type === "link") {
          return (
            <a
              key={i}
              href={seg.value}
              className="text-accent hover:text-accent-hover underline underline-offset-2 decoration-accent/40"
              onClick={(e) => {
                e.preventDefault();
                if (!tryHandleUrlInternally(seg.value)) openUrl(seg.value).catch(() => {});
              }}
            >
              {seg.display || seg.value}
            </a>
          );
        }
        if (seg.type === "image") {
          return (
            <img
              key={i}
              src={seg.value}
              className="max-h-48 max-w-full rounded-lg mt-1.5 block"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          );
        }
        if (seg.type === "naddr" || seg.type === "mention") {
          return (
            <span
              key={i}
              className="text-accent hover:text-accent-hover cursor-pointer underline-offset-2"
              onClick={() => tryOpenNostrEntity(seg.value)}
            >
              {seg.type === "naddr" ? "🔗 " : "@"}{String(seg.display ?? seg.value).slice(0, 20)}…
            </span>
          );
        }
        if (seg.type === "quote") {
          return (
            <span key={i} className="text-accent/60 text-caption cursor-pointer hover:text-accent italic">
              ↩ quoted note
            </span>
          );
        }
        // video/audio/youtube/etc. — show URL as a plain link
        if (["video", "audio", "youtube", "vimeo", "spotify", "tidal", "fountain"].includes(seg.type)) {
          return (
            <a
              key={i}
              href={seg.value}
              className="text-accent hover:text-accent-hover underline underline-offset-2 decoration-accent/40"
              onClick={(e) => { e.preventDefault(); openUrl(seg.value).catch(() => {}); }}
            >
              {seg.value}
            </a>
          );
        }
        return <span key={i}>{seg.value}</span>;
      })}
    </span>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ event, myPubkey }: { event: NDKEvent; myPubkey: string }) {
  const isMine = event.pubkey === myPubkey;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    decryptDM(event, myPubkey)
      .then(setText)
      .catch(() => setError(true));
  }, [event.id]);

  const time = event.created_at ? timeAgo(event.created_at) : "";

  return (
    <div className={`flex ${isMine ? "justify-end" : "justify-start"} mb-1.5`}>
      <div
        className={`note-content max-w-[75%] px-3 py-2 text-body leading-relaxed break-words rounded-lg ${
          isMine
            ? "bg-accent/15 text-text"
            : "bg-bg-raised border border-border text-text"
        }`}
      >
        {error ? (
          <span className="text-text-dim italic">Could not decrypt</span>
        ) : text === null ? (
          <span className="text-text-dim">…</span>
        ) : (
          <DMText text={text} />
        )}
        <div className={`text-caption mt-1 ${isMine ? "text-accent/60" : "text-text-dim"}`}>
          {time}
        </div>
      </div>
    </div>
  );
}

// ── Thread panel ──────────────────────────────────────────────────────────────

export function ThreadPanel({
  partnerPubkey,
  myPubkey,
  focusOnMount = false,
}: {
  partnerPubkey: string;
  myPubkey: string;
  /** A conversation just started from the New message dialog: the box takes focus, so the first thing typed goes into it. */
  focusOnMount?: boolean;
}) {
  const { openProfile } = useUIStore();
  const profile = useProfile(partnerPubkey);
  const name = profileName(profile, shortenPubkey(partnerPubkey));

  const [messages, setMessages] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // DMs are where the longest messages get written, so allow more room to grow
  // than the reply boxes do. The messages pane above is flex-1, so it yields.
  const autoResize = useAutoResize(2, 14);
  const composeBar = useToastFloor<HTMLDivElement>();
  // After the dialog's own focus return, which runs first in the same commit.
  useEffect(() => { if (focusOnMount) textareaRef.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reads of the thread, numbered as they start. The box is free while a
  // read is on its way, so a send's re-read can overtake the first load, and
  // a second message's re-read the first's. A read may set the list only if
  // none started after it has done so already: an older one that comes back
  // last used to take the newer message off the screen. And loading is over
  // when a read has been shown, or when none is left that could be: it used
  // to follow one read only, and stuck when another overtook it.
  const reads = useRef({ started: 0, shown: 0, waiting: 0 });

  const readThread = useCallback(async () => {
    const all = reads.current;
    const read = ++all.started;
    all.waiting++;
    try {
      const loaded = await fetchDMThread(myPubkey, partnerPubkey);
      if (read > all.shown) {
        all.shown = read;
        setMessages(loaded);
        setLoading(false);
      }
    } catch (err) {
      debug.error("Failed to fetch DM thread:", err);
    } finally {
      all.waiting--;
      if (all.waiting === 0) setLoading(false);
    }
  }, [myPubkey, partnerPubkey]);

  // The panel is keyed by conversation where it is mounted, so this runs
  // once: a late read or a late send from another conversation ends in a
  // panel that is gone, not in this one.
  useEffect(() => {
    setLoading(true);
    setMessages([]);
    void readThread();
  }, [readThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(null);
    try {
      debug.log("[DM-UI] sending to", partnerPubkey.slice(0, 8));
      await sendDM(partnerPubkey, content);
      debug.log("[DM-UI] send completed, re-fetching thread");
      setText("");
      // Clear the inline height autoResize set, or the box stays as tall as the
      // message we just sent, now empty.
      if (textareaRef.current) textareaRef.current.style.height = "";
      textareaRef.current?.focus();
    } catch (err) {
      debug.error("[DM-UI] send failed:", err);
      setSendError(explainPublishError(err, "Your message is still in the box.", "send"));
      return;
    } finally {
      setSending(false);
    }
    // Re-read the thread to include the sent message. Outside the send's
    // `try`: when this failed, the box was already empty and the message was
    // out, and it said "Couldn't send… still in the box". It was sent again.
    // A read that fails says nothing here: the message went out.
    await readThread();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend();
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* The conversation's own bar: the same height as the list's header beside it. */}
      <div className="min-h-12 border-b border-border-subtle px-4 flex items-center gap-3 shrink-0">
        {profile?.picture && (
          <img src={profile.picture} alt={`${name}'s avatar`} className="w-7 h-7 rounded-full object-cover" />
        )}
        <button
          onClick={() => openProfile(partnerPubkey)}
          className="text-text text-body font-medium hover:text-accent transition-colors"
        >
          {name}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <div className="text-text-dim text-body text-center py-8">Loading messages…</div>
        )}
        {!loading && messages.length === 0 && (
          <div className="text-text-dim text-body text-center py-8">
            No messages yet. Say hello!
          </div>
        )}
        {messages.map((e) => (
          <MessageBubble key={e.id} event={e} myPubkey={myPubkey} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Compose. Toasts start above it: Send is in the corner they are drawn in. */}
      <div ref={composeBar} className="border-t border-border-subtle px-4 py-3 shrink-0">
        {sendError && <p className="text-danger text-caption mb-2">{sendError}</p>}
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); autoResize(e); }}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${name}…`}
            rows={2}
            className="flex-1 bg-bg border border-border-strong px-3 py-2 text-text text-body resize-none focus:outline-none focus:border-accent placeholder:text-text-dim rounded-lg"
            style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
          />
          <Button variant="primary" onClick={handleSend} disabled={!text.trim() && !sending} busy={sending} className="self-end">Send</Button>
        </div>
        <p className="text-text-dim text-caption mt-1">Ctrl+Enter to send · Encrypted, only the two of you can read it</p>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function DMView() {
  const { pubkey, loggedIn } = useUserStore();
  const { pendingDMPubkey } = useUIStore();

  const [conversations, setConversations] = useState<Map<string, NDKEvent[]>>(new Map());
  // The New message dialog, which of its two openers was used (focus goes back there when it closes
  // without a pick), and whether the next conversation panel takes focus (after a pick).
  const [newOpen, setNewOpen] = useState<"plus" | "pane" | null>(null);
  const [focusNext, setFocusNext] = useState(false);
  const plusRef = useRef<HTMLButtonElement>(null);
  const emptyRef = useRef<HTMLButtonElement>(null);
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Distinguishes "you have no messages" from "we could not reach a relay".
  // Messages is the only major view with no SQLite cache, so it is the one
  // place a dead pool is fully visible — and until #65 it rendered as an empty
  // contact list with no explanation, because the only error path was
  // `debug.error`, which is stripped from production builds.
  const [unreachable, setUnreachable] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const hasSigner = !!getNDK().signer;

  // Handle navigation from ProfileView
  useEffect(() => {
    if (pendingDMPubkey) {
      setSelectedPubkey(pendingDMPubkey);
      useUIStore.setState({ pendingDMPubkey: null });
    }
  }, [pendingDMPubkey]);

  // Load conversations
  //
  // Every other view calls `ensureConnected()` before fetching; this one never
  // did. On its own that was survivable, but combined with the pool reporting
  // itself connected through a half-open socket it meant a network drop left
  // Messages permanently blank until the app was restarted. See #65.
  useEffect(() => {
    if (!pubkey || !hasSigner) return;
    let cancelled = false;
    setLoading(true);
    setUnreachable(false);

    (async () => {
      try {
        if (!(await ensureConnected())) {
          if (!cancelled) setUnreachable(true);
          return;
        }

        const events = await fetchDMConversations(pubkey);
        if (cancelled) return;

        const grouped = groupConversations(events, pubkey);
        // An empty result while nothing is answering is not an empty inbox.
        // The three fetches behind this call can all time out after the check
        // above passed, which is precisely the reported failure.
        if (grouped.size === 0 && isPoolSilent()) {
          setUnreachable(true);
          return;
        }

        // Merged, not replaced: a conversation started while this load ran keeps its row.
        setConversations((prev) => { const next = new Map(grouped); for (const [pk, msgs] of prev) if (!next.has(pk)) next.set(pk, msgs); return next; });
        // Auto-select the first if none is chosen by then and none is pending: read at that moment, not
        // from this effect's closure, or a conversation picked during the load was swapped for another.
        if (!pendingDMPubkey && grouped.size > 0) {
          setSelectedPubkey((cur) => cur ?? Array.from(grouped.keys())[0]);
        }
        // Compute DM unread counts
        const convList = Array.from(grouped.entries()).map(([partnerPubkey, msgs]) => ({
          partnerPubkey,
          lastAt: msgs[0]?.created_at ?? 0,
        }));
        useNotificationsStore.getState().computeDMUnread(convList);
      } catch (err) {
        debug.error("Failed to fetch DM conversations:", err);
        if (!cancelled) setUnreachable(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pubkey, hasSigner, reloadKey]);

  if (!loggedIn || !pubkey) {
    return (
      <div className="h-full flex flex-col">
        <ViewHeader title="Messages" />
        <div className="flex-1 flex items-center justify-center text-text-dim text-body">
          Log in to send and receive direct messages.
        </div>
      </div>
    );
  }

  if (!hasSigner) {
    return (
      <div className="h-full flex flex-col">
        <ViewHeader title="Messages" />
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-8 text-center">
          <p className="text-text-dim text-body">Direct messages require a private key login.</p>
          <p className="text-text-dim text-caption">Read-only (npub) accounts cannot encrypt or decrypt DMs.</p>
        </div>
      </div>
    );
  }

  // Build sorted conversation list (newest first)
  const sortedPartners = Array.from(conversations.entries())
    .sort((a, b) => (b[1][0]?.created_at ?? 0) - (a[1][0]?.created_at ?? 0));

  return (
    <div className="h-full flex">
      {/* Left: conversation list */}
      <div className="w-56 border-r border-border-subtle flex flex-col shrink-0">
        <ViewHeader title="Messages" actions={<Button ref={plusRef} square size="sm" variant="ghost" onClick={() => setNewOpen("plus")} aria-label="New message" title="New message"><Plus /></Button>} />

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-3 py-6 text-text-dim text-caption text-center">Loading…</div>
          )}
          {!loading && unreachable && (
            <div className="px-3 py-6 text-center">
              <p className="text-text-dim text-caption mb-2">
                Couldn't reach any relay, so your messages can't be loaded.
              </p>
              <Button onClick={() => setReloadKey((n) => n + 1)}>Try again</Button>
            </div>
          )}
          {!loading && !unreachable && conversations.size === 0 && (
            <div className="px-3 py-6 text-text-dim text-caption text-center">
              No messages yet.
            </div>
          )}
          {sortedPartners.map(([partner, events]) =>
            events[0] ? (
              <ConvRow
                key={partner}
                partnerPubkey={partner}
                lastEvent={events[0]}
                selected={selectedPubkey === partner}
                onSelect={() => {
                  setFocusNext(false);
                  setSelectedPubkey(partner);
                  useNotificationsStore.getState().markDMRead(partner);
                }}
              />
            ) : (
              <button
                key={partner}
                onClick={() => { setFocusNext(false); setSelectedPubkey(partner); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  selectedPubkey === partner ? "bg-accent/10 border-l-2 border-accent" : "hover:bg-bg-hover border-l-2 border-transparent"
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs shrink-0">?</div>
                <div className="flex-1 min-w-0">
                  <span className="text-text text-body font-medium truncate block">{shortenPubkey(partner)}</span>
                  <span className="text-text-dim text-caption">New conversation</span>
                </div>
              </button>
            )
          )}
        </div>

      </div>

      {/* Right: thread or empty state */}
      {selectedPubkey ? (
        // Keyed: each conversation is its own panel. One panel for all of
        // them kept the text typed for one person in the box for the next,
        // and a send that finished after a switch put the old conversation's
        // messages under the new one's name.
        <ThreadPanel key={`${pubkey}:${selectedPubkey}`} partnerPubkey={selectedPubkey} myPubkey={pubkey} focusOnMount={focusNext} />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-sm text-center">
            {/* "No conversations yet" only once the relays have said so. */}
            <p className="text-text text-body font-medium">
              {loading ? "Loading your conversations…" : unreachable ? "Your conversations could not be loaded." : conversations.size === 0 ? "No conversations yet." : "Pick a conversation."}
            </p>
            <p className="text-text-muted text-body mt-1">Messages are encrypted; only the two of you can read them. Start one with someone you follow, or paste a public key.</p>
            <Button ref={emptyRef} variant="primary" className="mt-4" onClick={() => setNewOpen("pane")}><MessageSquarePlus />New message</Button>
          </div>
        </div>
      )}
      {newOpen && (
        <NewMessageDialog
          onClose={() => setNewOpen(null)}
          returnFocus={newOpen === "plus" ? plusRef : emptyRef}
          onPick={(pk) => {
            setNewOpen(null);
            setFocusNext(true);
            setSelectedPubkey(pk);
            // A conversation with nothing in it yet, so the panel opens for it. Checked inside the update:
            // the list may have arrived, with this person in it, while the dialog was open.
            setConversations((prev) => (prev.has(pk) ? prev : new Map(prev).set(pk, [])));
          }}
        />
      )}
    </div>
  );
}
