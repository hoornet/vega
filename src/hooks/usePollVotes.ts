import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchPollResponses } from "../lib/nostr";
import type { PollVotes } from "../lib/nostr";
import { useUserStore } from "../stores/user";

const cache = new Map<string, PollVotes>();

const pending = new Map<string, Promise<PollVotes>>();
let activeCount = 0;
const MAX_CONCURRENT = 4;
const queue: Array<() => void> = [];

function runNext() {
  if (queue.length > 0 && activeCount < MAX_CONCURRENT) {
    const next = queue.shift()!;
    next();
  }
}

function throttledFetch(pollId: string, pubkey?: string): Promise<PollVotes> {
  if (pending.has(pollId)) return pending.get(pollId)!;

  const promise = new Promise<PollVotes>((resolve) => {
    const doFetch = () => {
      activeCount++;
      fetchPollResponses(pollId, pubkey)
        .then((result) => {
          resolve(result);
        })
        .catch(() => {
          resolve({ votes: new Map(), myVote: null, total: 0 });
        })
        .finally(() => {
          activeCount--;
          pending.delete(pollId);
          runNext();
        });
    };

    if (activeCount < MAX_CONCURRENT) {
      doFetch();
    } else {
      queue.push(doFetch);
    }
  });

  pending.set(pollId, promise);
  return promise;
}

// Everyone showing a poll, by poll. A feed row and the same note in a thread,
// or a row that scrolled out and back while a vote was on its way, are
// different components: what one learns, all must show.
const watchers = new Map<string, Set<(votes: PollVotes) => void>>();

function tell(pollId: string, votes: PollVotes): void {
  cache.set(pollId, votes);
  watchers.get(pollId)?.forEach((show) => show(votes));
}

function withMyVote(votes: PollVotes, optionIndex: number): PollVotes {
  const counts = new Map(votes.votes);
  // If changing vote, decrement old option
  if (votes.myVote !== null && votes.myVote !== undefined) {
    const oldCount = counts.get(votes.myVote) ?? 0;
    if (oldCount > 1) counts.set(votes.myVote, oldCount - 1);
    else counts.delete(votes.myVote);
  }
  counts.set(optionIndex, (counts.get(optionIndex) ?? 0) + 1);
  const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
  return { votes: counts, myVote: optionIndex, total };
}

// A vote that is on its way: which option, per poll. Outside any component,
// so a row that scrolled out and back still knows and does not send a second.
const pendingVotes = new Map<string, number>();
const pendingWatchers = new Set<() => void>();
const watchPending = (changed: () => void) => { pendingWatchers.add(changed); return () => { pendingWatchers.delete(changed); }; };
const pendingChanged = () => pendingWatchers.forEach((changed) => changed());

// Votes on a poll are numbered in the order they were cast. The one on
// screen is the one cast last among those that went out, whatever order
// their publishes finished in, because that is the one the relays count. A
// vote given up on (a signer that answered late) can go out after a later one.
const cast = new Map<string, number>();
const shown = new Map<string, number>();

/**
 * Claim the poll for one vote, and number it. Null when one is already on its
 * way: asked of the map, not of what a component last rendered, so two
 * presses cannot both get through.
 */
export function beginVote(pollId: string, optionIndex: number): number | null {
  if (pendingVotes.has(pollId)) return null;
  pendingVotes.set(pollId, optionIndex);
  pendingChanged();
  const turn = (cast.get(pollId) ?? 0) + 1;
  cast.set(pollId, turn);
  return turn;
}

export function endVote(pollId: string): void {
  if (pendingVotes.delete(pollId)) pendingChanged();
}

/** A vote went out. True when it is the one to show: none cast after it is showing already. */
export function takesTheVote(pollId: string, turn: number): boolean {
  if (turn <= (shown.get(pollId) ?? 0)) return false;
  shown.set(pollId, turn);
  return true;
}

/** The option a vote on this poll is being sent for, or null. */
export function usePendingVote(pollId: string): number | null {
  return useSyncExternalStore(watchPending, () => pendingVotes.get(pollId) ?? null);
}

export function usePollVotes(pollId: string): [PollVotes | null, (optionIndex: number) => void] {
  const [data, setData] = useState<PollVotes | null>(() => cache.get(pollId) ?? null);

  useEffect(() => {
    const here = watchers.get(pollId) ?? new Set<(votes: PollVotes) => void>();
    watchers.set(pollId, here);
    here.add(setData);
    return () => {
      here.delete(setData);
      if (here.size === 0 && watchers.get(pollId) === here) watchers.delete(pollId);
    };
  }, [pollId]);
  const pubkeyRef = useRef(useUserStore.getState().pubkey);

  useEffect(() => {
    pubkeyRef.current = useUserStore.getState().pubkey;
  });

  useEffect(() => {
    if (cache.has(pollId)) {
      setData(cache.get(pollId)!);
      return;
    }
    throttledFetch(pollId, pubkeyRef.current ?? undefined).then((result) => {
      // A vote cast before the tally arrived must survive it. The tally was
      // asked for before the vote went out and does not have it: it used to
      // replace what was shown, and the poll offered the vote again. A vote
      // in the cache at this point is one cast in this session (or this same
      // tally, written a moment ago for another row), so it is at least as
      // new as what the tally holds, an older vote of ours from another
      // device included: `withMyVote` moves that one.
      const mine = cache.get(pollId)?.myVote;
      tell(pollId, mine !== null && mine !== undefined ? withMyVote(result, mine) : result);
    });
  }, [pollId]);

  const addVote = (optionIndex: number) => {
    // From the cache and into it here, not inside a state updater: React
    // never runs one for a row that has scrolled out of the virtual list,
    // and the vote, now recorded only after it is published, would be lost.
    tell(pollId, withMyVote(cache.get(pollId) ?? { votes: new Map(), myVote: null, total: 0 }, optionIndex));
  };

  return [data, addVote];
}
