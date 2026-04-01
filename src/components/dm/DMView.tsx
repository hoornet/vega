import { useEffect, useRef, useState } from "react";
import { NDKEvent, NDKKind, nip19 } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { useNotificationsStore } from "../../stores/notifications";
import { fetchDMConversations, fetchDMThread, sendDM, decryptDM, getNDK } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { timeAgo, shortenPubkey, profileName } from "../../lib/utils";

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
        <img src={profile.picture} alt="" className="w-8 h-8 rounded-sm object-cover shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <div className="w-8 h-8 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs shrink-0">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-text text-[12px] font-medium truncate">{name}</span>
          <span className="text-text-dim text-[10px] shrink-0">{time}</span>
        </div>
        <div className="text-text-dim text-[11px] truncate">
          {lastEvent.kind === NDKKind.PrivateDirectMessage ? "🔒 NIP-17" : "🔒 NIP-04"}
        </div>
      </div>
    </button>
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
        className={`max-w-[75%] px-3 py-2 text-[12px] leading-relaxed break-words ${
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
          text
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

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    fetchDMThread(myPubkey, partnerPubkey)
      .then(setMessages)
      .catch((err) => console.error("Failed to fetch DM thread:", err))
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
      await sendDM(partnerPubkey, content);
      setText("");
      // Re-fetch thread to include the sent message
      const updated = await fetchDMThread(myPubkey, partnerPubkey);
      setMessages(updated);
      textareaRef.current?.focus();
    } catch (err) {
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
          <img src={profile.picture} alt="" className="w-7 h-7 rounded-sm object-cover" />
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
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${name}…`}
            rows={2}
            className="flex-1 bg-bg border border-border px-3 py-2 text-text text-[12px] resize-none focus:outline-none focus:border-accent/50 placeholder:text-text-dim"
            style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="px-3 self-end py-2 text-[11px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            {sending ? "…" : "send"}
          </button>
        </div>
        <p className="text-text-dim text-[10px] mt-1">Ctrl+Enter to send · gift-wrapped (NIP-17)</p>
      </div>
    </div>
  );
}

// ── New conversation input ────────────────────────────────────────────────────

function NewConvInput({ onStart }: { onStart: (pubkey: string) => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleStart = () => {
    const raw = input.trim();
    if (!raw) return;
    try {
      if (raw.startsWith("npub1")) {
        const decoded = nip19.decode(raw);
        if (decoded.type !== "npub") throw new Error("Not an npub");
        onStart(decoded.data as string);
      } else if (/^[0-9a-f]{64}$/.test(raw)) {
        onStart(raw);
      } else {
        setError("Enter an npub1… or hex pubkey");
      }
    } catch {
      setError("Invalid public key");
    }
  };

  return (
    <div className="px-3 py-3 border-t border-border">
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === "Enter" && handleStart()}
          placeholder="npub1… or hex pubkey"
          className="flex-1 bg-bg border border-border px-2 py-1.5 text-text text-[11px] font-mono focus:outline-none focus:border-accent/50 placeholder:text-text-dim"
          style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
        />
        <button
          onClick={handleStart}
          disabled={!input.trim()}
          className="px-2 py-1.5 text-[10px] border border-border text-text-dim hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-30 shrink-0"
        >
          start
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
  const hasSigner = !!getNDK().signer;

  // Handle navigation from ProfileView
  useEffect(() => {
    if (pendingDMPubkey) {
      setSelectedPubkey(pendingDMPubkey);
      useUIStore.setState({ pendingDMPubkey: null });
    }
  }, [pendingDMPubkey]);

  // Load conversations
  useEffect(() => {
    if (!pubkey || !hasSigner) return;
    setLoading(true);
    fetchDMConversations(pubkey)
      .then((events) => {
        const grouped = groupConversations(events, pubkey);
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
      })
      .catch((err) => console.error("Failed to fetch DM conversations:", err))
      .finally(() => setLoading(false));
  }, [pubkey, hasSigner]);

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
          {!loading && conversations.size === 0 && (
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
