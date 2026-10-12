// Running totals of fetches the network answered and fetches it did not.
//
// A list takes a mark before it loads and asks afterwards whether anything
// answered, so that "the relays said there is nothing" and "nobody said
// anything" are not shown as the same empty list. See `lib/listLoad.ts`.
//
// A leaf module on purpose: it imports nothing, so a list's loader can use it
// without pulling in NDK, and a test can play "a relay answered" or "nobody
// did" through the real totals instead of a copy of this logic.
//
// What the totals cannot tell, by design of being totals:
// - They move when a fetch ends, not when a relay spoke. A fetch that
//   collected events before the network went and timed out afterwards counts
//   as answered at the moment it ends.
// - They are shared. A fetch answered by relays this list never asked (an
//   author's own relays, say) still counts as "relays are reachable".
// Both err towards "empty", never towards a false "unreachable".

let answered = 0;
let unanswered = 0;

export interface FetchMark { answered: number; unanswered: number }

/** Where the totals stand now. Compare later with `unansweredSince`. */
export function fetchMark(): FetchMark {
  return { answered, unanswered };
}

/**
 * True when at least one fetch has ended since `mark` without the network
 * answering, and none has been answered. Fetches made by other parts of the
 * app in the same moment count too: one answer from anywhere means relays are
 * reachable, and an empty result is then taken at its word.
 *
 * False when no fetch has ended since the mark: nothing was asked, so
 * nothing is known, and it is not this function's place to guess.
 */
export function unansweredSince(mark: FetchMark): boolean {
  return unanswered > mark.unanswered && answered === mark.answered;
}

/** Count one finished fetch. `byNetwork`: a relay that can speak for the network answered it. */
export function recordFetchOutcome(byNetwork: boolean): void {
  if (byNetwork) answered++;
  else unanswered++;
}
