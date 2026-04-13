import { useEffect, useState } from "react";
import { fetchProfile } from "../lib/nostr";
import { dbLoadProfile, dbSaveProfile } from "../lib/db";

const PROFILE_CACHE_MAX = 500;
const profileCache = new Map<string, any>();
const pendingRequests = new Map<string, Promise<any>>();

function pruneProfileCache() {
  if (profileCache.size > PROFILE_CACHE_MAX) {
    // Drop oldest entries (Map preserves insertion order)
    const toDelete = profileCache.size - PROFILE_CACHE_MAX;
    let i = 0;
    for (const key of profileCache.keys()) {
      if (i++ >= toDelete) break;
      profileCache.delete(key);
    }
  }
}

export function invalidateProfileCache(pubkey: string) {
  profileCache.delete(pubkey);
  pendingRequests.delete(pubkey);
}

export function useProfile(pubkey: string) {
  const [profile, setProfile] = useState<any>(profileCache.get(pubkey) ?? null);

  useEffect(() => {
    if (profileCache.has(pubkey)) {
      setProfile(profileCache.get(pubkey));
      return;
    }

    // Kick off relay fetch (deduplicated across simultaneous callers)
    if (!pendingRequests.has(pubkey)) {
      const request = fetchProfile(pubkey)
        .then((p) => {
          const result = p ?? null;
          profileCache.set(pubkey, result);
          pruneProfileCache();
          pendingRequests.delete(pubkey);
          if (result) dbSaveProfile(pubkey, JSON.stringify(result));
          return result;
        })
        .catch(() => {
          pendingRequests.delete(pubkey);
          return null;
        });
      pendingRequests.set(pubkey, request);
    }

    // Show SQLite cached profile immediately while the relay request is in-flight.
    // `settled` prevents the stale cached value from overwriting a fresh relay result.
    let settled = false;
    dbLoadProfile(pubkey).then((cached) => {
      if (!settled && cached && !profileCache.has(pubkey)) {
        try {
          setProfile(JSON.parse(cached));
        } catch {
          // Corrupt cache entry — ignore
        }
      }
    });

    pendingRequests.get(pubkey)!.then((p) => {
      settled = true;
      setProfile(p ?? null);
    });
  }, [pubkey]);

  return profile;
}
