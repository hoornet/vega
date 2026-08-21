/**
 * Relay health checking — NIP-11 info, latency measurement, connection probe.
 */

export interface RelayNip11Info {
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
}

export interface RelayHealthResult {
  url: string;
  status: "online" | "slow" | "offline";
  latencyMs: number | null;
  nip11: RelayNip11Info | null;
  checkedAt: number;
  error?: string;
}

/**
 * Fetch NIP-11 relay information document.
 * Converts wss:// to https:// and requests with application/nostr+json.
 */
export async function fetchNip11(relayUrl: string): Promise<RelayNip11Info | null> {
  const httpUrl = relayUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  try {
    const resp = await fetch(httpUrl, {
      headers: { Accept: "application/nostr+json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * Measure WebSocket connection latency by opening a fresh connection,
 * sending a REQ for a single event, and timing how long until the first
 * EOSE or EVENT response. Falls back to just measuring connect time.
 */
/**
 * Is this frame a NIP-42 challenge rather than a reply to our query?
 *
 * Deliberately tolerant of a non-string payload and of malformed JSON: a health
 * check must never throw on whatever a relay happens to send.
 */
export function isAuthChallenge(data: unknown): boolean {
  if (typeof data !== "string") return false;
  try {
    const frame = JSON.parse(data);
    return Array.isArray(frame) && frame[0] === "AUTH";
  } catch {
    return false;
  }
}

export async function measureLatency(relayUrl: string): Promise<{ latencyMs: number; connected: boolean }> {
  return new Promise((resolve) => {
    const start = performance.now();
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve({ latencyMs: -1, connected: false });
    }, 8000);

    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl);
    } catch {
      clearTimeout(timeout);
      resolve({ latencyMs: -1, connected: false });
      return;
    }

    ws.onopen = () => {
      // Send a minimal REQ to measure round-trip
      const subId = "health_" + Math.random().toString(36).slice(2, 8);
      try {
        ws.send(JSON.stringify(["REQ", subId, { kinds: [0], limit: 1 }]));
      } catch {
        clearTimeout(timeout);
        const elapsed = Math.round(performance.now() - start);
        try { ws.close(); } catch { /* ignore */ }
        resolve({ latencyMs: elapsed, connected: true });
      }
    };

    ws.onmessage = (ev) => {
      // A relay with eager NIP-42 sends its AUTH challenge before answering
      // anything, so the first frame is not a response to our REQ. Timing
      // against it reported flattering latency for precisely the relays that
      // are hardest to use, and called a relay "online" on the strength of a
      // challenge alone. Keep waiting for a real reply. See #54.
      if (isAuthChallenge(ev.data)) return;

      clearTimeout(timeout);
      const elapsed = Math.round(performance.now() - start);
      try { ws.close(); } catch { /* ignore */ }
      resolve({ latencyMs: elapsed, connected: true });
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      try { ws.close(); } catch { /* ignore */ }
      resolve({ latencyMs: -1, connected: false });
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      resolve({ latencyMs: -1, connected: false });
    };
  });
}

/**
 * Full health check for a single relay: NIP-11 + latency probe.
 */
export async function checkRelayHealth(relayUrl: string): Promise<RelayHealthResult> {
  const [nip11, latency] = await Promise.all([
    fetchNip11(relayUrl),
    measureLatency(relayUrl),
  ]);

  let status: RelayHealthResult["status"];
  if (!latency.connected) {
    status = "offline";
  } else if (latency.latencyMs > 3000) {
    status = "slow";
  } else {
    status = "online";
  }

  return {
    url: relayUrl,
    status,
    latencyMs: latency.connected ? latency.latencyMs : null,
    nip11,
    checkedAt: Date.now(),
    error: !latency.connected ? "Connection failed" : undefined,
  };
}

/**
 * Check all relays in parallel.
 */
export async function checkAllRelays(relayUrls: string[]): Promise<RelayHealthResult[]> {
  return Promise.all(relayUrls.map(checkRelayHealth));
}
