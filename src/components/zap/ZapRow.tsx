import { useEffect, useState, useCallback } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { fetchNoteById } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { timeAgo, shortenPubkey, profileName } from "../../lib/utils";

// ── Parsing helpers ──────────────────────────────────────────────────────────

/**
 * Who zapped, how much, what they said and for which note, as the receipt
 * tells it. The zapper is the author of the embedded zap request (what they
 * signed); the receipt's `P` tag is the LN provider's word and only a fallback.
 * Whether the request is genuinely the zapper's, and whether the receipt comes
 * from the recipient's LN provider, are not checked here, so a forged receipt
 * can still name anyone and any amount (a known gap, see "Notifications" in
 * CLAUDE.md).
 */
export function parseReceipt(receipt: NDKEvent): { amount: number | null; senderPubkey: string | null; comment: string; noteId: string | null } {
  let amount: number | null = null;
  let senderPubkey: string | null = null;
  let comment = "";
  const noteId = receipt.tags.find((t) => t[0] === "e")?.[1] ?? null;

  // Amount + comment come from the embedded zap request in the "description" tag
  const desc = receipt.tags.find((t) => t[0] === "description")?.[1];
  if (desc) {
    try {
      const zapReq = JSON.parse(desc) as { pubkey?: string; content?: string; tags?: string[][] };
      if (typeof zapReq.pubkey === "string" && /^[0-9a-f]{64}$/i.test(zapReq.pubkey)) senderPubkey = zapReq.pubkey.toLowerCase();
      comment = typeof zapReq.content === "string" ? zapReq.content : "";
      const msats = Number(zapReq.tags?.find((t) => t[0] === "amount")?.[1]);
      if (Number.isFinite(msats) && msats > 0) amount = Math.round(msats / 1000);
    } catch { /* malformed */ }
  }
  if (!senderPubkey) senderPubkey = receipt.tags.find((t) => t[0] === "P")?.[1] ?? null;

  return { amount, senderPubkey, comment, noteId };
}


// ── Row component ────────────────────────────────────────────────────────────

/**
 * A zap receipt (kind 9735) as a row: who, how much, the comment and the note
 * it was for. Shared by Zap history and the Zaps tab of Notifications.
 */
export function ZapRow({
  pubkey,
  amount,
  comment,
  noteId,
  createdAt,
  direction,
  compact = false,
}: {
  pubkey: string | null;
  amount: number | null;
  comment: string;
  noteId: string | null;
  createdAt: number;
  direction: "received" | "sent";
  /** Under a reason line that already says who, how much and when: only the avatar, the comment and the note. */
  compact?: boolean;
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
        {!compact && <div className="flex items-baseline gap-2 mb-0.5">
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
        </div>}
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
