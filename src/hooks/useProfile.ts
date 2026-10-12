import { useEffect, useState } from "react";
import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
import { fetchProfile } from "../lib/nostr";
import { dbLoadProfile, dbSaveProfile } from "../lib/db";
import { olderProfile } from "../lib/utils";

const PROFILE_CACHE_MAX = 500;
const profileCache = new Map<string, any>();
const pendingRequests = new Map<string, Promise<any>>();

/**
 * Accounts a fetch found nothing for, and when to ask again.
 *
 * "Nothing" is far more often a relay that was slow, or a network that was
 * down for a moment, than an account with no profile. This used to be cached
 * as `null` for the life of the session: every name fetched while the
 * network was off stayed a key until the app was restarted. Now it is a
 * miss, asked again after half a minute, then two, then every ten.
 */
const misses = new Map<string, { tries: number; retryAt: number }>();
const MISS_RETRY_MS = [30_000, 120_000, 600_000];
function recordMiss(pubkey: string): void {
  const tries = (misses.get(pubkey)?.tries ?? 0) + 1;
  const wait = MISS_RETRY_MS[Math.min(tries, MISS_RETRY_MS.length) - 1];
  misses.set(pubkey, { tries, retryAt: Date.now() + wait });
  // Bounded like the cache: a long session meets many accounts with no profile.
  // The oldest records go first (a Map keeps insertion order).
  for (const key of misses.keys()) {
    if (misses.size <= PROFILE_CACHE_MAX) break;
    misses.delete(key);
  }
}
const missDue = (pubkey: string): boolean => {
  const miss = misses.get(pubkey);
  return !miss || Date.now() >= miss.retryAt;
};

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

/** The copy of a profile kept on this computer, or null: no copy, or one that cannot be read. */
async function storedProfile(pubkey: string): Promise<NDKUserProfile | null> {
  const stored = await dbLoadProfile(pubkey);
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? (parsed as NDKUserProfile) : null;
  } catch {
    return null;
  }
}

/** The read of the stored copy for a fetch that is out: one read, for the first paint and to judge what arrives. */
const storedReads = new Map<string, Promise<NDKUserProfile | null>>();

/**
 * Seed the in-memory cache (and SQLite) with a profile fetched elsewhere in
 * bulk, so cards rendered afterwards don't refetch it one subscription at a
 * time. Only real profiles are primed: a null here would stop the hook from
 * ever asking a relay for that pubkey.
 *
 * `from` says where it came from. One that a relay sent does not replace a
 * newer one already held (see `olderProfile`). One the owner just published
 * is the newest there is, and is taken as it is.
 */
export function primeProfileCache(pubkey: string, profile: NDKUserProfile | null | undefined, from: "relay" | "published" = "relay"): void {
  if (!profile) return;
  if (from === "relay" && olderProfile(profile, profileCache.get(pubkey) as NDKUserProfile | null | undefined)) return;
  misses.delete(pubkey);
  profileCache.set(pubkey, profile);
  pruneProfileCache();
  dbSaveProfile(pubkey, JSON.stringify(profile));
}

/**
 * What we already know about a profile without touching a relay: the memory
 * cache, then SQLite. `undefined` means neither has it.
 */
export async function peekCachedProfile(pubkey: string): Promise<NDKUserProfile | null | undefined> {
  // A miss (a fetch that came back empty or timed out) is not "known to have
  // no profile": it is reported as unknown, and callers that decide
  // visibility on it ask the relays again in their batch.
  const inMemory = profileCache.get(pubkey);
  if (inMemory) return inMemory as NDKUserProfile;
  return (await storedProfile(pubkey)) ?? undefined;
}

export function useProfile(pubkey: string) {
  const [profile, setProfile] = useState<any>(profileCache.get(pubkey) ?? null);

  useEffect(() => {
    if (profileCache.has(pubkey)) {
      setProfile(profileCache.get(pubkey));
      return;
    }
    // Asked lately and found nothing: not again yet. The next card mounted
    // for this account after the wait asks.
    if (!missDue(pubkey) && !pendingRequests.has(pubkey)) {
      setProfile(null);
      return;
    }

    // Kick off relay fetch (deduplicated + concurrency-throttled)
    if (!pendingRequests.has(pubkey)) {
      const stored = storedProfile(pubkey);
      storedReads.set(pubkey, stored);
      /** What is known without the relays: primed meanwhile, or the copy on this computer. */
      const held = async () => (profileCache.get(pubkey) as NDKUserProfile | null | undefined) ?? (await stored);
      const request = new Promise<any>((resolve) => {
        const doFetch = () => {
          activeProfileFetches++;
          fetchProfile(pubkey)
            .then(async (p) => {
              const arrived = p ?? null;
              const known = await held();
              // An older profile, or none, does not replace what is known.
              // A name on screen from the copy on this computer used to turn
              // back into a key when a slow relay sent nothing, and a fetch
              // that was out while the owner saved brought the old one back.
              const kept = olderProfile(arrived, known) ? known : arrived;
              if (kept) {
                misses.delete(pubkey);
                profileCache.set(pubkey, kept);
                pruneProfileCache();
                if (kept === arrived) dbSaveProfile(pubkey, JSON.stringify(arrived));
              } else {
                recordMiss(pubkey);
              }
              resolve(kept);
            })
            // The fetch failed (a profile on the relays that cannot be read
            // does this). Nothing is cached, so a later card asks again.
            .catch(async () => resolve((await held()) ?? null))
            .finally(() => {
              activeProfileFetches--;
              pendingRequests.delete(pubkey);
              storedReads.delete(pubkey);
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
    (storedReads.get(pubkey) ?? storedProfile(pubkey)).then((cached) => {
      if (!settled && cached && !profileCache.has(pubkey)) setProfile(cached);
    });

    pendingRequests.get(pubkey)!.then((p) => {
      settled = true;
      setProfile(p ?? null);
    });
  }, [pubkey]);

  return profile;
}
