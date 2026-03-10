import { useEffect, useState } from "react";
import { fetchZapCount } from "../lib/nostr";

interface ZapData { count: number; totalSats: number; }

const cache = new Map<string, ZapData>();

export function useZapCount(eventId: string): ZapData | null {
  const [data, setData] = useState<ZapData | null>(() => cache.get(eventId) ?? null);

  useEffect(() => {
    if (cache.has(eventId)) {
      setData(cache.get(eventId)!);
      return;
    }
    fetchZapCount(eventId).then((d) => {
      cache.set(eventId, d);
      setData(d);
    });
  }, [eventId]);

  return data;
}
