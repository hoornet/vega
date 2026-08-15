import { useState } from "react";
import { useRelayStatus, type RelayOrigin } from "../../hooks/useRelayStatus";

function shortenUrl(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

const GROUPS: { origin: RelayOrigin; label: string; hint: string }[] = [
  { origin: "configured", label: "Your relays", hint: "From your relay list" },
  { origin: "local", label: "Built in", hint: "Vega's embedded relay" },
  { origin: "discovered", label: "Extra reach", hint: "Found via Relay reach" },
];

export function RelayStatusBadge() {
  const { connectedCount, totalCount, discoveredCount, relays } = useRelayStatus();
  const [hovered, setHovered] = useState(false);

  const ratio = totalCount > 0 ? connectedCount / totalCount : 0;
  const colorClass =
    ratio > 0.75 ? "text-success" : ratio > 0.25 ? "text-warning" : "text-danger";
  const dotClass =
    ratio > 0.75 ? "bg-success" : ratio > 0.25 ? "bg-warning" : "bg-danger";

  if (totalCount === 0 && discoveredCount === 0) return null;

  return (
    <span
      className={`relative ${colorClass} text-[11px] flex items-center gap-1 cursor-default`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass} inline-block`} />
      {connectedCount}/{totalCount} relays
      {/* Kept visually distinct from the headline: these are not the user's relays.
          Its absence is the signal that Relay reach is confining Vega to the list. */}
      {discoveredCount > 0 && (
        <span className="text-text-dim">+{discoveredCount}</span>
      )}

      {hovered && (
        <div className="absolute right-0 top-full mt-1 bg-bg-raised border border-border p-2 z-50 min-w-[220px] shadow-lg">
          {GROUPS.map(({ origin, label, hint }) => {
            const group = relays
              .filter((r) => r.origin === origin)
              .sort((a, b) => (a.connected === b.connected ? 0 : a.connected ? -1 : 1));
            if (group.length === 0) return null;
            return (
              <div key={origin} className="mb-1.5 last:mb-0">
                <div className="text-[10px] uppercase tracking-wide text-text-dim mb-0.5">
                  {label}
                </div>
                {group.map((r) => (
                  <div key={r.url} className="flex items-center gap-2 py-0.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        r.connected ? "bg-success" : "bg-danger"
                      }`}
                    />
                    <span className="text-[11px] text-text-dim truncate">
                      {shortenUrl(r.url)}
                    </span>
                  </div>
                ))}
                {origin === "discovered" && (
                  <div className="text-[10px] text-text-dim mt-0.5 opacity-70">{hint}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}
