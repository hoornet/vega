import { fetchMark, unansweredSince } from "./nostr/fetchTotals";

// Loading a list, and saying honestly how it ended.
//
// Before the October 2026 UI review most lists did `fetch().catch(() => [])`
// and then showed their "nothing here" message for whatever came back. A
// relay that never answered and a relay that answered "nothing" looked the
// same: "No notes found", "No bookmarked notes", "No results". To someone
// with a year of posts, that reads as data loss.
//
// A list is empty only when a relay said so.

export type ListLoad<T> =
  | { status: "loaded"; items: T[] }
  /** Nothing came back and no relay answered. The list may well not be empty. */
  | { status: "unreachable" }
  /** The fetch itself failed. */
  | { status: "error"; message: string };

/**
 * How a load ended, for a list that keeps its rows across refreshes (the
 * feed, notifications, bookmarks). "pending": nothing has been asked yet, so
 * nothing is known. "unreachable": nothing came back and no relay answered,
 * so whether there is anything is not known either.
 */
export type LoadOutcome = "pending" | "answered" | "unreachable" | "error";

export interface ListLoadOptions {
  /** Ask once more after this pause when the first answer is empty. Relays are often slow on the first ask. */
  retryEmptyAfterMs?: number;
  /** The view has moved on: stop early. */
  cancelled?: () => boolean;
}

export async function loadList<T>(fetch: () => Promise<T[]>, { retryEmptyAfterMs, cancelled }: ListLoadOptions = {}): Promise<ListLoad<T>> {
  const mark = fetchMark();
  try {
    let items = await fetch();
    if (items.length === 0 && retryEmptyAfterMs && !cancelled?.()) {
      await new Promise((resolve) => setTimeout(resolve, retryEmptyAfterMs));
      if (cancelled?.()) return { status: "loaded", items };
      items = await fetch();
    }
    if (items.length > 0) return { status: "loaded", items };
    // Empty. Is that the relays' answer, or did nobody answer?
    return wentUnanswered(mark) ? { status: "unreachable" } : { status: "loaded", items };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Whether an empty result since `mark` means "nobody answered" and not "there
 * is nothing". Only the totals are asked. The silent-pool streak is not: it
 * counts a fetch as unanswered when one relay of two answered "nothing" and
 * the other never did, so three such fetches made a list that a relay had
 * answered say it could not reach any.
 */
export const wentUnanswered = unansweredSince;

export { fetchMark };
