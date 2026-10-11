import { useEffect, useState } from "react";
import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
import { fetchProfile } from "../lib/nostr";
import { dbLoadProfile, dbSaveProfile } from "../lib/db";

const PROFILE_CACHE_MAX = 500;
const profileCache = new Map<string, any>();
const pendingRequests = new Map<string, Promise<any>>();

// Hard cap on concurrent NDK profile fetches.
// Without this, rendering 200 cached notes triggers 200 simultaneous
// user.fetchProfile() calls (each creates an NDK subscription) → OOM.
let activeProfileFetches = 0;
const MAX_PROFILE_CONCURRENT = 8;
const profileFetchQueue: Array<() => void> = [];

function runNextProfileFetch() {
  while (profileFetchQueue.length > 0 && activeProfileFetches < MAX_PROFILE_CONCURRENT) {
    const next = profileFetchQueue.shift()!;
    next();
  }
}

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

/**
 * Seed the in-memory cache (and SQLite) with a profile fetched elsewhere in
 * bulk, so cards rendered afterwards don't refetch it one subscription at a
 * time. Only real profiles are primed: a null here would stop the hook from
 * ever asking a relay for that pubkey.
 */
export function primeProfileCache(pubkey: string, profile: NDKUserProfile | null | undefined): void {
  if (!profile) return;
  profileCache.set(pubkey, profile);
  pruneProfileCache();
  dbSaveProfile(pubkey, JSON.stringify(profile));
}

/**
 * What we already know about a profile without touching a relay: the memory
 * cache, then SQLite. `undefined` means neither has it.
 */
export async function peekCachedProfile(pubkey: string): Promise<NDKUserProfile | null | undefined> {
  // A cached null means one earlier single-profile fetch came back empty or
  // timed out; the hook stores it so cards stop retrying. For callers that
  // decide visibility on it, that is not "known to have no profile", so it is
  // reported as unknown and they ask the relays again in their batch.
  const inMemory = profileCache.get(pubkey);
  if (inMemory) return inMemory as NDKUserProfile;
  const cached = await dbLoadProfile(pubkey);
  if (!cached) return undefined;
  try {
    return JSON.parse(cached) as NDKUserProfile;
  } catch {
    return undefined;
  }
}

export function useProfile(pubkey: string) {
  const [profile, setProfile] = useState<any>(profileCache.get(pubkey) ?? null);

  useEffect(() => {
    if (profileCache.has(pubkey)) {
      setProfile(profileCache.get(pubkey));
      return;
    }

    // Kick off relay fetch (deduplicated + concurrency-throttled)
    if (!pendingRequests.has(pubkey)) {
      const request = new Promise<any>((resolve) => {
        const doFetch = () => {
          activeProfileFetches++;
          fetchProfile(pubkey)
            .then((p) => {
              const result = p ?? null;
              profileCache.set(pubkey, result);
              pruneProfileCache();
              if (result) dbSaveProfile(pubkey, JSON.stringify(result));
              resolve(result);
            })
            .catch(() => resolve(null))
            .finally(() => {
              activeProfileFetches--;
              pendingRequests.delete(pubkey);
              runNextProfileFetch();
            });
        };

        if (activeProfileFetches < MAX_PROFILE_CONCURRENT) {
          doFetch();
        } else {
          profileFetchQueue.push(doFetch);
        }
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
