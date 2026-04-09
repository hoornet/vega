/**
 * Feed diagnostics logger.
 * Tracks every feed fetch with relay states, event freshness, timing.
 * Data stored in localStorage under "wrystr_feed_diag".
 * View in console: JSON.parse(localStorage.getItem("wrystr_feed_diag"))
 * Or open DevTools and call: window.__feedDiag()
 */

import { getNDK } from "./nostr/core";
import { debug } from "./debug";

const isDev = import.meta.env.DEV;

const DIAG_KEY = "wrystr_feed_diag";
const MAX_ENTRIES = 200;

export interface DiagEntry {
  ts: string;             // ISO timestamp
  action: string;         // "global_fetch" | "follow_fetch" | "refresh_click" | "relay_state" | etc.
  durationMs?: number;
  eventsReturned?: number;
  newestEventAge?: number;  // seconds since newest event was created
  oldestEventAge?: number;  // seconds since oldest event was created
  medianEventAge?: number;
  relayStates?: Record<string, { connected: boolean; status: number }>;
  error?: string;
  details?: string;
}

function getLog(): DiagEntry[] {
  try {
    return JSON.parse(localStorage.getItem(DIAG_KEY) || "[]");
  } catch {
    return [];
  }
}

export function getRecentDiagEntries(count = 5): DiagEntry[] {
  return getLog().slice(-count).reverse();
}

function saveLog(entries: DiagEntry[]) {
  localStorage.setItem(DIAG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
}

export function logDiag(entry: DiagEntry) {
  const log = getLog();
  log.push(entry);
  saveLog(log);

  // Also log to console with color coding
  const style = entry.error
    ? "color: #ff4444; font-weight: bold"
    : entry.newestEventAge && entry.newestEventAge > 300
      ? "color: #ffaa00; font-weight: bold"
      : "color: #44aa44";

  if (isDev) {
    console.log(
      `%c[FeedDiag] ${entry.action}`,
      style,
      entry.durationMs != null ? `${entry.durationMs}ms` : "",
      entry.eventsReturned != null ? `${entry.eventsReturned} events` : "",
      entry.newestEventAge != null ? `newest: ${formatAge(entry.newestEventAge)}` : "",
      entry.error || "",
      entry.details || "",
    );
  }
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function getRelayStates(): Record<string, { connected: boolean; status: number }> {
  const ndk = getNDK();
  const states: Record<string, { connected: boolean; status: number }> = {};
  for (const [url, relay] of ndk.pool?.relays?.entries() ?? []) {
    states[url] = {
      connected: relay.connected,
      status: (relay as unknown as { status: number }).status ?? -1,
    };
  }
  return states;
}

export function computeEventAges(events: { created_at?: number }[]): {
  newest: number;
  oldest: number;
  median: number;
} | null {
  const now = Math.floor(Date.now() / 1000);
  const ages = events
    .map((e) => (e.created_at ? now - e.created_at : null))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);

  if (ages.length === 0) return null;
  return {
    newest: ages[0],
    oldest: ages[ages.length - 1],
    median: ages[Math.floor(ages.length / 2)],
  };
}

/**
 * Periodic relay health snapshot — logs relay states every 60s.
 */
let snapshotInterval: ReturnType<typeof setInterval> | null = null;

export function startRelaySnapshots() {
  if (snapshotInterval) return;
  snapshotInterval = setInterval(() => {
    const states = getRelayStates();
    const connectedCount = Object.values(states).filter((s) => s.connected).length;
    const totalCount = Object.keys(states).length;

    // Only log if something interesting (not all connected)
    if (connectedCount < totalCount || totalCount === 0) {
      logDiag({
        ts: new Date().toISOString(),
        action: "relay_snapshot",
        relayStates: states,
        details: `${connectedCount}/${totalCount} connected`,
      });
    }
  }, 60_000);
}

/**
 * Wrap a fetch function with diagnostics.
 */
export async function diagWrapFetch<T extends { created_at?: number }[]>(
  action: string,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  const relaysBefore = getRelayStates();

  try {
    const result = await fetchFn();
    const durationMs = Math.round(performance.now() - start);
    const ages = computeEventAges(result);

    logDiag({
      ts: new Date().toISOString(),
      action,
      durationMs,
      eventsReturned: result.length,
      newestEventAge: ages?.newest,
      oldestEventAge: ages?.oldest,
      medianEventAge: ages?.median,
      relayStates: relaysBefore,
    });

    // Warn if results seem stale
    if (ages && ages.newest > 600) {
      logDiag({
        ts: new Date().toISOString(),
        action: `${action}_STALE_WARNING`,
        details: `Newest event is ${formatAge(ages.newest)} old! Median: ${formatAge(ages.median)}. This suggests relays returned cached/old data.`,
        relayStates: relaysBefore,
      });
    }

    // Warn if zero results
    if (result.length === 0) {
      logDiag({
        ts: new Date().toISOString(),
        action: `${action}_EMPTY_WARNING`,
        details: "Zero events returned from relays",
        relayStates: relaysBefore,
      });
    }

    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    logDiag({
      ts: new Date().toISOString(),
      action,
      durationMs,
      error: String(err),
      relayStates: relaysBefore,
    });
    throw err;
  }
}

// Expose diagnostics globally for easy console access
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__feedDiag = () => {
    const log = getLog();
    console.table(log.map((e) => ({
      time: e.ts.slice(11, 19),
      action: e.action,
      ms: e.durationMs,
      events: e.eventsReturned,
      newestAge: e.newestEventAge != null ? formatAge(e.newestEventAge) : "",
      error: e.error || "",
      details: e.details || "",
    })));
    return log;
  };

  (window as unknown as Record<string, unknown>).__feedDiagRelays = () => {
    const states = getRelayStates();
    console.table(states);
    return states;
  };

  (window as unknown as Record<string, unknown>).__feedDiagClear = () => {
    localStorage.removeItem(DIAG_KEY);
    debug.log("Feed diagnostics cleared");
  };
}
