import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUserStore, useCanSign } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { fetchZapsReceived, fetchZapsSent } from "../../lib/nostr";
import { ZapRow, parseReceipt } from "./ZapRow";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";
import { ListState } from "../shared/ListState";
import { Button } from "../shared/Button";
import { useLightningStore } from "../../stores/lightning";
import { fetchMark, wentUnanswered } from "../../lib/listLoad";

// ── Main view ─────────────────────────────────────────────────────────────────

type Tab = "received" | "sent";

export function ZapHistoryView() {
  // Reached from the account menu (or a deep link), not from the sidebar: Back only when there is a way back.
  const { viewStack, goBack } = useUIStore();
  const back = viewStack.length > 0 ? goBack : undefined;
  const { pubkey, loggedIn, profile: ownProfile } = useUserStore();
  const canSign = useCanSign();
  const nwcUri = useLightningStore((s) => s.nwcUri);
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
        <ViewHeader title="Zap history" onBack={back} />
        <div className="flex-1 flex items-center justify-center text-text-dim text-body">
          Log in to see your zap history.
        </div>
      </div>
    );
  }

  const activeEvents = tab === "received" ? received : sent;
  // Receiving takes a Lightning address on the profile; sending takes a wallet.
  const hasLightningAddress = !!(ownProfile?.lud16 || ownProfile?.lud06);

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
      {/* The account menu calls this Zap history, so the header does too. */}
      <ViewHeader
        title="Zap history"
        onBack={back}
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
            emptyHint={tab === "received"
              ? hasLightningAddress
                ? "A zap is a small Bitcoin tip sent over Lightning. Zaps people send you show up here."
                : "A zap is a small Bitcoin tip sent over Lightning. To receive them, add a Lightning address to your profile."
              : "A zap is a small Bitcoin tip sent over Lightning. Press the bolt under a note to send one."}
            emptyAction={tab === "received"
              ? !hasLightningAddress && canSign
                ? <Button onClick={() => useUIStore.getState().openProfileEditor(pubkey)}>Add a Lightning address</Button>
                : undefined
              : nwcUri ? undefined : <Button onClick={() => useUIStore.getState().openSettings("wallet")}>Connect a wallet</Button>}
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
