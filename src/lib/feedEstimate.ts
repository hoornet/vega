import { NDKEvent } from "@nostr-dev-kit/ndk";
import { parseContent } from "./parsing";

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
 * Constants are matched to NoteCard / NoteContent layout.
 */

const cache = new Map<string, number>();

const BASE = 96;        // avatar/name/time row + action row + vertical padding
const LINE = 21;        // one line of 13px / leading-relaxed body text
const QUOTE = 88;       // QuotePreview h-20 box + mt-2
const LINK_CARD = 70;   // youtube / vimeo / spotify / tidal / fountain row + mt-2
const AUDIO = 64;       // AudioBlock row + mt-2
const MEDIA_GAP = 8;    // mt-2 above a media block
const ARTICLE = 132;    // ArticleCard is near-uniform height

function textHeight(text: string, charsPerLine: number): number {
  if (!text.trim()) return 0;
  let lines = 0;
  for (const para of text.split("\n")) {
    lines += Math.max(1, Math.ceil(para.length / charsPerLine));
  }
  return lines * LINE;
}

/**
 * @param mediaWidth width (px) available to the note's content column —
 *        scroll-container width minus card padding and the avatar column.
 */
export function estimateNoteHeight(event: NDKEvent, mediaWidth: number): number {
  if (event.kind === 30023) return ARTICLE;

  const id = event.id;
  if (id && cache.has(id)) return cache.get(id)!;

  const charsPerLine = Math.max(20, Math.floor(mediaWidth / 7));
  const segments = parseContent(event.content);

  let h = BASE;
  let images = 0;
  let videos = 0;
  let inlineText = "";

  for (const s of segments) {
    switch (s.type) {
      case "image": images++; break;
      case "video": videos++; break;
      case "audio": h += AUDIO; break;
      case "youtube":
      case "vimeo":
      case "spotify":
      case "tidal":
      case "fountain": h += LINK_CARD; break;
      case "quote": h += QUOTE; break;
      default: inlineText += (s.value ?? "") + " ";
    }
  }

  h += textHeight(inlineText, charsPerLine);

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

  const result = Math.round(h);
  if (id) cache.set(id, result);
  return result;
}
