import { useCallback, useId, useState } from "react";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import { useRelayStatus, type RelayOrigin } from "../../hooks/useRelayStatus";

function shortenUrl(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

const GROUPS: { origin: RelayOrigin; label: string; hint: string }[] = [
  { origin: "configured", label: "Your relays", hint: "From your relay list" },
  { origin: "local", label: "Built in", hint: "Vega's embedded relay" },
  { origin: "discovered", label: "Extra reach", hint: "Found via Relay reach" },
];

/** Whether an element's focus is the kind that draws a focus ring. Where the engine cannot say, assume it is. */
function cameFromKeyboard(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

export function RelayStatusBadge() {
  const { connectedCount, totalCount, discoveredCount, relays } = useRelayStatus();
  // Shown under the pointer and under the keyboard focus. It was hover-only
  // and could not be reached without a mouse.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const shown = hovered || focused;
  const tipId = useId();
  const hide = useCallback(() => { setHovered(false); setFocused(false); }, []);
  useEscapeToClose(hide, shown);

  const ratio = totalCount > 0 ? connectedCount / totalCount : 0;
  const colorClass =
    ratio > 0.75 ? "text-success" : ratio > 0.25 ? "text-warning" : "text-danger";
  const dotClass =
    ratio > 0.75 ? "bg-success" : ratio > 0.25 ? "bg-warning" : "bg-danger";

  if (totalCount === 0 && discoveredCount === 0) return null;

  return (
    <span
      tabIndex={0}
      aria-describedby={tipId}
      className={`relative ${colorClass} text-caption flex items-center gap-1 cursor-default rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Only focus that came from the keyboard. A click focuses this too, and
      // would leave the list pinned open after the pointer had gone.
      onFocus={(e) => setFocused(cameFromKeyboard(e.currentTarget))}
      onBlur={() => setFocused(false)}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass} inline-block`} />
      {connectedCount}/{totalCount} relays
      {/* Kept visually distinct from the headline: these are not the user's relays.
          Its absence is the signal that Relay reach is confining Vega to the list. */}
      {discoveredCount > 0 && (
        <span className="text-text-dim">+{discoveredCount}</span>
      )}

      {/* Always in the page, hidden until wanted, so the description is there for a screen reader before focus arrives. */}
      <div id={tipId} role="tooltip" hidden={!shown} className="absolute right-0 top-full mt-1 bg-bg-raised border border-border p-2 z-50 min-w-[220px] shadow-lg rounded-lg">
          {GROUPS.map(({ origin, label, hint }) => {
            const group = relays
              .filter((r) => r.origin === origin)
              .sort((a, b) => (a.connected === b.connected ? 0 : a.connected ? -1 : 1));
            if (group.length === 0) return null;
            return (
              <div key={origin} className="mb-1.5 last:mb-0">
                <div className="text-micro uppercase tracking-wide text-text-dim mb-0.5">
                  {label}
                </div>
                {group.map((r) => (
                  <div key={r.url} className="flex items-center gap-2 py-0.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        r.connected ? "bg-success" : "bg-danger"
                      }`}
                    />
                    <span className="text-caption text-text-dim truncate">
                      {shortenUrl(r.url)}
                    </span>
                  </div>
                ))}
                {origin === "discovered" && (
                  <div className="text-caption text-text-dim mt-0.5">{hint}</div>
                )}
              </div>
            );
          })}
      </div>
    </span>
  );
}
