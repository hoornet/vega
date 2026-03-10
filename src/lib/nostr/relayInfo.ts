/** Per-session cache of relay NIP-50 support. */
const nip50Cache = new Map<string, boolean>();

/**
 * Fetch a relay's NIP-11 info and return whether it supports NIP-50 (full-text search).
 * Results are cached for the session. Times out after 4 s.
 */
export async function checkNip50Support(relayWssUrl: string): Promise<boolean> {
  if (nip50Cache.has(relayWssUrl)) return nip50Cache.get(relayWssUrl)!;

  const httpUrl = relayWssUrl.replace(/^wss?:\/\//, "https://");
  try {
    const resp = await fetch(httpUrl, {
      headers: { Accept: "application/nostr+json" },
      signal: AbortSignal.timeout(4000),
    });
    const info = await resp.json();
    const supported =
      Array.isArray(info.supported_nips) && (info.supported_nips as number[]).includes(50);
    nip50Cache.set(relayWssUrl, supported);
    return supported;
  } catch {
    nip50Cache.set(relayWssUrl, false);
    return false;
  }
}

/** Check all provided relay URLs in parallel; return those that support NIP-50. */
export async function getNip50Relays(relayUrls: string[]): Promise<string[]> {
  const results = await Promise.all(
    relayUrls.map(async (url) => ({ url, ok: await checkNip50Support(url) }))
  );
  return results.filter((r) => r.ok).map((r) => r.url);
}
