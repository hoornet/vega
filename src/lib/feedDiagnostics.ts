/**
 * Feed diagnostics logger.
 * Tracks every feed fetch with relay states, event freshness, timing.
 *
 * Recent entries live in memory only (read by the Ctrl+Shift+D panel and
 * `window.__feedDiag()`). They used to be mirrored into localStorage on every
 * single call; because the mirror was a ~166 KB JSON blob, each append rewrote
 * the whole value and the WebKit localStorage WAL grew to 868 MB against a
 * 240 KB database. In-memory costs nothing and the disk log below supersedes it.
 *
 * File log: ~/vega-diag.log — **opt-in, off by default**. It writes twice a
 * second with no natural end, so leaving it on unconditionally left a 217 MB /
 * 2M-line file in every user's home directory (99.3% of it `heapMb:-1`, because
 * WebKitGTK does not implement `performance.memory`). It is genuinely useful for
 * diagnosing a hang, so it stays available — behind a switch, and capped.
 *
 * Enable: Settings → Advanced → "Write diagnostics log", or
 *   localStorage.setItem("vega_diag_log_enabled", "true")
 * Inspect: tail -100 ~/vega-diag.log | python3 -c "import sys,json;[print(json.dumps(json.loads(l),indent=2)) for l in sys.stdin]"
 */

import { writeTextFile, stat, rename, remove, exists, open } from "@tauri-apps/plugin-fs";
import { homeDir } from "@tauri-apps/api/path";
import { getNDK, getActiveFetchCount } from "./nostr/core";
import { debug } from "./debug";

const isDev = import.meta.env.DEV;

/** Legacy localStorage mirror. Only ever removed now — never written. */
const LEGACY_DIAG_KEY = "wrystr_feed_diag";
const DIAG_ENABLED_KEY = "vega_diag_log_enabled";
const LEGACY_CLEANUP_KEY = "vega_diag_legacy_cleanup";
const MAX_ENTRIES = 200;

/** Hard ceiling for ~/vega-diag.log. Rotated to .1 once exceeded, so the
 *  on-disk worst case is 2x this and can never run away again. */
const MAX_DIAG_LOG_BYTES = 5 * 1024 * 1024;

/** Recent entries, in memory only — see the note at the top of this file. */
let recentEntries: DiagEntry[] = [];

export function isDiagLogEnabled(): boolean {
  try {
    return localStorage.getItem(DIAG_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setDiagLogEnabled(enabled: boolean): void {
  localStorage.setItem(DIAG_ENABLED_KEY, enabled ? "true" : "false");
  if (enabled) startDiagFileFlusher();
  else stopDiagFileFlusher();
}

// ─── Disk-based diagnostic log ────────────────────────────────────────────────
// Writes JSON-lines to ~/vega-diag.log every 2s.
// Survives WebKit crashes and hard reboots — inspect after hang:
//   tail -100 ~/vega-diag.log | python3 -c "import sys,json;[print(json.dumps(json.loads(l),indent=2)) for l in sys.stdin if l.strip()]"

const diagFileBuffer: string[] = [];
let diagFlushTimer: ReturnType<typeof setInterval> | null = null;
let diagLogPath: string | null = null;

export async function getDiagLogPath(): Promise<string> {
  if (!diagLogPath) {
    try {
      diagLogPath = (await homeDir()) + "/vega-diag.log";
    } catch {
      diagLogPath = "/tmp/vega-diag.log";
    }
  }
  return diagLogPath;
}

/** Rotate to <path>.1 once the log passes the cap, so it cannot grow without end. */
async function rotateIfOversized(path: string): Promise<void> {
  try {
    const info = await stat(path);
    if (info.size < MAX_DIAG_LOG_BYTES) return;
    await rename(path, `${path}.1`).catch(async () => {
      // A stale .1 from a previous rotation blocks the rename on some platforms.
      await remove(`${path}.1`).catch(() => {});
      await rename(path, `${path}.1`);
    });
  } catch { /* no file yet, or stat unsupported — nothing to rotate */ }
}

async function flushDiagBuffer() {
  if (diagFileBuffer.length === 0) return;
  const lines = diagFileBuffer.splice(0);
  try {
    const path = await getDiagLogPath();
    await rotateIfOversized(path);
    await writeTextFile(path, lines.join("\n") + "\n", { append: true });
  } catch { /* never crash the app on diag write failure */ }
}

/**
 * Start periodic disk flushing and memory snapshots.
 * Call once at app startup. Data written to ~/vega-diag.log every 2s.
 */
export function startDiagFileFlusher() {
  if (diagFlushTimer) return;
  // Opt-in. Twice a second forever is fine for a debugging session and not fine
  // as a default — that is how ~/vega-diag.log reached 217 MB. See file header.
  if (!isDiagLogEnabled()) return;

  // Write a session-start marker
  const marker = { ts: Date.now(), t: "session_start", v: "vega-diag-v1" };
  diagFileBuffer.push(JSON.stringify(marker));

  // Flush immediately so data hits disk before any crash
  flushDiagBuffer();

  diagFlushTimer = setInterval(async () => {
    // Memory snapshot
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const ndk = getNDK();
    const relayCount = ndk.pool?.relays?.size ?? 0;
    const connectedRelays = Array.from(ndk.pool?.relays?.values() ?? []).filter((r) => r.connected).length;

    diagFileBuffer.push(JSON.stringify({
      ts: Date.now(),
      t: "mem",
      heapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : -1,
      heapTotalMb: mem ? Math.round(mem.totalJSHeapSize / 1048576) : -1,
      heapLimitMb: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : -1,
      activeFetches: getActiveFetchCount(),
      relays: `${connectedRelays}/${relayCount}`,
    }));

    await flushDiagBuffer();
  }, 500); // 500ms — fast enough to capture pre-crash state
}

export function stopDiagFileFlusher(): void {
  if (!diagFlushTimer) return;
  clearInterval(diagFlushTimer);
  diagFlushTimer = null;
  flushDiagBuffer();
}

/** First `n` bytes of a file, as text. Never loads more than that. */
async function readHead(path: string, n: number): Promise<string> {
  const handle = await open(path, { read: true });
  try {
    const buf = new Uint8Array(n);
    const got = await handle.read(buf);
    return new TextDecoder().decode(buf.subarray(0, got ?? 0));
  } finally {
    await handle.close();
  }
}

/**
 * One-time removal of the runaway log written by v0.13.0-v0.15.3, where the
 * flusher ran unconditionally at 2 Hz with no cap. Measured at 217 MB / 2.02M
 * lines on the dev machine, 99.3% of it `heapMb:-1`.
 *
 * Deliberately narrow, because deleting from someone's home directory is not
 * something to do on a guess:
 *  - only the exact path we wrote, never a pattern or a directory
 *  - only if the first line is our own `vega-diag-v1` session marker, so a
 *    user's unrelated file that happens to share the name is left alone
 *  - skipped entirely if the user has the log switched on
 *  - runs once, then records that it ran
 */
export async function cleanupLegacyDiagLog(): Promise<void> {
  if (localStorage.getItem(LEGACY_CLEANUP_KEY) === "done") return;
  // Never delete a log the user is actively collecting.
  if (isDiagLogEnabled()) {
    localStorage.setItem(LEGACY_CLEANUP_KEY, "done");
    return;
  }
  try {
    const path = await getDiagLogPath();
    if (!(await exists(path))) {
      localStorage.setItem(LEGACY_CLEANUP_KEY, "done");
      return;
    }
    // Read only the first bytes. `readTextFile` would pull the whole file into
    // the JS heap, and the whole point is that this file reached 226 MB — doing
    // that at startup under WebKitGTK is how you turn a disk problem into the
    // OOM crash of v0.12.x all over again.
    const head = await readHead(path, 256);
    if (!head.includes("vega-diag-v1")) {
      debug.warn(`[diag] ${path} is not ours (no vega-diag-v1 marker) — leaving it alone`);
      localStorage.setItem(LEGACY_CLEANUP_KEY, "done");
      return;
    }
    await remove(path);
    await remove(`${path}.1`).catch(() => {});
    debug.log(`[diag] removed legacy diagnostics log at ${path}`);
    localStorage.setItem(LEGACY_CLEANUP_KEY, "done");
  } catch (err) {
    // Not worth retrying forever, but don't mark done — a transient failure
    // should get another chance on the next launch.
    debug.warn("[diag] legacy log cleanup failed:", err);
  }
}

/** The localStorage mirror is gone; drop whatever the old build left behind. */
export function cleanupLegacyDiagMirror(): void {
  try {
    localStorage.removeItem(LEGACY_DIAG_KEY);
  } catch { /* nothing we can do, and nothing worth crashing over */ }
}

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
  return recentEntries;
}

export function getRecentDiagEntries(count = 5): DiagEntry[] {
  return getLog().slice(-count).reverse();
}

export function logDiag(entry: DiagEntry) {
  recentEntries.push(entry);
  if (recentEntries.length > MAX_ENTRIES) {
    recentEntries = recentEntries.slice(-MAX_ENTRIES);
  }

  // Buffer to the disk log only when the user asked for one; otherwise this
  // array would grow for the whole session with nothing ever draining it.
  if (diagFlushTimer) {
    diagFileBuffer.push(JSON.stringify({ ...entry, _ms: Date.now() }));
  }

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
    recentEntries = [];
    debug.log("Feed diagnostics cleared");
  };
}
