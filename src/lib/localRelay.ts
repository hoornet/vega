import { invoke } from "@tauri-apps/api/core";
import { NDKEvent, NDKFilter, NDKKind, NDKRelay } from "@nostr-dev-kit/ndk";
import { getNDK, fetchWithTimeout, FEED_TIMEOUT } from "./nostr";
import { debug } from "./debug";

const STORAGE_KEY = "vega_local_relay_enabled";
const LAST_SYNC_KEY = "vega_local_relay_last_sync";
const LOCAL_RELAY_PREFIX = "ws://127.0.0.1:48";

export function isLocalRelayEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function setLocalRelayEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
}

export async function getRelayPort(): Promise<number | null> {
  try {
    return await invoke<number | null>("relay_get_port");
  } catch {
    return null;
  }
}

export interface RelayStats {
  event_count: number;
  db_size_bytes: number;
}

export async function getRelayStats(): Promise<RelayStats | null> {
  try {
    return await invoke<RelayStats>("relay_get_stats");
  } catch {
    return null;
  }
}

/**
 * Add the local relay to NDK's pool without persisting to the relay list.
 * Retries once after 500ms if port isn't available yet (race with server startup).
 */
export async function connectLocalRelay(): Promise<void> {
  let port = await getRelayPort();
  if (port === null) {
    await new Promise((r) => setTimeout(r, 500));
    port = await getRelayPort();
  }
  if (port === null) return;

  const url = `ws://127.0.0.1:${port}`;
  const instance = getNDK();

  if (instance.pool?.relays.has(url)) return;

  const relay = new NDKRelay(url, undefined, instance);
  instance.pool?.addRelay(relay, true);
  debug.log(`[Vega] Local relay connected: ${url}`);
}

/**
 * Remove any local relay (ws://127.0.0.1:48XX) from NDK's pool.
 * Does NOT touch the stored relay list.
 */
export function disconnectLocalRelay(): void {
  const instance = getNDK();
  if (!instance.pool?.relays) return;

  for (const [url, relay] of instance.pool.relays.entries()) {
    if (url.startsWith(LOCAL_RELAY_PREFIX)) {
      relay.disconnect();
      instance.pool.relays.delete(url);
      debug.log(`[Vega] Local relay disconnected: ${url}`);
    }
  }
}

// ── Catch-up sync ──────────────────────────────────────────────────────────

function getLastSyncTimestamp(): number | null {
  const stored = localStorage.getItem(LAST_SYNC_KEY);
  return stored ? parseInt(stored, 10) : null;
}

function setLastSyncTimestamp(ts: number): void {
  localStorage.setItem(LAST_SYNC_KEY, String(ts));
}

/**
 * Write events to the local relay via a direct WebSocket connection.
 * Bypasses NDK's publish to avoid overwhelming WebKit.
 * Sends NIP-01 EVENT messages one at a time sequentially.
 */
async function writeEventsToLocalRelay(events: NDKEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  const port = await getRelayPort();
  if (!port) return 0;

  const url = `ws://127.0.0.1:${port}`;

  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let written = 0;
    let idx = 0;

    const sendNext = () => {
      if (idx >= events.length) {
        ws.close();
        resolve(written);
        return;
      }
      const event = events[idx++];
      const raw = event.rawEvent();
      ws.send(JSON.stringify(["EVENT", raw]));
    };

    ws.onopen = () => sendNext();

    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        // ["OK", id, success, message]
        if (parsed[0] === "OK" && parsed[2]) {
          written++;
        }
      } catch { /* ignore */ }
      sendNext();
    };

    ws.onerror = () => resolve(written);
    ws.onclose = () => resolve(written);

    // Safety timeout — don't hang forever
    setTimeout(() => {
      ws.close();
      resolve(written);
    }, 30000);
  });
}

/**
 * Sync recent events from remote relays into the local relay.
 * Non-blocking — intended to run in background after connect.
 */
export async function syncToLocalRelay(
  userPubkey: string,
  followPubkeys: string[],
): Promise<void> {
  debug.log("[Vega] Starting local relay catch-up...");
  const syncStart = performance.now();
  const instance = getNDK();
  const now = Math.floor(Date.now() / 1000);
  const lastSync = getLastSyncTimestamp();

  // Determine time windows
  const feedSince = lastSync ?? (now - 24 * 3600); // 24h or since last sync
  const mentionsSince = lastSync ?? (now - 7 * 24 * 3600); // 7 days or since last sync

  const allEvents: NDKEvent[] = [];

  // 1. User's own notes (last 50, all-time for first sync)
  try {
    const filter: NDKFilter = { kinds: [NDKKind.Text], authors: [userPubkey], limit: 50 };
    const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
    allEvents.push(...Array.from(events));
  } catch { /* continue */ }

  // 2. User's profile (kind 0) and contact list (kind 3)
  try {
    const filter: NDKFilter = { kinds: [0 as NDKKind, 3 as NDKKind], authors: [userPubkey], limit: 2 };
    const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
    allEvents.push(...Array.from(events));
  } catch { /* continue */ }

  // 3. Follow feed (since last sync or 24h)
  if (followPubkeys.length > 0) {
    try {
      // Batch follows to avoid oversized filters
      const batchSize = 50;
      for (let i = 0; i < followPubkeys.length; i += batchSize) {
        const batch = followPubkeys.slice(i, i + batchSize);
        const filter: NDKFilter = {
          kinds: [NDKKind.Text],
          authors: batch,
          since: feedSince,
          limit: 100,
        };
        const events = await fetchWithTimeout(instance, filter, FEED_TIMEOUT);
        allEvents.push(...Array.from(events));
      }
    } catch { /* continue */ }
  }

  // 4. Mentions (since last sync or 7 days)
  try {
    const filter: NDKFilter = {
      kinds: [NDKKind.Text],
      "#p": [userPubkey],
      since: mentionsSince,
      limit: 100,
    };
    const events = await fetchWithTimeout(instance, filter, 12000);
    allEvents.push(...Array.from(events));
  } catch { /* continue */ }

  // Deduplicate by event ID
  const seen = new Set<string>();
  const unique = allEvents.filter((e) => {
    const id = e.id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Write to local relay
  const written = await writeEventsToLocalRelay(unique);
  setLastSyncTimestamp(now);

  const elapsed = Math.round(performance.now() - syncStart);
  debug.log(`[Vega] Synced ${written}/${unique.length} events to local relay (${elapsed}ms)`);
}
