import { nip19, type NDKUserProfile } from "@nostr-dev-kit/ndk";

/**
 * Mentioning someone while writing (CLAUDE.md, "Mentions"): `@` and a few letters suggest people,
 * and picking one writes `nostr:npub1…` into the text. NDK turns that into the note's `p` tag when
 * it is published (`generateContentTags`), and every client draws it as the person's name.
 */

/** The `@word` the caret is at the end of: where it starts, where it ends, and the word. */
export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

/**
 * The mention being typed at `caret`, or null. An `@` counts at the start of the text or after a
 * space or an opening bracket or quote, so `name@example.com` is not one. With the assistant on,
 * `@vega` at the start of the box is the assistant's, and so is every beginning of it (`@`, `@v`,
 * `@ve`, `@veg`): those suggest nobody.
 */
export function mentionAt(text: string, caret: number, assistantOn: boolean): MentionQuery | null {
  const before = text.slice(0, caret);
  const found = /(?:^|[\s([{"'“‘])@([^\s@]{0,30})$/u.exec(before);
  if (!found) return null;
  // Only at the end of a word: an `@` in the middle of one is being edited, not typed.
  if (caret < text.length && !/\s/.test(text[caret])) return null;
  const query = found[1];
  const start = caret - query.length - 1;
  if (/^(npub1|nprofile1)/i.test(query)) return null;
  if (assistantOn && text.slice(0, start).trim() === "" && "vega".startsWith(query.toLowerCase())) return null;
  return { start, end: caret, query };
}

/** The text with the `@word` replaced by the person's mention, and where the caret goes after it. */
export function insertMention(text: string, at: MentionQuery, pubkey: string): { text: string; caret: number } {
  const mention = `nostr:${nip19.npubEncode(pubkey)} `;
  const after = text.slice(at.end).replace(/^ /, "");
  return { text: text.slice(0, at.start) + mention + after, caret: at.start + mention.length };
}

/** The people a text mentions, in order, once each. */
export function mentionedPubkeys(text: string): string[] {
  const out: string[] = [];
  for (const [, entity] of text.matchAll(/nostr:((?:npub1|nprofile1)[02-9ac-hj-np-z]+)/gi)) {
    try {
      const decoded = nip19.decode(entity.toLowerCase());
      const pubkey = decoded.type === "npub" ? (decoded.data as string) : decoded.type === "nprofile" ? (decoded.data as { pubkey: string }).pubkey : null;
      if (pubkey && !out.includes(pubkey)) out.push(pubkey);
    } catch {
      /* not a whole key */
    }
  }
  return out;
}

function fieldsOf(profile: NDKUserProfile | null | undefined): string[] {
  const p = profile as (NDKUserProfile & { display_name?: unknown }) | null | undefined;
  return [p?.name, p?.displayName, p?.display_name, p?.nip05].filter((f): f is string => typeof f === "string");
}

/**
 * How well a person matches what was typed: 2 when a name or address starts with it, 1 when it
 * is inside one, 0 for no match. An empty query matches everyone, as 1.
 */
export function matchScore(profile: NDKUserProfile | null | undefined, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  let best = 0;
  for (const field of fieldsOf(profile)) {
    const f = field.toLowerCase();
    // A word of the name counts as its start: "Bob" in "Uncle Bob".
    if (f.startsWith(q) || f.split(/[\s._-]+/).some((w) => w.startsWith(q))) return 2;
    if (f.includes(q)) best = 1;
  }
  return best;
}

/**
 * Who to suggest: the people you follow first, the newest followed first, those whose name starts
 * with the query before those it is only inside; then people found by search; never yourself;
 * each once, `max` at most.
 */
export function rankPeople(
  follows: string[],
  profileOf: (pubkey: string) => NDKUserProfile | null | undefined,
  query: string,
  found: Array<{ pubkey: string; profile: NDKUserProfile }>,
  me: string | null,
  max = 6,
): string[] {
  const scored = [...follows]
    .reverse()
    .map((pk, order) => ({ pk, order, score: matchScore(profileOf(pk), query) }))
    .filter((x) => x.score > 0 && x.pk !== me)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((x) => x.pk);
  const out: string[] = [];
  for (const pk of scored) if (!out.includes(pk)) out.push(pk);
  if (query.trim()) {
    for (const { pubkey, profile } of found) {
      if (pubkey !== me && !out.includes(pubkey) && matchScore(profile, query) > 0) out.push(pubkey);
    }
  }
  return out.slice(0, max);
}
