import { NDKEvent } from "@nostr-dev-kit/ndk";
import { parseContent } from "./parsing";
import { getParentEventId } from "./threadTree";

/**
 * Estimated rendered height (px) of a feed row — used as the virtualizer's
 * `estimateSize`.
 *
 * A flat estimate makes every row snap from the guess to its real height the
 * first time it's measured; on upward scroll each snap nudges the rows below
 * it, producing a subtle per-row flicker. A content-aware estimate keeps that
 * correction small enough to be imperceptible.
 *
 * Exactness is not required — within ~10-15% of the real height is plenty.
 * Constants are matched to NoteCard / NoteContent / ArticleCard layout, and
 * the note constants were measured against rendered rows (estimate versus
 * `getBoundingClientRect`) when the type scale changed the body text from
 * 13px to 15px. Re-measure when a card's layout or text size changes; do not
 * adjust them by eye.
 *
 * It counts what a note *shows*, not what was written: a link is shortened to
 * about 50 characters, a mention to a name, a reference to a title. Counting
 * the raw value put an 800-character URL down as fifteen lines of text.
 */

const BASE = 95;           // name row (24) + action band (44) + card padding (24) + divider; measured
const LINE = 24.375;       // one line of note text: text-body (15px) at leading-relaxed (1.625)
const REPLY_LINE = 24;     // "replying to @name" above a reply's text (18px line + 6px gap)
const QUOTE = 88;          // QuotePreview h-20 box + mt-2
const YOUTUBE_CARD = 98;   // mt-2 + p-3 + border + the 64px thumbnail
const LINK_CARD = 74;      // vimeo / spotify / tidal: mt-2 + p-3 + border + the 40px badge
const FOUNTAIN_CARD = 90;  // mt-2 + p-3 + border + three text lines (18 + 20 + 18)
const AUDIO = 72;          // mt-2 + p-3 + border + two text lines (20 + 18)
const MEDIA_GAP = 8;       // mt-2 above a media block
const CHAR = 7.6;          // room one character of wrapped body text takes: 7.2px measured, plus what word wrap wastes
const FIT = 7.2;           // measured width of a character at 15px, for "does this fit on one line"

// Zero-width, joiner, soft-hyphen, direction and variation characters take no
// room on screen. Spam notes are padded with hundreds of them, which counted
// as a dozen lines of text.
const INVISIBLE = /[­​-‏⁠-⁩︀-️﻿]/g;
// CJK, kana, Hangul and full-width forms are about twice as wide as Latin letters.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/g;

function lineCount(raw: string, charsPerLine: number): number {
  // Trailing blank lines are not rendered (the text block ends at its last
  // character), and a caption followed by an image leaves one behind.
  const text = raw.replace(INVISIBLE, "").trimEnd();
  if (!text.trim()) return 0;
  let lines = 0;
  for (const para of text.split("\n")) {
    const wide = para.match(WIDE)?.length ?? 0;
    lines += Math.max(1, Math.ceil((para.length + wide) / charsPerLine));
  }
  return lines;
}

function firstTag(event: NDKEvent, name: string): string {
  return event.tags.find((t) => t[0] === name)?.[1] ?? "";
}

/**
 * ArticleCard: a title of up to two lines, an optional summary of up to two
 * lines, a byline, an optional row of tags, and an optional 80px thumbnail.
 * A flat number was 18 to 28% low for a card with a summary and tags.
 */
function articleHeight(event: NDKEvent, mediaWidth: number): number {
  const image = firstTag(event, "image");
  // The card has no avatar column (+48), and a thumbnail takes 96px plus a 12px gap.
  const width = Math.max(120, mediaWidth + 48 - (image ? 108 : 0));
  // Title and summary are clamped at two lines, so the only question is one
  // line or two. The title is 17px semibold: about 8.7px a character.
  const titleLines = Math.min(2, Math.max(1, lineCount(firstTag(event, "title") || "Untitled", width / 8.7)));
  const summaryLines = Math.min(2, lineCount(firstTag(event, "summary"), width / FIT));
  const hasTags = event.tags.some((t) => t[0] === "t");
  let h = titleLines * 23.375 + 6;                    // text-title at leading-snug, mb-1.5
  if (summaryLines) h += summaryLines * LINE + 8;     // mb-2
  h += 20 + 6;                                        // byline, mb-1.5
  if (hasTags) h += 24;                               // one row of tag chips
  if (image) h = Math.max(h, 80);
  return Math.round(h + 25);                          // py-3 + divider
}

// Heights are cached per note, for one column width. A resize changes every
// wrapped line, so the cache is dropped when the width does.
const cache = new Map<string, number>();
let cachedWidth = -1;

/**
 * @param mediaWidth width (px) available to the note's content column —
 *        scroll-container width minus card padding and the avatar column.
 *        Must be a real width: the caller must not pass what a hidden list
 *        reports (see Feed.tsx).
 */
export function estimateNoteHeight(event: NDKEvent, mediaWidth: number): number {
  const width = Math.round(mediaWidth);
  if (width !== cachedWidth) {
    cache.clear();
    cachedWidth = width;
  }
  const id = event.id;
  if (id && cache.has(id)) return cache.get(id)!;

  const result = event.kind === 30023 ? articleHeight(event, width) : noteHeight(event, width);
  if (id) cache.set(id, result);
  return result;
}

function noteHeight(event: NDKEvent, mediaWidth: number): number {
  const charsPerLine = Math.max(20, Math.floor(mediaWidth / CHAR));
  const segments = parseContent(event.content);

  let h = BASE;
  // NoteCard shows the "replying to" line under the same condition.
  if (getParentEventId(event) && event.tags.some((t) => t[0] === "p")) h += REPLY_LINE;

  let images = 0;
  let videos = 0;
  let inlineText = "";

  for (const s of segments) {
    switch (s.type) {
      case "image": images++; break;
      case "video": videos++; break;
      case "audio": h += AUDIO; break;
      case "youtube": h += YOUTUBE_CARD; break;
      case "vimeo":
      case "spotify":
      case "tidal": h += LINK_CARD; break;
      case "fountain": h += FOUNTAIN_CARD; break;
      // A quoted note is a box below the text, plus an inline "↩ note" link where it was written.
      case "quote": h += QUOTE; inlineText += "↩ note "; break;
      // An article reference shows a link glyph and the article's title, or
      // 16 characters of the address until that resolves. Never the address.
      case "naddr": inlineText += "x".repeat(18) + " "; break;
      default: inlineText += (s.display ?? s.value ?? "") + " ";
    }
  }

  h += lineCount(inlineText, charsPerLine) * LINE;

  // Image grid — boxes use aspect-[4/3]; see ImageGrid in NoteContent.
  if (images === 1) {
    h += mediaWidth * 0.75 + MEDIA_GAP;
  } else if (images === 2) {
    h += ((mediaWidth - 4) / 2) * 0.75 + MEDIA_GAP;        // one row of two
  } else if (images >= 3) {
    h += (mediaWidth - 4) * 0.75 + 4 + MEDIA_GAP;          // two rows
  }

  // Videos — aspect-video (16:9).
  h += videos * ((mediaWidth * 9) / 16 + MEDIA_GAP);

  return Math.round(h);
}
