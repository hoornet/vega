const GLOBAL_KEY = "wrystr_interests";
const key = (pubkey: string) => `wrystr_interests_${pubkey}`;

function read(k: string): string[] | null {
  try {
    const raw = localStorage.getItem(k);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** Keep the topics picked on the interests step, for the account that picked them. */
export function saveInterests(pubkey: string | null, tags: string[]): void {
  try {
    localStorage.setItem(pubkey ? key(pubkey) : GLOBAL_KEY, JSON.stringify(tags));
  } catch { /* storage full: no chips */ }
}

/**
 * The topics this account picked. Before October 2026 there was one list for
 * the whole computer, so an account that never saw the interests step (made
 * from inside the app) was shown another account's topics. That list belongs
 * to the first account on the computer, which picked it at the first launch,
 * or to the only one: it is handed to that account once, and then it is gone,
 * so that removing the account does not hand it to the next.
 */
export function storedInterests(pubkey: string | null): string[] {
  if (pubkey) {
    const own = read(key(pubkey));
    if (own !== null) return own;
  }
  const old = read(GLOBAL_KEY);
  if (old === null) return [];
  let first: string | null = null;
  let count = 0;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem("wrystr_accounts") ?? "[]");
    if (Array.isArray(parsed)) {
      count = parsed.length;
      const head: unknown = parsed[0];
      if (head && typeof head === "object" && typeof (head as { pubkey?: unknown }).pubkey === "string") first = (head as { pubkey: string }).pubkey;
    }
  } catch { /* unreadable: nothing to hand over */ }
  if (pubkey && (count <= 1 || pubkey === first)) {
    saveInterests(pubkey, old);
    try { localStorage.removeItem(GLOBAL_KEY); } catch { /* then it is read once more */ }
    return old;
  }
  return pubkey === null && count <= 1 ? old : [];
}
