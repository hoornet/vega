import { useEffect, useMemo, useRef, useState } from "react";
import { NDKEvent, NDKKind, nip19 } from "@nostr-dev-kit/ndk";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { useNotificationsStore } from "../../stores/notifications";
import { fetchDMConversations, fetchDMThread, sendDM, decryptDM, getNDK, ensureConnected, isPoolSilent } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { useAutoResize } from "../../hooks/useAutoResize";
import { timeAgo, shortenPubkey, profileName } from "../../lib/utils";
import { debug } from "../../lib/debug";
import { parseContent } from "../../lib/parsing";
import { tryHandleUrlInternally, tryOpenNostrEntity } from "../feed/TextSegments";

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
        <img src={profile.picture} alt={`${name}'s avatar`} className="w-8 h-8 rounded-sm object-cover shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <div className="w-8 h-8 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs shrink-0">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span title={name} className="text-text text-[12px] font-medium truncate">{name}</span>
          <span className="text-text-dim text-[10px] shrink-0">{time}</span>
        </div>
        <div className="text-text-dim text-[11px] truncate">
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
              className="max-h-48 max-w-full rounded-md mt-1.5 block"
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
            <span key={i} className="text-accent/60 text-xs cursor-pointer hover:text-accent italic">
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
        className={`note-content max-w-[75%] px-3 py-2 text-[12px] leading-relaxed break-words ${
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
        <div className={`text-[10px] mt-1 ${isMine ? "text-accent/60" : "text-text-dim"}`}>
          {time}
        </div>
      </div>
    </div>
  );
}

// ── Thread panel ──────────────────────────────────────────────────────────────

function ThreadPanel({
  partnerPubkey,
  myPubkey,
}: {
  partnerPubkey: string;
  myPubkey: string;
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

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    fetchDMThread(myPubkey, partnerPubkey)
      .then(setMessages)
      .catch((err) => debug.error("Failed to fetch DM thread:", err))
      .finally(() => setLoading(false));
  }, [partnerPubkey, myPubkey]);

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
      // Re-fetch thread to include the sent message
      const updated = await fetchDMThread(myPubkey, partnerPubkey);
      debug.log("[DM-UI] re-fetch got", updated.length, "messages");
      setMessages(updated);
      textareaRef.current?.focus();
    } catch (err) {
      debug.error("[DM-UI] send failed:", err);
      setSendError(String(err));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend();
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="border-b border-border px-4 py-2.5 flex items-center gap-3 shrink-0">
        {profile?.picture && (
          <img src={profile.picture} alt={`${name}'s avatar`} className="w-7 h-7 rounded-sm object-cover" />
        )}
        <button
          onClick={() => openProfile(partnerPubkey)}
          className="text-text text-[13px] font-medium hover:text-accent transition-colors"
        >
          {name}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <div className="text-text-dim text-[12px] text-center py-8">Loading messages…</div>
        )}
        {!loading && messages.length === 0 && (
          <div className="text-text-dim text-[12px] text-center py-8">
            No messages yet. Say hello!
          </div>
        )}
        {messages.map((e) => (
          <MessageBubble key={e.id} event={e} myPubkey={myPubkey} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <div className="border-t border-border px-4 py-3 shrink-0">
        {sendError && <p className="text-danger text-[11px] mb-2">{sendError}</p>}
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); autoResize(e); }}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${name}…`}
            rows={2}
            className="flex-1 bg-bg border border-border px-3 py-2 text-text text-[12px] resize-none focus:outline-none focus:border-accent/50 placeholder:text-text-dim"
            style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="px-3 self-end py-2 text-[11px] bg-accent hover:bg-accent-hover text-accent-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0 focus-visible:ring-1 focus-visible:ring-accent"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
        <p className="text-text-dim text-[10px] mt-1">Ctrl+Enter to send · gift-wrapped (NIP-17)</p>
      </div>
    </div>
  );
}

// ── New conversation input ────────────────────────────────────────────────────

// Collapsed to a single "New message" link until it's actually needed. It lives
// at the bottom of the list column, directly alongside the thread's Send button,
// so a permanently visible field and a second always-there button read as two
// competing send affordances.
function NewConvInput({ onStart }: { onStart: (pubkey: string) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setInput("");
    setError(null);
  };

  const handleStart = () => {
    const raw = input.trim();
    if (!raw) return;
    try {
      if (raw.startsWith("npub1")) {
        const decoded = nip19.decode(raw);
        if (decoded.type !== "npub") throw new Error("Not an npub");
        onStart(decoded.data as string);
        close();
      } else if (/^[0-9a-f]{64}$/.test(raw)) {
        onStart(raw);
        close();
      } else {
        setError("Enter an npub1… or hex pubkey");
      }
    } catch {
      setError("Invalid public key");
    }
  };

  if (!open) {
    return (
      <div className="px-3 py-2 border-t border-border">
        <button
          onClick={() => setOpen(true)}
          className="w-full text-left text-text-dim hover:text-accent text-[11px] py-1 transition-colors focus-visible:ring-1 focus-visible:ring-accent"
        >
          + New message
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 border-t border-border">
      {/* min-w-0 is required, not cosmetic: flex-1 leaves min-width:auto, so the
          input won't shrink below its intrinsic size=20 monospace width. Below
          roughly a 240px list column the row overflows and pushes the shrink-0
          button out under the message panel. */}
      <div className="flex gap-1.5">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleStart();
            if (e.key === "Escape") close();
          }}
          onBlur={() => { if (!input.trim()) close(); }}
          placeholder="npub1… or hex pubkey"
          className="flex-1 min-w-0 bg-bg border border-border px-2 py-1.5 text-text text-[11px] font-mono focus:outline-none focus:border-accent/50 placeholder:text-text-dim"
          style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
        />
        <button
          onMouseDown={(e) => e.preventDefault()} /* don't let onBlur close before the click lands */
          onClick={handleStart}
          disabled={!input.trim()}
          aria-label="Start conversation"
          title="Start conversation"
          className="px-2 py-1.5 text-[11px] border border-border text-text-dim hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-30 shrink-0"
        >
          →
        </button>
      </div>
      {error && <p className="text-danger text-[10px] mt-1">{error}</p>}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function DMView() {
  const { pubkey, loggedIn } = useUserStore();
  const { pendingDMPubkey } = useUIStore();

  const [conversations, setConversations] = useState<Map<string, NDKEvent[]>>(new Map());
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

        setConversations(grouped);
        // Auto-select first if none chosen and no pending
        if (!selectedPubkey && !pendingDMPubkey && grouped.size > 0) {
          setSelectedPubkey(Array.from(grouped.keys())[0]);
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
      <div className="h-full flex items-center justify-center text-text-dim text-[12px]">
        Log in to send and receive direct messages.
      </div>
    );
  }

  if (!hasSigner) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-8 text-center">
        <p className="text-text-dim text-[12px]">Direct messages require a private key login.</p>
        <p className="text-text-dim text-[11px] opacity-70">Read-only (npub) accounts cannot encrypt or decrypt DMs.</p>
      </div>
    );
  }

  // Build sorted conversation list (newest first)
  const sortedPartners = Array.from(conversations.entries())
    .sort((a, b) => (b[1][0]?.created_at ?? 0) - (a[1][0]?.created_at ?? 0));

  return (
    <div className="h-full flex">
      {/* Left: conversation list */}
      <div className="w-56 border-r border-border flex flex-col shrink-0">
        <div className="border-b border-border px-3 py-2.5 shrink-0">
          <h2 className="text-text text-[12px] font-medium">Messages</h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-3 py-6 text-text-dim text-[11px] text-center">Loading…</div>
          )}
          {!loading && unreachable && (
            <div className="px-3 py-6 text-center">
              <p className="text-text-dim text-[11px] mb-2">
                Couldn't reach any relay, so your messages can't be loaded.
              </p>
              <button
                onClick={() => setReloadKey((n) => n + 1)}
                className="text-accent text-[11px] hover:underline"
              >
                Try again
              </button>
            </div>
          )}
          {!loading && !unreachable && conversations.size === 0 && (
            <div className="px-3 py-6 text-text-dim text-[11px] text-center">
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
                  setSelectedPubkey(partner);
                  useNotificationsStore.getState().markDMRead(partner);
                }}
              />
            ) : (
              <button
                key={partner}
                onClick={() => setSelectedPubkey(partner)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  selectedPubkey === partner ? "bg-accent/10 border-l-2 border-accent" : "hover:bg-bg-hover border-l-2 border-transparent"
                }`}
              >
                <div className="w-8 h-8 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs shrink-0">?</div>
                <div className="flex-1 min-w-0">
                  <span className="text-text text-[12px] font-medium truncate block">{shortenPubkey(partner)}</span>
                  <span className="text-text-dim text-[11px]">New conversation</span>
                </div>
              </button>
            )
          )}
        </div>

        <NewConvInput
          onStart={(pk) => {
            setSelectedPubkey(pk);
            // Add to conversations map if not already there
            if (!conversations.has(pk)) {
              setConversations((prev) => new Map(prev).set(pk, []));
            }
          }}
        />
      </div>

      {/* Right: thread or empty state */}
      {selectedPubkey ? (
        <ThreadPanel partnerPubkey={selectedPubkey} myPubkey={pubkey} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-text-dim text-[12px]">
          Select a conversation or start a new one.
        </div>
      )}
    </div>
  );
}
