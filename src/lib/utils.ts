import { nip19 } from "@nostr-dev-kit/ndk";

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}

/**
 * Cut someone else's words to `max` characters, with an ellipsis when cut.
 *
 * Counted in characters as read, not UTF-16 units: a cut through the middle
 * of an emoji leaves a broken glyph. A display name, a relay's error or a
 * signer's can be any length, and in a sentence of ours they get a limit.
 */
export function clipText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}

/** End a sentence that ends in someone else's words: a full stop, unless they brought their own ending. Not "…." and not "!.". */
export function endSentence(text: string): string {
  return /[.…!?]$/.test(text) ? text : `${text}.`;
}

/**
 * What an account with no name is called, everywhere in the app: the two
 * ends of its public address ("npub1z4t…t3pm").
 *
 * It used to be four different strings: eight hex characters, twelve, both
 * ends of the hex key, and both ends of the npub. A new account was
 * "npub1ksj…" in the sidebar and "b42581de…a3f3" on its own profile, and
 * neither matched the key onboarding had shown a moment before. The public
 * address is the one people copy and share, so that is the one shown.
 *
 * Takes a hex key or an npub. Anything else is returned shortened as it is.
 * Not cached: encoding takes a few microseconds, and it is only asked for
 * accounts that have no name.
 */
export function shortNpub(pubkey: string): string {
  const address = /^[0-9a-f]{64}$/i.test(pubkey) ? nip19.npubEncode(pubkey) : pubkey;
  return address.length > 13 ? `${address.slice(0, 8)}…${address.slice(-4)}` : address;
}

/**
 * The name an account gave itself, or null when it gave none.
 *
 * A profile is whatever its owner published: the name can be a number, an
 * object, a row of spaces, or characters that draw nothing. Only text with
 * something to see in it is a name. Takes the profile as NDK parses it
 * (`displayName`) or as it is published (`display_name`).
 */
export function ownName(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const fields = profile as Record<string, unknown>;
  for (const value of [fields.displayName, fields.display_name, fields.name]) {
    if (typeof value === "string" && value.replace(DRAWS_NOTHING, "")) return value.trim();
  }
  return null;
}

/**
 * Spaces, and what `trim()` leaves in place although it draws nothing:
 * format and control characters (zero-width spaces and joiners, direction
 * marks, the soft hyphen), the rest of what Unicode marks as ignorable (the
 * Hangul fillers), and the blank braille cell. A name made only of these is
 * shown as a blank.
 */
const DRAWS_NOTHING = /[\s\p{Cf}\p{Cc}\p{Default_Ignorable_Code_Point}\u2800]/gu;

/** The name to show for an account: its own, or its shortened public address. One fallback, everywhere. */
export function nameOf(profile: unknown, pubkey: string): string {
  return ownName(profile) ?? shortNpub(pubkey);
}

/**
 * The first character of a name, for the round placeholder where a picture
 * would be. A whole character as read: `charAt(0)` on a name that starts
 * with an emoji is half of one, drawn as a broken glyph.
 */
export function initialOf(name: string | null): string | null {
  const text = name?.trim();
  if (!text) return null;
  // A flag or a family emoji is several code points that read as one
  // character; the segmenter keeps them together. Every webview Vega runs in
  // has one. Without it, a code point is still never half a character.
  let first: string | undefined;
  if (graphemes) {
    for (const { segment } of graphemes.segment(text)) { first = segment; break; }
  } else {
    first = Array.from(text)[0];
  }
  if (!first) return null;
  // In capitals, unless that makes it longer: "ß" becomes "SS".
  const capital = first.toUpperCase();
  return capital.length === first.length ? capital : first;
}

/** `Intl.Segmenter`, as far as it is used here. The project's TypeScript library target predates it. */
type GraphemeSegmenter = new (locale: string | undefined, options: { granularity: "grapheme" }) => {
  segment(text: string): Iterable<{ segment: string }>;
};
const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;
/** Made once: it is asked on every draw of a placeholder avatar. */
const graphemes = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;

/**
 * Whether a profile that just arrived gives way to the one already held: it
 * is older, or it is nothing at all.
 *
 * What arrives from a relay is not always the newest there is. NDK ends a
 * fetch once most relays have answered, so a relay still holding the profile
 * before last can be the one that was heard; and a fetch started before the
 * owner saved their profile can finish after it. "Nothing" is far more often
 * a relay that was slow than an account with no profile. So nothing that
 * arrives replaces something newer, and nothing replaces something.
 *
 * Without a date on both there is no telling, and what arrived is taken.
 */
export function olderProfile(arrived: { created_at?: number } | null | undefined, held: { created_at?: number } | null | undefined): boolean {
  if (!held) return false;
  if (!arrived) return true;
  return typeof held.created_at === "number" && typeof arrived.created_at === "number" && arrived.created_at < held.created_at;
}

/**
 * Returns `url` only if it uses a safe http(s) scheme, otherwise "#".
 * Defense-in-depth for `href` sinks: blocks `javascript:`/`data:` URIs even if
 * a future change to the content parser stops scheme-constraining them upstream.
 */
export function safeHttpUrl(url: string): string {
  try {
    const scheme = new URL(url).protocol;
    return scheme === "http:" || scheme === "https:" ? url : "#";
  } catch {
    return "#";
  }
}

/**
 * Strips HTML tags, looping until the result is stable so split/nested tags
 * like `<scr<script>ipt>` cannot survive a single pass. Used to flatten
 * HTML-formatted text (e.g. podcast feed descriptions) into plain text.
 */
export function stripHtmlTags(input: string): string {
  let prev: string;
  let s = input;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, "");
  } while (s !== prev);
  return s;
}
