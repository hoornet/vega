import NDK, { NDKEvent, NDKFilter, NDKRelay, NDKRelaySet, NDKSubscriptionCacheUsage } from "@nostr-dev-kit/ndk";

// ─── Fetch timeout helper ───────────────────────────────────────────

/** Race a promise against a timeout. Returns fallback on timeout. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => {
      console.warn(`[Vega] Fetch timed out after ${ms}ms`);
      resolve(fallback);
    }, ms)),
  ]);
}

export const FEED_TIMEOUT = 8000;    // 8s for feed fetches
export const THREAD_TIMEOUT = 5000;  // 5s per thread round-trip
export const SINGLE_TIMEOUT = 5000;  // 5s for single event lookups

const EMPTY_SET = new Set<NDKEvent>();

/** Fetch events with a timeout — returns empty set if relay hangs. */
export async function fetchWithTimeout(
  instance: NDK,
  filter: NDKFilter,
  timeoutMs: number,
  relaySet?: NDKRelaySet,
): Promise<Set<NDKEvent>> {
  const opts = {
    cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
    groupable: false,  // Prevent NDK from batching/reusing subscriptions
  };
  const promise = relaySet
    ? instance.fetchEvents(filter, opts, relaySet)
    : instance.fetchEvents(filter, opts);
  return withTimeout(promise, timeoutMs, EMPTY_SET);
}

export const RELAY_STORAGE_KEY = "wrystr_relays";

export const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
];

// Override NDK's default outbox relays (purplepag.es can have DNS issues)
export const OUTBOX_RELAYS = [
  "wss://relay.damus.io/",
  "wss://nos.lol/",
  "wss://relay.nostr.band/",
];

/** Normalize relay URL: lowercase host, strip trailing slash, deduplicate. */
export function normalizeRelayUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getStoredRelayUrls(): string[] {
  try {
    const stored = localStorage.getItem(RELAY_STORAGE_KEY);
    if (stored) {
      // Deduplicate on load (handles legacy duplicates from trailing-slash mismatch)
      const urls: string[] = JSON.parse(stored);
      const seen = new Set<string>();
      return urls.map(normalizeRelayUrl).filter((u) => {
        if (seen.has(u)) return false;
        seen.add(u);
        return true;
      });
    }
  } catch { /* ignore */ }
  return FALLBACK_RELAYS;
}

export function saveRelayUrls(urls: string[]) {
  localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify(urls.map(normalizeRelayUrl)));
}

let ndk: NDK | null = null;
let ndkCreatedAt: number | null = null;

export function getNDK(): NDK {
  if (!ndk) {
    ndk = new NDK({
      explicitRelayUrls: getStoredRelayUrls(),
      outboxRelayUrls: OUTBOX_RELAYS,
    });
    ndkCreatedAt = Date.now();
  }
  return ndk;
}

export function getNDKUptimeMs(): number | null {
  return ndkCreatedAt ? Date.now() - ndkCreatedAt : null;
}

/**
 * Destroy the current NDK instance and create a fresh one.
 * Preserves the signer (login state) but resets all relay connections.
 * Use as a last resort when relay connections are unrecoverable.
 */
export async function resetNDK(): Promise<void> {
  const oldInstance = ndk;
  const oldSigner = oldInstance?.signer ?? null;

  // Disconnect all relays on old instance
  if (oldInstance?.pool?.relays) {
    for (const relay of oldInstance.pool.relays.values()) {
      try { relay.disconnect(); } catch { /* ignore */ }
    }
  }

  // Create fresh instance
  ndk = new NDK({
    explicitRelayUrls: getStoredRelayUrls(),
    outboxRelayUrls: OUTBOX_RELAYS,
  });
  ndkCreatedAt = Date.now();

  // Restore signer so user stays logged in
  if (oldSigner) {
    ndk.signer = oldSigner;
  }

  // Connect fresh
  console.log("[Vega] NDK instance reset — connecting fresh relays");
  await ndk.connect();
  await waitForConnectedRelay(ndk, 5000);
  const relays = Array.from(ndk.pool?.relays?.values() ?? []);
  const connected = relays.filter((r) => r.connected).length;
  console.log(`[Vega] Fresh connection: ${connected}/${relays.length} relays connected`);
}

export function addRelay(url: string): void {
  const normalized = normalizeRelayUrl(url);
  const instance = getNDK();
  const urls = getStoredRelayUrls();
  if (!urls.includes(normalized)) {
    saveRelayUrls([...urls, normalized]);
  }
  // Check both with and without trailing slash since NDK may use either
  if (!instance.pool?.relays.has(normalized) && !instance.pool?.relays.has(normalized + "/")) {
    const relay = new NDKRelay(normalized, undefined, instance);
    instance.pool?.addRelay(relay, true);
  }
}

export function removeRelay(url: string): void {
  const instance = getNDK();
  // NDK may store URLs with or without trailing slash — check both
  const variants = [url, url.replace(/\/$/, ""), url.replace(/\/?$/, "/")];
  for (const v of variants) {
    const relay = instance.pool?.relays.get(v);
    if (relay) {
      relay.disconnect();
      instance.pool?.relays.delete(v);
    }
  }
  saveRelayUrls(getStoredRelayUrls().filter((u) => u !== url));
}

function waitForConnectedRelay(instance: NDK, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, _reject) => {
    const timer = setTimeout(() => {
      // Even on timeout, continue — some relays may connect later
      console.warn("Relay connection timeout, continuing anyway");
      resolve();
    }, timeoutMs);

    const check = () => {
      const relays = Array.from(instance.pool?.relays?.values() ?? []);
      const hasConnected = relays.some((r) => r.connected);
      if (hasConnected) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  });
}

export async function connectToRelays(): Promise<void> {
  const instance = getNDK();
  await instance.connect();
  await waitForConnectedRelay(instance);
}

/**
 * Ensure at least one relay is connected.
 * If relays report connected, trust them and return immediately.
 * Only reconnect if zero relays are connected — never force-disconnect working connections.
 */
export async function ensureConnected(): Promise<boolean> {
  const instance = getNDK();
  const relays = Array.from(instance.pool?.relays?.values() ?? []);
  const connectedCount = relays.filter((r) => r.connected).length;

  if (connectedCount > 0) {
    return true; // Trust relay.connected — don't probe or disconnect
  }

  console.warn(`[Vega] No relays connected (${relays.length} in pool) — attempting reconnect`);

  try {
    await withTimeout(instance.connect(), 4000, undefined);
    await waitForConnectedRelay(instance, 3000);
    const after = Array.from(instance.pool?.relays?.values() ?? []);
    const nowConnected = after.some((r) => r.connected);
    console.log(`[Vega] Reconnect ${nowConnected ? "succeeded" : "failed"}`);
    return nowConnected;
  } catch {
    console.error("[Vega] Reconnect failed");
    return false;
  }
}
