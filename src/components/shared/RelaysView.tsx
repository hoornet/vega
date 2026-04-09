import { useEffect, useState } from "react";
import { getNDK, getStoredRelayUrls, addRelay, removeRelay, publishRelayList, fetchRelayRecommendations, normalizeRelayUrl } from "../../lib/nostr";
import { useRelayHealthStore } from "../../stores/relayHealth";
import { useUserStore } from "../../stores/user";
import type { RelayHealthResult } from "../../lib/nostr/relayHealth";

function statusColor(status: RelayHealthResult["status"]): string {
  switch (status) {
    case "online": return "bg-success";
    case "slow": return "bg-warning";
    case "offline": return "bg-danger";
  }
}

function statusLabel(status: RelayHealthResult["status"]): string {
  switch (status) {
    case "online": return "online";
    case "slow": return "slow";
    case "offline": return "offline";
  }
}

function formatLatency(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function NipBadges({ nips }: { nips: number[] }) {
  if (nips.length === 0) return null;
  const sorted = [...nips].sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {sorted.map((n) => (
        <span key={n} className="px-1 py-0 text-[9px] border border-border text-text-dim rounded-sm">
          NIP-{String(n).padStart(2, "0")}
        </span>
      ))}
    </div>
  );
}

function RelayHealthCard({ result, poolConnected, onRemove }: { result: RelayHealthResult; poolConnected: boolean; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const nip11 = result.nip11;

  return (
    <div className="border border-border group/card">
      <div
        className="flex items-center gap-3 px-3 py-2 text-[12px] cursor-pointer hover:bg-bg-hover transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${statusColor(result.status)}`}
          title={result.status === "online" ? "Online" : result.status === "slow" ? `Slow (${formatLatency(result.latencyMs)})` : "Offline — connection failed"}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span title={result.url} className="text-text truncate font-mono">{result.url}</span>
            {nip11?.name && (
              <span className="text-text-dim text-[10px] truncate">({nip11.name})</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {result.latencyMs !== null && (
            <span className={`text-[10px] font-mono ${result.latencyMs > 2000 ? "text-warning" : "text-text-dim"}`}>
              {formatLatency(result.latencyMs)}
            </span>
          )}
          <span className={`text-[10px] ${result.status === "offline" ? "text-danger" : "text-text-dim"}`}>
            {statusLabel(result.status)}
          </span>
          {poolConnected && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" title="NDK connected" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-text-dim hover:text-danger text-[10px] opacity-0 group-hover/card:opacity-100 transition-opacity"
          >
            remove
          </button>
          <span className={`text-text-dim text-[10px] transition-transform ${expanded ? "rotate-90" : "rotate-0"}`}>▶</span>
        </div>
      </div>

      {expanded && (
        <div className="px-3 py-2 border-t border-border bg-bg-raised text-[11px] space-y-1.5">
          {nip11 ? (
            <>
              {nip11.description && (
                <p className="text-text-muted">{nip11.description}</p>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                {nip11.software && (
                  <div>
                    <span className="text-text-dim">Software: </span>
                    <span className="text-text">{nip11.software}{nip11.version ? ` ${nip11.version}` : ""}</span>
                  </div>
                )}
                {nip11.contact && (
                  <div>
                    <span className="text-text-dim">Contact: </span>
                    <span className="text-text">{nip11.contact}</span>
                  </div>
                )}
                {nip11.pubkey && (
                  <div className="col-span-2">
                    <span className="text-text-dim">Pubkey: </span>
                    <span className="text-text font-mono">{nip11.pubkey.slice(0, 16)}…</span>
                  </div>
                )}
              </div>
              {nip11.supported_nips && nip11.supported_nips.length > 0 && (
                <div>
                  <NipBadges nips={nip11.supported_nips} />
                </div>
              )}
            </>
          ) : (
            <p className="text-text-dim">No NIP-11 info available{result.error ? ` — ${result.error}` : ""}</p>
          )}
          <div className="text-text-dim text-[9px]">
            Checked {new Date(result.checkedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

/** Fallback row for relays not yet health-checked */
function RelayPoolRow({ url, connected, onRemove }: { url: string; connected: boolean; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border border-border text-[12px] group">
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${connected ? "bg-success" : "bg-text-dim"}`}
        title={connected ? "Connected" : "Not connected — awaiting health check"}
      />
      <span className="text-text truncate flex-1 font-mono">{url}</span>
      <span className="text-text-dim text-[10px]">{connected ? "connected" : "—"}</span>
      <button
        onClick={onRemove}
        className="text-text-dim hover:text-danger text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      >
        remove
      </button>
    </div>
  );
}

export function RelaysView() {
  const { results, checking, lastChecked, checkAll } = useRelayHealthStore();
  const { loggedIn } = useUserStore();
  const ndk = getNDK();
  const poolRelays = Array.from(ndk.pool?.relays?.values() ?? []);
  const poolConnectedUrls = new Set(poolRelays.filter((r) => r.connected).map((r) => normalizeRelayUrl(r.url)));

  const [input, setInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [republishing, setRepublishing] = useState(false);

  // Auto-check on first mount if no results yet
  useEffect(() => {
    if (results.length === 0 && !checking) {
      checkAll();
    }
  }, []);

  const onlineCount = results.filter((r) => r.status === "online").length;
  const slowCount = results.filter((r) => r.status === "slow").length;
  const offlineCount = results.filter((r) => r.status === "offline").length;
  const deadRelays = results.filter((r) => r.status === "offline");

  const handleAddRelay = () => {
    const url = input.trim();
    if (!url) return;
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      setAddError("URL must start with ws:// or wss://");
      return;
    }
    if (getStoredRelayUrls().includes(normalizeRelayUrl(url))) {
      setAddError("Already in list");
      return;
    }
    addRelay(url);
    setInput("");
    setAddError(null);
    checkAll();
  };

  const handleRemoveRelay = (url: string) => {
    removeRelay(url);
    checkAll();
  };

  const handleRemoveDead = async () => {
    setRemoving(true);
    for (const r of deadRelays) {
      removeRelay(r.url);
    }
    await checkAll();
    setRemoving(false);
  };

  const handleRepublish = async () => {
    setRepublishing(true);
    try {
      await publishRelayList(getStoredRelayUrls());
    } catch { /* ignore */ }
    setRepublishing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddRelay();
    if (e.key === "Escape") setInput("");
  };

  // Merge: show health results first, then any pool relays not yet checked
  const checkedUrls = new Set(results.map((r) => normalizeRelayUrl(r.url)));
  const uncheckedPoolRelays = poolRelays.filter((r) => !checkedUrls.has(normalizeRelayUrl(r.url)));

  // Sort: online first, then slow, then offline
  const sortedResults = [...results].sort((a, b) => {
    const order = { online: 0, slow: 1, offline: 2 };
    return order[a.status] - order[b.status];
  });

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-4 py-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-text text-sm font-medium tracking-wide">Relays</h1>
            {results.length > 0 && (
              <div className="flex items-center gap-2 text-[10px]">
                {onlineCount > 0 && <span className="text-success">{onlineCount} online</span>}
                {slowCount > 0 && <span className="text-warning">{slowCount} slow</span>}
                {offlineCount > 0 && <span className="text-danger">{offlineCount} offline</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lastChecked && (
              <span className="text-text-dim text-[9px]">
                {new Date(lastChecked).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={checkAll}
              disabled={checking}
              className="px-3 py-1 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-40"
            >
              {checking ? (
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
                  checking…
                </span>
              ) : "check all"}
            </button>
          </div>
        </div>
      </header>

      {/* Add relay input */}
      <div className="border-b border-border px-4 py-2 shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); setAddError(null); }}
            onKeyDown={handleKeyDown}
            placeholder="wss://relay.example.com"
            className="flex-1 bg-bg border border-border px-3 py-1.5 text-text text-[12px] font-mono focus:outline-none focus:border-accent/50 placeholder:text-text-dim"
          />
          <button
            onClick={handleAddRelay}
            className="px-3 py-1.5 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors shrink-0"
          >
            Add
          </button>
          {loggedIn && !!getNDK().signer && (
            <button
              onClick={handleRepublish}
              disabled={republishing}
              className="px-3 py-1.5 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-40 shrink-0"
            >
              {republishing ? "Publishing…" : "Publish list"}
            </button>
          )}
        </div>
        {addError && <p className="text-danger text-[11px] mt-1">{addError}</p>}
      </div>

      {/* Actions bar — show when there are dead relays */}
      {deadRelays.length > 0 && (
        <div className="border-b border-border px-4 py-2 bg-danger/5 flex items-center justify-between shrink-0">
          <span className="text-danger text-[11px]">
            {deadRelays.length} relay{deadRelays.length > 1 ? "s" : ""} offline
          </span>
          <button
            onClick={handleRemoveDead}
            disabled={removing}
            className="px-3 py-1 text-[11px] border border-danger/30 text-danger hover:bg-danger/10 transition-colors disabled:opacity-40"
          >
            {removing ? "Removing…" : "Remove dead"}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {results.length === 0 && !checking && poolRelays.length === 0 && (
          <p className="text-text-dim text-[12px]">No relays configured.</p>
        )}

        <div className="space-y-1">
          {sortedResults.map((result) => (
            <RelayHealthCard
              key={result.url}
              result={result}
              poolConnected={poolConnectedUrls.has(result.url)}
              onRemove={() => handleRemoveRelay(result.url)}
            />
          ))}

          {uncheckedPoolRelays.map((relay) => (
            <RelayPoolRow
              key={relay.url}
              url={relay.url}
              connected={relay.connected}
              onRemove={() => handleRemoveRelay(relay.url)}
            />
          ))}
        </div>

        {checking && results.length === 0 && (
          <div className="flex items-center gap-2 text-text-dim text-[12px] py-8 justify-center">
            <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Checking relay health…
          </div>
        )}

        {/* Suggested Relays */}
        {loggedIn && <SuggestedRelays />}
      </div>
    </div>
  );
}

function SuggestedRelays() {
  const { follows } = useUserStore();
  const [suggestions, setSuggestions] = useState<{ url: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleDiscover = async () => {
    setLoading(true);
    try {
      const results = await fetchRelayRecommendations(follows, getStoredRelayUrls());
      setSuggestions(results);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = (url: string) => {
    addRelay(url);
    setSuggestions((prev) => prev.filter((s) => s.url !== url));
  };

  return (
    <div className="mt-6 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-text text-[11px] font-medium uppercase tracking-widest text-text-dim">Suggested Relays</h3>
          <p className="text-text-dim text-[10px] mt-0.5">Based on relays your follows use</p>
        </div>
        <button
          onClick={handleDiscover}
          disabled={loading || follows.length === 0}
          className="px-3 py-1 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
              Discovering…
            </span>
          ) : "Discover relays"}
        </button>
      </div>

      {loaded && suggestions.length === 0 && (
        <p className="text-text-dim text-[11px]">No new relay suggestions found.</p>
      )}

      <div className="space-y-1">
        {suggestions.map((s) => (
          <div key={s.url} className="flex items-center gap-3 px-3 py-2 border border-border text-[12px] group">
            <span className="text-text truncate flex-1 font-mono">{s.url}</span>
            <span className="text-text-dim text-[10px] shrink-0">
              {s.count} follow{s.count !== 1 ? "s" : ""}
            </span>
            <button
              onClick={() => handleAdd(s.url)}
              className="text-accent hover:text-accent-hover text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            >
              add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
