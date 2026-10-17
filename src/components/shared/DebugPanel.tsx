import { useState, useEffect } from "react";
import { getNDK, getNDKUptimeMs } from "../../lib/nostr";
import { isLiveSubActive, useFeedStore } from "../../stores/feed";
import { getRecentDiagEntries, type DiagEntry } from "../../lib/feedDiagnostics";

interface RelayInfo {
  url: string;
  connected: boolean;
}

interface DebugState {
  uptimeMs: number | null;
  liveSubActive: boolean;
  relays: RelayInfo[];
  lastUpdated: Record<string, number>;
  recentDiag: DiagEntry[];
}

function formatUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

function shortenUrl(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function readState(): DebugState {
  const ndk = getNDK();
  const relays = Array.from(ndk.pool?.relays?.values() ?? []).map((r) => ({
    url: r.url,
    connected: r.connected,
  }));
  return {
    uptimeMs: getNDKUptimeMs(),
    liveSubActive: isLiveSubActive(),
    relays,
    lastUpdated: useFeedStore.getState().lastUpdated,
    recentDiag: getRecentDiagEntries(5),
  };
}

export function DebugPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<DebugState>(readState);

  useEffect(() => {
    const id = setInterval(() => setState(readState()), 2000);
    return () => clearInterval(id);
  }, []);

  const connectedCount = state.relays.filter((r) => r.connected).length;

  return (
    <div className="fixed bottom-4 left-4 z-50 w-80 max-h-[calc(100%-2rem)] overflow-y-auto bg-bg-raised/95 backdrop-blur-sm border border-border shadow-xl text-caption font-mono rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-text-muted uppercase tracking-widest text-micro">Debug</span>
        <button onClick={onClose} aria-label="Close debug panel" className="text-text-dim hover:text-text transition-colors">×</button>
      </div>

      {/* Uptime + Live Sub */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-border/50">
        <span className="text-text-dim">
          NDK uptime: <span className="text-text">{state.uptimeMs !== null ? formatUptime(state.uptimeMs) : "—"}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${state.liveSubActive ? "bg-success" : "bg-danger"}`} />
          <span className="text-text-dim">live sub {state.liveSubActive ? "on" : "off"}</span>
        </span>
      </div>

      {/* Relays */}
      <div className="px-3 py-2 border-b border-border/50">
        <div className="text-text-dim mb-1">Relays ({connectedCount}/{state.relays.length})</div>
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {state.relays.map((r) => (
            <div key={r.url} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.connected ? "bg-success" : "bg-danger"}`} />
              <span className="text-text-dim truncate">{shortenUrl(r.url)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Feed Timestamps */}
      <div className="px-3 py-2 border-b border-border/50">
        <div className="text-text-dim mb-1">Last updated</div>
        <div className="grid grid-cols-3 gap-1">
          {(["global", "following", "trending"] as const).map((tab) => (
            <div key={tab}>
              <span className="text-text-dim">{tab}: </span>
              <span className="text-text">{state.lastUpdated[tab] ? timeAgo(state.lastUpdated[tab]) : "—"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Diagnostics */}
      <div className="px-3 py-2">
        <div className="text-text-dim mb-1">Recent log</div>
        {state.recentDiag.length === 0 ? (
          <span className="text-text-dim">No entries</span>
        ) : (
          <div className="space-y-0.5 max-h-28 overflow-y-auto">
            {state.recentDiag.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-caption">
                <span className="text-text-dim shrink-0">
                  {new Date(d.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className="text-text truncate">{d.action}</span>
                {d.durationMs !== undefined && (
                  <span className="text-text-dim shrink-0">{d.durationMs}ms</span>
                )}
                {d.eventsReturned !== undefined && (
                  <span className="text-text-dim shrink-0">{d.eventsReturned}ev</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
