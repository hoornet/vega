import { useEffect, useRef, useState } from "react";
import type { NDKEvent, NDKUserProfile } from "@nostr-dev-kit/ndk";
import { useFeedStore } from "../stores/feed";
import { useUserStore } from "../stores/user";
import { useMuteStore } from "../stores/mute";
import { useWoTStore } from "../stores/wot";
import { useUIStore } from "../stores/ui";
import { matchesScriptFilter } from "../lib/language";
import { useDismissedSuggestionsStore } from "../stores/dismissedSuggestions";
import { fetchProfiles } from "../lib/nostr";
import { fetchMark, wentUnanswered } from "../lib/listLoad";
import { ownName } from "../lib/utils";
import { storedInterests } from "../lib/interests";
import { looksLikePayload } from "../lib/noteFilters";
import { isRssBridge } from "../lib/articleFilters";
import { primeProfileCache, peekCachedProfile } from "./useProfile";

// "People to start with": whom to offer an account that follows nobody, or
// almost nobody. The follows-of-follows suggestions need follows, so this is
// built from what is already there: the authors of the trending notes the
// feed would show, those posting on a topic the user picked first, and only
// those with a name and a picture.

export const STARTING_PEOPLE = 10;
/** How many authors are asked for a profile; most have one, some have no picture. */
const CANDIDATES = 40;
/** A profile batch nobody answered is asked once more, after this. */
const RETRY_MS = 4000;

/** Distinct authors of ranked notes, minus `exclude`; those whose notes carry one of the interests come first. */
export function rankStartingPeople(notes: NDKEvent[], exclude: Set<string>, interests: string[]): string[] {
  const wanted = new Set(interests.map((t) => t.toLowerCase()));
  const seen = new Set<string>();
  const onTopic: string[] = [];
  const rest: string[] = [];
  for (const note of notes) {
    if (exclude.has(note.pubkey) || seen.has(note.pubkey)) continue;
    seen.add(note.pubkey);
    const tagged = wanted.size > 0 && note.tags.some((t) => t[0] === "t" && typeof t[1] === "string" && wanted.has(t[1].toLowerCase()));
    (tagged ? onTopic : rest).push(note.pubkey);
  }
  return [...onTopic, ...rest];
}

/** Someone a newcomer can tell apart from a key: a name and a picture, and not a bridge reposting a feed. */
export function presentable(profile: NDKUserProfile | null | undefined): boolean {
  return !!profile && ownName(profile) !== null && typeof profile.picture === "string" && profile.picture.length > 0 && !isRssBridge(profile);
}

export type StartingPeople = { pubkeys: string[]; status: "loading" | "ready" | "none" };

export function useStartingPeople(limit = STARTING_PEOPLE): StartingPeople {
  const trendingNotes = useFeedStore((s) => s.trendingNotes);
  const trendingLoading = useFeedStore((s) => s.trendingLoading);
  const trendingOutcome = useFeedStore((s) => s.outcome.trending);
  const loadTrendingFeed = useFeedStore((s) => s.loadTrendingFeed);
  const own = useUserStore((s) => s.pubkey);
  const follows = useUserStore((s) => s.follows);
  const muted = useMuteStore((s) => s.mutedPubkeys);
  const contentMatchesMutedKeyword = useMuteStore((s) => s.contentMatchesMutedKeyword);
  const wotEnabled = useWoTStore((s) => s.enabled);
  const wotSet = useWoTStore((s) => s.wotSet);
  const scriptFilter = useUIStore((s) => s.feedLanguageFilter);
  const dismissed = useDismissedSuggestionsStore((s) => s.dismissedPubkeys);
  // The authors with a profile worth showing, and the notes they were found in.
  const [found, setFound] = useState<{ from: NDKEvent[]; pubkeys: string[] } | null>(null);
  // A batch nobody answered: asked once more, a moment later.
  const [retry, setRetry] = useState<{ from: NDKEvent[]; due: boolean } | null>(null);

  useEffect(() => {
    if (trendingNotes.length === 0 && !trendingLoading) void loadTrendingFeed();
    // Once: the trending tab's own loader keeps the list fresh after that.
  }, []);

  useEffect(() => {
    if (trendingNotes.length === 0 || found?.from === trendingNotes) return;
    if (retry?.from === trendingNotes && !retry.due) return;
    let cancelled = false;
    // Who is followed now is left out of the candidates; a Follow made from
    // the list keeps its row (see PeopleToStartWith). Who is muted or
    // dismissed is applied below as well, so a mute or a dismiss removes the
    // row at once.
    const exclude = new Set([...(own ? [own] : []), ...follows, ...muted]);
    const shown = trendingNotes.filter((note) =>
      !looksLikePayload(note.content) && !contentMatchesMutedKeyword(note.content) && (!wotEnabled || wotSet.size === 0 || wotSet.has(note.pubkey))
      && matchesScriptFilter(note.tags, note.content.trim(), scriptFilter));
    const candidates = rankStartingPeople(shown, exclude, storedInterests(own)).slice(0, CANDIDATES);
    (async () => {
      // The feed's cards have read most of these already.
      const cached = await Promise.all(candidates.map((pk) => peekCachedProfile(pk).catch(() => undefined)));
      if (cancelled) return;
      const profiles = new Map<string, NDKUserProfile>();
      const missing: string[] = [];
      candidates.forEach((pk, i) => { const p = cached[i]; if (p) profiles.set(pk, p); else if (p === undefined) missing.push(pk); });
      const mark = fetchMark();
      let answered = missing.length === 0;
      if (missing.length > 0) {
        try {
          const fetched = await fetchProfiles(missing);
          if (cancelled) return;
          for (const [pubkey, profile] of fetched) { profiles.set(pubkey, profile); primeProfileCache(pubkey, profile); }
          answered = !wentUnanswered(mark);
        } catch { /* nobody answered: asked again below */ }
      }
      if (cancelled) return;
      const presentables = candidates.filter((pk) => presentable(profiles.get(pk)));
      if (presentables.length === 0 && !answered && retry?.from !== trendingNotes) {
        // Nothing came back and nobody answered: once more, a moment later.
        setRetry({ from: trendingNotes, due: false });
        retryTimer.current = setTimeout(() => setRetry((r) => (r?.from === trendingNotes ? { from: trendingNotes, due: true } : r)), RETRY_MS);
        return;
      }
      setFound({ from: trendingNotes, pubkeys: presentables });
    })();
    return () => { cancelled = true; };
  }, [trendingNotes, own, found, retry]);
  // The retry timer outlives the effect that set it (its own setRetry re-runs the effect), and is
  // cleared only when the hook is gone.
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);

  const hidden = new Set([...(own ? [own] : []), ...muted, ...dismissed]);
  const pubkeys = (found?.pubkeys ?? []).filter((pk) => !hidden.has(pk)).slice(0, limit);
  const stillLooking = trendingLoading
    || (trendingNotes.length > 0 && found?.from !== trendingNotes)
    || (trendingNotes.length === 0 && trendingOutcome === "pending");
  const status = pubkeys.length > 0 ? "ready" : stillLooking ? "loading" : "none";
  return { pubkeys, status };
}
