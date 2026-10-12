import { useEffect, useState, useCallback } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { fetchZapsReceived, fetchZapsSent, fetchNoteById } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { timeAgo, shortenPubkey, profileName } from "../../lib/utils";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";
import { ListState } from "../shared/ListState";
import { fetchMark, wentUnanswered } from "../../lib/listLoad";

// ── Parsing helpers ──────────────────────────────────────────────────────────

function parseReceipt(receipt: NDKEvent): { amount: number | null; senderPubkey: string | null; comment: string; noteId: string | null } {
  let amount: number | null = null;
  let senderPubkey: string | null = null;
  let comment = "";
  const noteId = receipt.tags.find((t) => t[0] === "e")?.[1] ?? null;

  // Sender pubkey: uppercase 'P' tag is the zapper
  senderPubkey = receipt.tags.find((t) => t[0] === "P")?.[1] ?? null;

  // Amount + comment come from the embedded zap request in the "description" tag
  const desc = receipt.tags.find((t) => t[0] === "description")?.[1];
  if (desc) {
    try {
      const zapReq = JSON.parse(desc) as { pubkey?: string; content?: string; tags?: string[][] };
      if (!senderPubkey && zapReq.pubkey) senderPubkey = zapReq.pubkey;
      comment = zapReq.content ?? "";
      const amountTag = zapReq.tags?.find((t) => t[0] === "amount");
      if (amountTag?.[1]) amount = Math.round(parseInt(amountTag[1]) / 1000);
    } catch { /* malformed */ }
  }

  return { amount, senderPubkey, comment, noteId };
}


// ── Row component ────────────────────────────────────────────────────────────

function ZapRow({
  pubkey,
  amount,
  comment,
  noteId,
  createdAt,
  direction,
}: {
  pubkey: string | null;
  amount: number | null;
  comment: string;
  noteId: string | null;
  createdAt: number;
  direction: "received" | "sent";
}) {
  const { openProfile, openThread } = useUIStore();
  const profile = useProfile(pubkey ?? "");
  const name = pubkey
    ? profileName(profile, shortenPubkey(pubkey))
    : "anonymous";
  const avatar = typeof profile?.picture === "string" ? profile.picture : undefined;
  const [notePreview, setNotePreview] = useState<string | null>(null);
  const [noteEvent, setNoteEvent] = useState<NDKEvent | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

  useEffect(() => {
    if (!noteId) return;
    fetchNoteById(noteId).then((event) => {
      if (event) {
        setNoteEvent(event);
        setNotePreview(event.content?.slice(0, 120) || null);
      }
    }).catch(() => {});
  }, [noteId]);

  const handleNoteClick = useCallback(async () => {
    if (noteEvent) {
      openThread(noteEvent);
      return;
    }
    if (!noteId || loadingNote) return;
    setLoadingNote(true);
    try {
      const event = await fetchNoteById(noteId);
      if (event) {
        setNoteEvent(event);
        openThread(event);
      }
    } catch { /* ignore */ }
    finally { setLoadingNote(false); }
  }, [noteId, noteEvent, loadingNote, openThread]);

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border-subtle hover:bg-bg-hover transition-colors">
      {/* Avatar */}
      <div
        className={`shrink-0 cursor-pointer ${!pubkey ? "pointer-events-none" : ""}`}
        onClick={() => pubkey && openProfile(pubkey)}
      >
        {avatar ? (
          <img src={avatar} alt={`${name}'s avatar`} className="w-8 h-8 rounded-full object-cover" loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-8 h-8 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-zap font-medium text-body">
            ⚡ {amount !== null ? `${amount.toLocaleString()} sats` : "? sats"}
          </span>
          <span className="text-text-dim text-caption">
            {direction === "received" ? "from" : "to"}
          </span>
          <span
            className={`text-text text-body truncate ${pubkey ? "cursor-pointer hover:text-accent transition-colors" : ""}`}
            onClick={() => pubkey && openProfile(pubkey)}
          >
            {name}
          </span>
          <span className="text-text-dim text-caption shrink-0 ml-auto">{timeAgo(createdAt)}</span>
        </div>
        {comment && (
          <p className="text-text-muted text-body leading-snug">{comment}</p>
        )}
        {noteId && (
          <button
            onClick={handleNoteClick}
            className="mt-1.5 w-full text-left bg-bg-raised border border-border px-3 py-2 rounded-lg hover:border-accent/40 transition-colors cursor-pointer group"
          >
            {notePreview ? (
              <p className="text-text-muted text-caption leading-snug line-clamp-2 group-hover:text-text transition-colors">
                {notePreview}
              </p>
            ) : (
              <span className="text-text-dim text-caption">
                {loadingNote ? "loading note…" : "view original note →"}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

type Tab = "received" | "sent";

export function ZapHistoryView() {
  const { pubkey, loggedIn } = useUserStore();
  const [tab, setTab] = useState<Tab>("received");
  const [received, setReceived] = useState<NDKEvent[]>([]);
  const [sent, setSent] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The network did not answer this load: "no zaps yet" on a tab with no rows would be a guess.
  const [unanswered, setUnanswered] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!pubkey) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUnanswered(false);
    const mark = fetchMark();
    Promise.all([
      fetchZapsReceived(pubkey, 50),
      fetchZapsSent(pubkey, 50),
    ])
      .then(([rec, snt]) => {
        if (cancelled) return;
        setReceived(rec);
        setSent(snt);
        // Not "and nothing came back": whether the network answered is already
        // what the totals say. Rows from the built-in relay alone on one tab
        // do not make the other tab's emptiness known.
        setUnanswered(wentUnanswered(mark));
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pubkey, reloadKey]);

  if (!loggedIn || !pubkey) {
    return (
      <div className="h-full flex flex-col">
        <ViewHeader title="Zaps" />
        <div className="flex-1 flex items-center justify-center text-text-dim text-body">
          Log in to see your zap history.
        </div>
      </div>
    );
  }

  const activeEvents = tab === "received" ? received : sent;

  // Compute totals
  const totalReceived = received.reduce((sum, e) => {
    const { amount } = parseReceipt(e);
    return sum + (amount ?? 0);
  }, 0);
  const totalSent = sent.reduce((sum, e) => {
    const { amount } = parseReceipt(e);
    return sum + (amount ?? 0);
  }, 0);

  return (
    <div className="h-full flex flex-col">
      {/* The sidebar calls this view Zaps. It is a top-level view, so no Back. */}
      <ViewHeader
        title="Zaps"
        // Totals only once they are known: not "0 in, 0 out" beside a history that could not be read.
        actions={loading || error !== null || (unanswered && received.length === 0 && sent.length === 0) ? undefined : (
          <div className="text-text-dim text-caption flex gap-4">
            <span>⚡ {totalReceived.toLocaleString()} in</span>
            <span>⚡ {totalSent.toLocaleString()} out</span>
          </div>
        )}
      />
      <Tabs
        label="Zaps"
        panel="zaps-panel"
        tabs={[
          { id: "received", label: "Received", count: received.length || undefined },
          { id: "sent", label: "Sent", count: sent.length || undefined },
        ]}
        value={tab}
        onChange={setTab}
      />

      {/* Body */}
      <div {...tabPanelProps("zaps-panel", tab)} className="flex-1 overflow-y-auto content-column">
        {(loading || activeEvents.length === 0) && (
          <ListState
            state={loading ? "loading" : error !== null ? "error" : unanswered ? "unreachable" : "empty"}
            loadingLabel="Loading zap history…"
            empty={tab === "received" ? "No zaps received yet." : "No zaps sent yet."}
            what="your zap history"
            error={error ?? undefined}
            onRetry={() => setReloadKey((n) => n + 1)}
          />
        )}
        {!loading &&
          activeEvents.map((event) => {
            if (tab === "received") {
              const { amount, senderPubkey, comment, noteId } = parseReceipt(event);
              return (
                <ZapRow
                  key={event.id}
                  pubkey={senderPubkey}
                  amount={amount}
                  comment={comment}
                  noteId={noteId}
                  createdAt={event.created_at ?? 0}
                  direction="received"
                />
              );
            } else {
              // Sent zaps are also kind 9735 receipts; the recipient is in the lowercase "p" tag
              const recipientPubkey = event.tags.find((t) => t[0] === "p")?.[1] ?? null;
              const { amount, comment, noteId } = parseReceipt(event);
              return (
                <ZapRow
                  key={event.id}
                  pubkey={recipientPubkey}
                  amount={amount}
                  comment={comment}
                  noteId={noteId}
                  createdAt={event.created_at ?? 0}
                  direction="sent"
                />
              );
            }
          })}
      </div>
    </div>
  );
}
