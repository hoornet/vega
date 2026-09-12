/**
 * Podcast Index API credentials and request signing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS CREDENTIAL IS DELIBERATELY IN THE CLEAR. It is not a leak to fix.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Vega has no backend. Every Podcast Index call goes from the user's machine
 * straight to api.podcastindex.org, so the credential has to be present in the
 * shipped binary — there is nowhere else to put it. Moving it to a build-time
 * env var does NOT change that: Vite inlines the literal into the production
 * bundle, and `strings` on the installed app recovers it in seconds. It would
 * only silence secret scanners, while adding a way for a signed release to
 * ship with podcast search silently broken because the var was unset in CI.
 *
 * What it grants: read-only queries against a free, public podcast directory.
 * No user data, no keys, no money. The realistic worst case is someone abusing
 * it until Podcast Index rate-limits or bans the key, at which point podcast
 * search stops working for everyone until the next release ships a new one.
 *
 * Secret scanners (Aikido flagged this on 2026-09-12) will keep reporting it.
 * Accept the finding with this reasoning rather than suppressing it silently.
 *
 * Rotating: get a new key/secret from https://api.podcastindex.org and replace
 * the two values below — this module is the only place they appear. They were
 * previously copy-pasted into podcastIndex.ts and podcastIndexV4V.ts, which
 * meant rotating meant editing two files and missing one.
 *
 * Rotated 2026-09-12. The previous key had been in the git history since
 * 04180cf (2026-03-21) and in all 48 release tags and binaries up to v0.15.7
 * — roughly six months of being harvestable from a public repo. Rewriting
 * that history is not possible (the tags, the AUR, and every shipped binary
 * are already out), so rotation, not deletion from source, is what retires an
 * old key. Expect the old one to keep showing up in history scans forever.
 */

const API_KEY = "MELURNCMNCNQ2KNJUNB2";
const API_SECRET = "VmPdB36ZDh5RTV6#cRua5h8yXmG5ua9Pa7hqvsJh";

export const API_BASE = "https://api.podcastindex.org/api/1.0";

async function sha1(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Podcast Index authenticates each request with sha1(key + secret + unixTime),
 * where the same timestamp is sent as X-Auth-Date. Headers are per-request:
 * the server rejects a timestamp that has drifted too far from its own clock,
 * so these must not be cached across a session.
 */
export async function apiHeaders(): Promise<Record<string, string>> {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const hash = await sha1(API_KEY + API_SECRET + apiHeaderTime);
  return {
    "X-Auth-Key": API_KEY,
    "X-Auth-Date": apiHeaderTime,
    "Authorization": hash,
    "User-Agent": "Vega/1.0",
  };
}
