import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../stores/user";
import { useAssistantStore } from "../stores/assistant";
import { fetchProfiles, searchUsers } from "../lib/nostr";
import { peekCachedProfile, primeProfileCache } from "./useProfile";
import { insertMention, mentionAt, rankPeople, type MentionQuery } from "../lib/mentions";
import { useEscapeToClose } from "./useEscapeToClose";

/** Profiles of the people followed, kept for the session, filled in once per follow list. */
const followProfiles = new Map<string, NDKUserProfile | null>();
let loadedFor: string[] | null = null;
let loading: Promise<void> | null = null;

/** Profiles fetched for suggestions are primed into the shared cache, up to this many (as the New message dialog does). */
const PRIME_AT_MOST = 400;

function loadFollowProfiles(follows: string[]): Promise<void> {
  if (loadedFor === follows && loading) return loading;
  loadedFor = follows;
  loading = (async () => {
    const peeked = await Promise.all(follows.map((pk) => peekCachedProfile(pk).catch(() => undefined)));
    const missing: string[] = [];
    follows.forEach((pk, i) => {
      if (peeked[i] === undefined) missing.push(pk);
      else followProfiles.set(pk, peeked[i] as NDKUserProfile | null);
    });
    if (missing.length === 0) return;
    try {
      const fetched = await fetchProfiles(missing);
      let primed = 0;
      for (const [pk, p] of fetched) {
        if (primed++ < PRIME_AT_MOST) primeProfileCache(pk, p);
        followProfiles.set(pk, p);
      }
    } catch {
      /* suggestions show who has a name */
    }
  })();
  return loading;
}

/** For tests. */
export function forgetFollowProfiles(): void {
  followProfiles.clear();
  loadedFor = null;
  loading = null;
}

export interface MentionPerson {
  pubkey: string;
  profile: NDKUserProfile | null | undefined;
}

interface Options {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText: (text: string) => void;
}

/**
 * `@` and a few letters in a box suggest people to mention; picking one writes `nostr:npub1…`.
 * The box passes its key presses here first (`onKeyDown` returns true when it took one), spreads
 * `textareaProps` on its textarea, and renders `list` under it.
 */
export function useMentions({ textareaRef, text, setText }: Options) {
  const follows = useUserStore((s) => s.follows);
  const me = useUserStore((s) => s.pubkey);
  const assistantOn = useAssistantStore((s) => s.settings.enabled);
  const [caret, setCaret] = useState<number | null>(null);
  // An `@word` closed with Escape stays closed until the caret leaves it.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [, setVersion] = useState(0);
  const [found, setFound] = useState<{ query: string; people: Array<{ pubkey: string; profile: NDKUserProfile }> }>({ query: "", people: [] });
  const searches = useRef(0);
  const listId = useId();

  const at: MentionQuery | null = caret === null ? null : mentionAt(text, caret, assistantOn);
  const open = at !== null && dismissed !== at.start;
  const query = open ? at.query : null;

  useEffect(() => {
    if (dismissed !== null && (at === null || at.start !== dismissed)) setDismissed(null);
  }, [at, dismissed]);

  // The follow list's names, the first time a mention is started.
  const mentioning = query !== null;
  useEffect(() => {
    if (!mentioning || follows.length === 0) return;
    let live = true;
    void loadFollowProfiles(follows).then(() => { if (live) setVersion((v) => v + 1); });
    return () => { live = false; };
  }, [mentioning, follows]);

  const profileOf = (pk: string) => followProfiles.get(pk);
  const fromFollows = query === null ? [] : rankPeople(follows, profileOf, query, [], me);

  // Not enough among the people followed: ask the search relays, after a pause in typing.
  const wantSearch = query !== null && query.trim().length >= 2 && fromFollows.length < 6;
  useEffect(() => {
    if (!wantSearch || query === null) return;
    const no = ++searches.current;
    const timer = setTimeout(async () => {
      try {
        const events = await searchUsers(query.trim(), 10);
        if (no !== searches.current) return;
        const people: Array<{ pubkey: string; profile: NDKUserProfile }> = [];
        for (const e of events) {
          try {
            const profile = JSON.parse(e.content) as NDKUserProfile;
            if (profile && typeof profile === "object") {
              primeProfileCache(e.pubkey, profile);
              people.push({ pubkey: e.pubkey, profile });
            }
          } catch {
            /* not a profile */
          }
        }
        setFound({ query, people });
      } catch {
        /* the people followed are still suggested */
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [wantSearch, query]);

  const searched = found.query === query ? found.people : [];
  const ids = query === null ? [] : rankPeople(follows, profileOf, query, searched, me);
  const people: MentionPerson[] = ids.map((pubkey) => ({ pubkey, profile: followProfiles.get(pubkey) ?? searched.find((p) => p.pubkey === pubkey)?.profile }));
  const shown = open && people.length > 0;
  const current = Math.min(active, Math.max(people.length - 1, 0));

  useEffect(() => setActive(0), [query]);
  useEscapeToClose(() => { if (at) setDismissed(at.start); }, shown);

  const pick = (pubkey: string) => {
    if (!at) return;
    const next = insertMention(text, at, pubkey);
    setText(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = next.caret;
    });
  };

  const readCaret = () => {
    const ta = textareaRef.current;
    setCaret(ta && ta.selectionStart === ta.selectionEnd ? ta.selectionStart : null);
  };

  /** Arrow keys move, Enter or Tab picks; true when the key was the list's. */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!shown || e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === "Escape" && at) { e.preventDefault(); e.stopPropagation(); setDismissed(at.start); return true; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((current + 1) % people.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((current - 1 + people.length) % people.length); return true; }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") { e.preventDefault(); pick(people[current].pubkey); return true; }
    return false;
  };

  const optionId = (i: number) => `${listId}-${i}`;

  return {
    onKeyDown,
    textareaProps: {
      onSelect: readCaret,
      onBlur: () => setCaret(null),
      "aria-autocomplete": "list" as const,
      "aria-controls": shown ? listId : undefined,
      "aria-expanded": shown,
      "aria-activedescendant": shown ? optionId(current) : undefined,
    },
    list: shown ? { id: listId, optionId, people, active: current, onPick: pick, onHover: setActive } : null,
  };
}

export type MentionListProps = NonNullable<ReturnType<typeof useMentions>["list"]>;
