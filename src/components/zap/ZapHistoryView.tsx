import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { fetchZapsReceived, fetchZapsSent } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { timeAgo, shortenPubkey } from "../../lib/utils";

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
  createdAt,
  direction,
}: {
  pubkey: string | null;
  amount: number | null;
  comment: string;
  createdAt: number;
  direction: "received" | "sent";
}) {
  const { openProfile } = useUIStore();
  const profile = useProfile(pubkey ?? "");
  const name = pubkey
    ? profile?.displayName || profile?.name || shortenPubkey(pubkey)
    : "anonymous";
  const avatar = profile?.picture;

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border hover:bg-bg-hover transition-colors">
      {/* Avatar */}
      <div
        className={`shrink-0 cursor-pointer ${!pubkey ? "pointer-events-none" : ""}`}
        onClick={() => pubkey && openProfile(pubkey)}
      >
        {avatar ? (
          <img src={avatar} alt="" className="w-8 h-8 rounded-sm object-cover" loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-8 h-8 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-zap font-medium text-[13px]">
            ⚡ {amount !== null ? `${amount.toLocaleString()} sats` : "? sats"}
          </span>
          <span className="text-text-dim text-[11px]">
            {direction === "received" ? "from" : "to"}
          </span>
          <span
            className={`text-text text-[12px] truncate ${pubkey ? "cursor-pointer hover:text-accent transition-colors" : ""}`}
            onClick={() => pubkey && openProfile(pubkey)}
          >
            {name}
          </span>
          <span className="text-text-dim text-[11px] shrink-0 ml-auto">{timeAgo(createdAt)}</span>
        </div>
        {comment && (
          <p className="text-text-muted text-[12px] leading-snug">{comment}</p>
        )}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

type Tab = "received" | "sent";

export function ZapHistoryView() {
  const { pubkey, loggedIn } = useUserStore();
  const { goBack } = useUIStore();
  const [tab, setTab] = useState<Tab>("received");
  const [received, setReceived] = useState<NDKEvent[]>([]);
  const [sent, setSent] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pubkey) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchZapsReceived(pubkey, 50),
      fetchZapsSent(pubkey, 50),
    ])
      .then(([rec, snt]) => {
        setReceived(rec);
        setSent(snt);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [pubkey]);

  if (!loggedIn || !pubkey) {
    return (
      <div className="h-full flex flex-col">
        <header className="border-b border-border px-4 py-2.5 shrink-0">
          <h1 className="text-text text-sm font-medium">Zap History</h1>
        </header>
        <div className="flex-1 flex items-center justify-center text-text-dim text-[12px]">
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
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="text-text-dim hover:text-text text-[11px] transition-colors">
            ← back
          </button>
          <h1 className="text-text text-sm font-medium">Zap History</h1>
        </div>
        <div className="text-text-dim text-[11px] flex gap-4">
          <span>⚡ {totalReceived.toLocaleString()} in</span>
          <span>⚡ {totalSent.toLocaleString()} out</span>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        {(["received", "sent"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-[12px] transition-colors ${
              tab === t
                ? "text-text border-b-2 border-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            {t === "received"
              ? `Received${received.length ? ` (${received.length})` : ""}`
              : `Sent${sent.length ? ` (${sent.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">Loading zap history…</div>
        )}
        {error && (
          <div className="px-4 py-3 text-danger text-[12px] border-b border-border">{error}</div>
        )}
        {!loading && activeEvents.length === 0 && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">
            {tab === "received" ? "No zaps received yet." : "No zaps sent yet."}
          </div>
        )}
        {!loading &&
          activeEvents.map((event) => {
            if (tab === "received") {
              const { amount, senderPubkey, comment } = parseReceipt(event);
              return (
                <ZapRow
                  key={event.id}
                  pubkey={senderPubkey}
                  amount={amount}
                  comment={comment}
                  createdAt={event.created_at ?? 0}
                  direction="received"
                />
              );
            } else {
              // Sent zaps are also kind 9735 receipts; the recipient is in the lowercase "p" tag
              const recipientPubkey = event.tags.find((t) => t[0] === "p")?.[1] ?? null;
              const { amount, comment } = parseReceipt(event);
              return (
                <ZapRow
                  key={event.id}
                  pubkey={recipientPubkey}
                  amount={amount}
                  comment={comment}
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
