import { useState } from "react";
import { useV4VStore, type V4VHistoryEntry } from "../../stores/v4v";

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function HistoryRow({ entry }: { entry: V4VHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const totalSats = entry.satsStreamed + entry.satsBoosted;

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 hover:bg-bg-hover transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-text truncate">{entry.episodeTitle}</div>
            <div className="text-[10px] text-text-dim truncate">{entry.showTitle}</div>
          </div>
          <div className="shrink-0 text-right ml-3">
            <div className="text-[12px] text-amber-400 font-medium">{totalSats} sats</div>
            <div className="text-[9px] text-text-dim">{formatDate(entry.timestamp)}</div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {entry.satsStreamed > 0 && (
            <div className="text-[10px] text-text-dim">Streamed: {entry.satsStreamed} sats</div>
          )}
          {entry.satsBoosted > 0 && (
            <div className="text-[10px] text-text-dim">Boosted: {entry.satsBoosted} sats</div>
          )}
          {entry.recipients.length > 0 && (
            <div className="mt-1">
              <div className="text-[9px] text-text-dim mb-1">Recipients:</div>
              {entry.recipients.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-[10px]">
                  <span className="text-text-muted truncate">{r.name || r.address.slice(0, 16) + "…"}</span>
                  <span className="text-text-dim shrink-0 ml-2">{r.sats} sats</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function V4VHistory() {
  const history = useV4VStore((s) => s.history);

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <div className="text-[13px] text-text-dim">No V4V history yet</div>
          <div className="text-[11px] text-text-dim/60 mt-1">
            Start streaming to see your contributions here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      {history.map((entry, i) => (
        <HistoryRow key={`${entry.episodeGuid}-${entry.timestamp}-${i}`} entry={entry} />
      ))}
    </div>
  );
}
