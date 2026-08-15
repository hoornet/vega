import { useState, useEffect } from "react";
import { getNDK, getStoredRelayUrls, normalizeRelayUrl } from "../lib/nostr";

/**
 * Where a relay in the pool came from. The pool is not the user's relay list:
 * NDK adds relays through three separate mechanisms, and only one of them is
 * the configured list (see the outbox section in CLAUDE.md).
 *
 * - `configured`  — in the user's stored relay list. The promise we make them.
 * - `local`       — the embedded strfry relay, deliberately never in the list.
 * - `discovered`  — reached us via NIP-65: either a follow's write relays
 *                   (outbox) or the user's own *published* relay list, which
 *                   NDK auto-connects to via `autoConnectUserRelays`.
 *
 * Counting all three together is how the badge came to read "6/6 relays" for a
 * user whose configured list held three — the one indicator that should answer
 * "is Relay reach actually confining me to my own relays?" could not answer it.
 */
export type RelayOrigin = "configured" | "local" | "discovered";

interface RelayInfo {
  url: string;
  connected: boolean;
  origin: RelayOrigin;
}

interface RelayStatus {
  /** Connected count among configured relays only — the headline number. */
  connectedCount: number;
  /** Configured relays only. */
  totalCount: number;
  /** Relays in the pool that the user did not configure (excludes the embedded one). */
  discoveredCount: number;
  relays: RelayInfo[];
}

export function classifyRelay(url: string, configured: Set<string>): RelayOrigin {
  const normalized = normalizeRelayUrl(url);
  if (/^ws:\/\/(127\.0\.0\.1|localhost):/.test(normalized)) return "local";
  return configured.has(normalized) ? "configured" : "discovered";
}

/** Pure derivation, split out from the pool read so it can be tested directly. */
export function summarizeRelays(
  pool: { url: string; connected: boolean }[],
  configuredUrls: string[],
): RelayStatus {
  const configured = new Set(configuredUrls.map(normalizeRelayUrl));

  const relays: RelayInfo[] = pool.map((r) => ({
    url: r.url,
    connected: r.connected,
    origin: classifyRelay(r.url, configured),
  }));

  const mine = relays.filter((r) => r.origin === "configured");

  return {
    connectedCount: mine.filter((r) => r.connected).length,
    // Take the stored list as the total so a configured relay that has not made
    // it into the pool yet reads as "mine, not connected" rather than vanishing
    // — a missing relay must not quietly improve the ratio.
    totalCount: Math.max(mine.length, configured.size),
    discoveredCount: relays.filter((r) => r.origin === "discovered").length,
    relays,
  };
}

function readPool(): RelayStatus {
  const ndk = getNDK();
  return summarizeRelays(
    Array.from(ndk.pool?.relays?.values() ?? []).map((r) => ({
      url: r.url,
      connected: r.connected,
    })),
    getStoredRelayUrls(),
  );
}

export function useRelayStatus(): RelayStatus {
  const [status, setStatus] = useState<RelayStatus>(readPool);

  useEffect(() => {
    const id = setInterval(() => setStatus(readPool()), 5000);
    return () => clearInterval(id);
  }, []);

  return status;
}
