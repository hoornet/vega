// Display filters for the Articles view.
//
// Why this exists: on 2026-10-11 the Latest tab rendered the 80 newest kind
// 30023 events from the default relays with no filtering at all. Classified by
// hand: 30 were porn/SEO "gallery" spam, every one published from a key that
// has no kind 0 profile anywhere; 42 were an RSS-to-Nostr bridge republishing
// Russian and Ukrainian news sites, every one with a NIP-05 under the bridge's
// domain and a name ending in "(RSS Feed)"; 8 were anything else, and several
// of those were bots. "Newest from everyone" on an open network is a spam
// endpoint, so Latest applies the same mute, keyword and language filters as
// the main feed, plus two rules of its own that the data above justifies.
//
// Everything here is pure so it can be tested against real fixtures.

import { matchesScriptFilter } from "./language";

/** The subset of an author's kind 0 profile these filters read. */
export interface AuthorProfile {
  name?: string;
  displayName?: string;
  nip05?: string;
}

/**
 * Result of looking up an author's profile:
 *   undefined — not looked up yet (the article is held back, not shown then yanked)
 *   null      — looked up; no kind 0 came back from any relay
 *   object    — the profile
 */
export type ProfileLookup = AuthorProfile | null | undefined;

/** The fields of a kind 30023 event the filters need; structural so tests need no NDK. */
export interface ArticleLike {
  pubkey: string;
  tags: string[][];
  content: string;
}

/**
 * NIP-05 domains of RSS-to-Nostr bridges that post long-form in volume. A
 * bridge is identified by its NIP-05 domain first and its naming convention
 * second; the name check catches bridges we have not listed.
 */
export const RSS_BRIDGE_NIP05_DOMAINS = ["rss.nostr.twinkle.lol"];

export function isRssBridge(profile: AuthorProfile | null | undefined): boolean {
  if (!profile) return false;
  const nip05 = typeof profile.nip05 === "string" ? profile.nip05.toLowerCase() : "";
  const domain = nip05.includes("@") ? nip05.slice(nip05.lastIndexOf("@") + 1) : "";
  if (domain && RSS_BRIDGE_NIP05_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return true;
  }
  const name = `${typeof profile.displayName === "string" ? profile.displayName : ""} ${
    typeof profile.name === "string" ? profile.name : ""
  }`;
  return /\(\s*rss\s*feed\s*\)/i.test(name);
}

function tagValue(event: ArticleLike, name: string): string {
  return event.tags.find((t) => t[0] === name)?.[1] ?? "";
}

/** Title, summary and body joined — what keyword mutes and script detection look at. */
export function articleText(event: ArticleLike): string {
  return [tagValue(event, "title"), tagValue(event, "summary"), event.content].filter(Boolean).join("\n");
}

export interface ArticleFilterOptions {
  tab: "latest" | "following";
  mutedPubkeys: ReadonlySet<string>;
  contentMatchesMutedKeyword: (text: string) => boolean;
  /** The feed's script filter (`feedLanguageFilter`); null = off. */
  languageFilter: string | null;
  /** Hide RSS bridge reposts on the Latest tab. */
  hideRssBridges: boolean;
  /** Web of Trust set; applied on Latest when non-empty. */
  wotSet?: ReadonlySet<string>;
  profile: ProfileLookup;
}

/**
 * Mutes, keyword mutes and the language filter apply on both tabs, like the
 * main feed. The Latest tab additionally requires the author to have a profile
 * (the spam keys have none), drops RSS bridges when asked, and honours the Web
 * of Trust set when one is built. Following is the user's own list, so an RSS
 * bridge or profile-less account they chose to follow still shows there.
 */
export function shouldShowArticle(event: ArticleLike, o: ArticleFilterOptions): boolean {
  if (o.mutedPubkeys.has(event.pubkey)) return false;
  const text = articleText(event);
  if (o.contentMatchesMutedKeyword(text)) return false;
  if (!matchesScriptFilter(event.tags, text, o.languageFilter)) return false;
  if (o.tab === "following") return true;
  if (o.wotSet && o.wotSet.size > 0 && !o.wotSet.has(event.pubkey)) return false;
  if (o.profile === undefined || o.profile === null) return false;
  if (o.hideRssBridges && isRssBridge(o.profile)) return false;
  return true;
}
