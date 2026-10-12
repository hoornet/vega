import { useEffect, useRef, useState } from "react";
import { fetchReactions } from "../lib/nostr";
import type { GroupedReactions } from "../lib/nostr";
import { useUserStore } from "../stores/user";
import { useWoTStore } from "../stores/wot";

// Cache key embeds WoT state so filtered / unfiltered counts don't collide.
const cache = new Map<string, GroupedReactions>();
const pending = new Map<string, Promise<GroupedReactions>>();
let activeCount = 0;
const MAX_CONCURRENT = 4;
const queue: Array<() => void> = [];

function keyFor(eventId: string, wotActive: boolean): string {
  return wotActive ? `${eventId}|wot` : eventId;
}

function runNext() {
  if (queue.length > 0 && activeCount < MAX_CONCURRENT) {
    const next = queue.shift()!;
    next();
  }
}

function throttledFetch(cacheKey: string, eventId: string, pubkey?: string, wotSet?: Set<string>): Promise<GroupedReactions> {
  if (pending.has(cacheKey)) return pending.get(cacheKey)!;

  const promise = new Promise<GroupedReactions>((resolve) => {
    const doFetch = () => {
      activeCount++;
      fetchReactions(eventId, pubkey, wotSet)
        .then(resolve)
        .catch(() => {
          resolve({ groups: new Map(), myReactions: new Set(), total: 0 });
        })
        .finally(() => {
          activeCount--;
          pending.delete(cacheKey);
          runNext();
        });
    };

    if (activeCount < MAX_CONCURRENT) {
      doFetch();
    } else {
      queue.push(doFetch);
    }
  });

  pending.set(cacheKey, promise);
  return promise;
}

export function useReactions(eventId: string, enabled = true): [GroupedReactions | null, (emoji: string) => void] {
  const wotEnabled = useWoTStore((s) => s.enabled);
  const wotSet = useWoTStore((s) => s.wotSet);
  const wotActive = wotEnabled && wotSet.size > 0;
  const effectiveWotSet = wotActive ? wotSet : undefined;
  const cacheKey = keyFor(eventId, wotActive);

  const [data, setData] = useState<GroupedReactions | null>(() => cache.get(cacheKey) ?? null);
  const pubkeyRef = useRef(useUserStore.getState().pubkey);

  useEffect(() => {
    pubkeyRef.current = useUserStore.getState().pubkey;
  });

  useEffect(() => {
    if (!enabled) return;
    if (cache.has(cacheKey)) {
      setData(cache.get(cacheKey)!);
      return;
    }
    let cancelled = false;
    throttledFetch(cacheKey, eventId, pubkeyRef.current ?? undefined, effectiveWotSet).then((result) => {
      // A reaction given while the tally was on its way. The tally was asked
      // for before it went out and does not have it: put in place of what
      // was shown, the pill went and the same reaction was offered again.
      // What is in the cache by now can only be such reactions.
      const mine = Array.from(cache.get(cacheKey)?.myReactions ?? []).filter((emoji) => !result.myReactions.has(emoji));
      const merged = mine.length === 0 ? result : {
        groups: new Map([...result.groups, ...mine.map((emoji): [string, number] => [emoji, (result.groups.get(emoji) ?? 0) + 1])]),
        myReactions: new Set([...result.myReactions, ...mine]),
        total: result.total + mine.length,
      };
      // Kept whether or not the row is still there. Dropped for a row that
      // had scrolled away, the cache was left holding the user's own reaction
      // and nothing else, and nothing asked again: 🔥1 where the relays had ten.
      cache.set(cacheKey, merged);
      if (!cancelled) setData(merged);
    });
    return () => { cancelled = true; };
  }, [cacheKey, enabled]);

  const addReaction = (emoji: string) => {
    // Worked out from the cache and written to it here, not inside a state
    // updater. A row scrolled out of the virtual list while its reaction was
    // on its way is unmounted, and React never runs an updater for it: the
    // reaction went unrecorded, and the row that scrolled back showed no
    // pill and offered the same reaction again.
    const prev = cache.get(cacheKey) ?? null;
    const groups = new Map(prev?.groups ?? []);
    groups.set(emoji, (groups.get(emoji) ?? 0) + 1);
    const myReactions = new Set(prev?.myReactions ?? []);
    myReactions.add(emoji);
    const next: GroupedReactions = { groups, myReactions, total: (prev?.total ?? 0) + 1 };
    cache.set(cacheKey, next);
    setData(next);
  };

  return [data, addReaction];
}

/** Seed the cache from batch engagement data (avoids per-note refetching). */
export function seedReactionsCache(eventId: string, groups: Map<string, number>, myReactions: Set<string>, wotActive = false) {
  const key = keyFor(eventId, wotActive);
  // The batch that seeds this is fetched without saying who is asking, so it
  // never knows the user's own reactions. One on record from this session
  // must not be lost to it. The batch's count will have it already, unless
  // the relays do not: then it is counted here.
  const seeded = new Map(groups);
  const mine = new Set(myReactions);
  for (const emoji of cache.get(key)?.myReactions ?? []) {
    if (!seeded.has(emoji)) seeded.set(emoji, 1);
    mine.add(emoji);
  }
  const total = Array.from(seeded.values()).reduce((sum, n) => sum + n, 0);
  cache.set(key, { groups: seeded, myReactions: mine, total });
}
