export function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}

export function shortenPubkey(pubkey: string): string {
  return pubkey.slice(0, 8) + "…" + pubkey.slice(-4);
}

/** Safely extract display name from a Nostr profile (handles non-string values from malformed profiles). */
export function profileName(profile: any, fallback: string): string {
  const raw = profile?.displayName || profile?.name;
  return (typeof raw === "string" ? raw : null) || fallback;
}

/**
 * Returns `url` only if it uses a safe http(s) scheme, otherwise "#".
 * Defense-in-depth for `href` sinks: blocks `javascript:`/`data:` URIs even if
 * a future change to the content parser stops scheme-constraining them upstream.
 */
export function safeHttpUrl(url: string): string {
  try {
    const scheme = new URL(url).protocol;
    return scheme === "http:" || scheme === "https:" ? url : "#";
  } catch {
    return "#";
  }
}

/**
 * Strips HTML tags, looping until the result is stable so split/nested tags
 * like `<scr<script>ipt>` cannot survive a single pass. Used to flatten
 * HTML-formatted text (e.g. podcast feed descriptions) into plain text.
 */
export function stripHtmlTags(input: string): string {
  let prev: string;
  let s = input;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, "");
  } while (s !== prev);
  return s;
}
