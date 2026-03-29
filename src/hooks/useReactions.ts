import { useEffect, useRef, useState } from "react";
import { fetchReactions } from "../lib/nostr";
import type { GroupedReactions } from "../lib/nostr";
import { useUserStore } from "../stores/user";

const cache = new Map<string, GroupedReactions>();

// Queue to throttle parallel relay queries — too many at once causes timeouts
const pending = new Map<string, Promise<GroupedReactions>>();
let activeCount = 0;
const MAX_CONCURRENT = 4;
const queue: Array<() => void> = [];

function runNext() {
  if (queue.length > 0 && activeCount < MAX_CONCURRENT) {
    const next = queue.shift()!;
    next();
  }
}

function throttledFetch(eventId: string, pubkey?: string): Promise<GroupedReactions> {
  if (pending.has(eventId)) return pending.get(eventId)!;

  const promise = new Promise<GroupedReactions>((resolve) => {
    const doFetch = () => {
      activeCount++;
      fetchReactions(eventId, pubkey)
        .then((result) => {
          resolve(result);
        })
        .catch(() => {
          resolve({ groups: new Map(), myReactions: new Set(), total: 0 });
        })
        .finally(() => {
          activeCount--;
          pending.delete(eventId);
          runNext();
        });
    };

    if (activeCount < MAX_CONCURRENT) {
      doFetch();
    } else {
      queue.push(doFetch);
    }
  });

  pending.set(eventId, promise);
  return promise;
}

export function useReactions(eventId: string): [GroupedReactions | null, (emoji: string) => void] {
  const [data, setData] = useState<GroupedReactions | null>(() => cache.get(eventId) ?? null);
  const pubkeyRef = useRef(useUserStore.getState().pubkey);

  useEffect(() => {
    pubkeyRef.current = useUserStore.getState().pubkey;
  });

  useEffect(() => {
    if (cache.has(eventId)) {
      setData(cache.get(eventId)!);
      return;
    }
    let cancelled = false;
    throttledFetch(eventId, pubkeyRef.current ?? undefined).then((result) => {
      if (!cancelled) {
        cache.set(eventId, result);
        setData(result);
      }
    });
    return () => { cancelled = true; };
  }, [eventId]);

  const addReaction = (emoji: string) => {
    setData((prev) => {
      const groups = new Map(prev?.groups ?? []);
      groups.set(emoji, (groups.get(emoji) ?? 0) + 1);
      const myReactions = new Set(prev?.myReactions ?? []);
      myReactions.add(emoji);
      const total = (prev?.total ?? 0) + 1;
      const next: GroupedReactions = { groups, myReactions, total };
      cache.set(eventId, next);
      return next;
    });
  };

  return [data, addReaction];
}

/** Seed the cache from batch engagement data (avoids per-note refetching). */
export function seedReactionsCache(eventId: string, groups: Map<string, number>, myReactions: Set<string>) {
  const total = Array.from(groups.values()).reduce((sum, n) => sum + n, 0);
  cache.set(eventId, { groups, myReactions, total });
}
