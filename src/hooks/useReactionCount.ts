import { useEffect, useState } from "react";
import { fetchReactionCount } from "../lib/nostr";

const cache = new Map<string, number>();

export function useReactionCount(eventId: string): [number | null, (delta: number) => void] {
  const [count, setCount] = useState<number | null>(() => cache.get(eventId) ?? null);

  useEffect(() => {
    if (cache.has(eventId)) {
      setCount(cache.get(eventId)!);
      return;
    }
    fetchReactionCount(eventId).then((n) => {
      cache.set(eventId, n);
      setCount(n);
    });
  }, [eventId]);

  const adjust = (delta: number) => {
    setCount((prev) => {
      const next = (prev ?? 0) + delta;
      cache.set(eventId, next);
      return next;
    });
  };

  return [count, adjust];
}
