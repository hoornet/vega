import { NDKEvent, nip19 } from "@nostr-dev-kit/ndk";

// What an article's event says about itself, and the text shown for it
// outside the body: the card's summary, the reading time, a title the body
// repeats. Pure, so the card and the reader agree and each rule has a test.

export function getTag(event: NDKEvent, name: string): string {
  return event.tags.find((t) => t[0] === name)?.[1] ?? "";
}

export function getTags(event: NDKEvent, name: string): string[] {
  return event.tags.filter((t) => t[0] === name).map((t) => t[1]).filter(Boolean);
}

/** The `kind:pubkey:d` address, or null for an article with no `d` tag. */
export function articleAddr(event: NDKEvent): string | null {
  const d = getTag(event, "d");
  return d ? `${event.kind ?? 30023}:${event.pubkey}:${d}` : null;
}

/** The naddr of an article, or "" when it has no `d` tag. */
export function articleNaddr(event: NDKEvent): string {
  const d = getTag(event, "d");
  if (!d) return "";
  return nip19.naddrEncode({ identifier: d, pubkey: event.pubkey, kind: event.kind ?? 30023 });
}

/** When the article says it was published, else when the event was made. */
export function publishedAt(event: NDKEvent): number | null {
  return parseInt(getTag(event, "published_at")) || event.created_at || null;
}

const WORDS_A_MINUTE = 230;

/** Minutes to read the body, never less than one. */
export function readingMinutes(content: string | undefined): number {
  const words = content?.trim() ? content.trim().split(/\s+/).length : 0;
  return Math.max(1, Math.ceil(words / WORDS_A_MINUTE));
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Does `text` open with the title, as its own line or sentence? */
function opensWithTitle(text: string, title: string): boolean {
  const t = squash(title);
  if (!t) return false;
  const head = squash(text).slice(0, t.length);
  if (head !== t) return false;
  const rest = text.replace(/\s+/g, " ").trim().slice(t.length);
  return rest === "" || /^[\s.:!?,;–—-]/.test(rest);
}

/** Drop the title from the front of `text` when the text begins by repeating it. */
export function dropLeadingTitle(text: string, title: string): string {
  if (!opensWithTitle(text, title)) return text;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.slice(squash(title).length).replace(/^[\s.:!?,;–—-]+/, "");
}

// A first-level heading at the top of the body: `# Title` (ATX, an optional
// closing run of #) or `Title` over a line of `=` (Setext). Blank lines before
// it are allowed. Every run is bounded, so a hostile body costs nothing: with
// an unbounded `[ \t]*` after the lazy title, 100 KB of spaces took 250 ms.
const BLANK_LINES = "(?:[ \\t]{0,40}\\r?\\n)*";
const ATX_TITLE = new RegExp(`^${BLANK_LINES}[ \\t]{0,3}#[ \\t]{1,40}([^\\r\\n]{1,500}?)[ \\t]{0,40}#{0,40}[ \\t]{0,40}(?:\\r?\\n|$)`);
const SETEXT_TITLE = new RegExp(`^${BLANK_LINES}[ \\t]{0,3}([^\\r\\n]{1,500}?)[ \\t]{0,40}\\r?\\n[ \\t]{0,3}={1,500}[ \\t]{0,40}(?:\\r?\\n|$)`);

/** A heading's words without the marks a writer may have put on them: `# *Title*`, `# [Title](url)`. */
const headingWords = (text: string) => squash(text.replace(/\[([^\]\n]{0,300})\]\([^)\n]{0,2000}\)/g, "$1").replace(/[*_`]/g, ""));

/**
 * A body that opens with a heading equal to the title would show the title
 * twice, the second time as a section heading. Remove that heading, from the
 * markdown and before it is rendered: the rendered HTML is DOMPurify's, and is
 * not taken apart afterwards. Only a first heading: a repeated title deeper in
 * the text is the writer's to keep.
 */
export function stripLeadingTitle(markdown: string, title: string): string {
  const want = squash(title);
  if (!want) return markdown;
  const match = ATX_TITLE.exec(markdown) ?? SETEXT_TITLE.exec(markdown);
  if (!match || headingWords(match[1]) !== want) return markdown;
  // And the blank lines that followed it, or the body would start with a gap.
  return markdown.slice(match[0].length).replace(/^(?:[ \t]{0,40}\r?\n){0,50}/, "");
}

/** How much of a body is read for its summary. A summary is 160 characters; nothing past this can be in it. */
export const SUMMARY_SCAN = 4000;

/**
 * The start of the body as plain words: markdown marks, links' addresses,
 * images and code fences taken out. Only the first `SUMMARY_SCAN` characters
 * are read, and every pattern is bounded to a line or a length: a relay can
 * hold any kind 30023 at all, and this runs for every card in a list. Written
 * with `^\s*` and unbounded brackets it took seconds on 100 KB of newlines.
 */
export function plainWords(markdown: string): string {
  return markdown
    .slice(0, SUMMARY_SCAN)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/!\[[^\]\n]{0,300}\]\([^)\n]{0,2000}\)/g, " ")
    .replace(/\[([^\]\n]{0,300})\]\([^)\n]{0,2000}\)/g, "$1")
    .replace(/<[^<>\n]{1,200}>/g, " ")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]{0,8}(?:[-*+]|\d{1,9}[.)])[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}(?:[-*_][ \t]{0,3}){3,}$/gm, " ")
    .replace(/`([^`\n]{0,500})`/g, "$1")
    .replace(/(\*\*|__)([^*_\n]{0,500})\1/g, "$2")
    .replace(/(\*|_)([^*_\n]{0,500})\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

export const SUMMARY_LENGTH = 160;

/**
 * The two lines under a card's title: the writer's summary, or, when there is
 * none, the start of the body. Either way a leading repeat of the title goes:
 * the card already shows it.
 */
export function cardSummary(summary: string, content: string, title: string): string {
  const own = dropLeadingTitle(summary.replace(/\s+/g, " ").trim(), title);
  if (own) return own;
  const words = dropLeadingTitle(plainWords(content), title);
  if (!words) return "";
  const chars = Array.from(words);
  if (chars.length <= SUMMARY_LENGTH) return words;
  const cut = chars.slice(0, SUMMARY_LENGTH).join("");
  const atWord = cut.lastIndexOf(" ");
  return (atWord > SUMMARY_LENGTH / 2 ? cut.slice(0, atWord) : cut).replace(/[\s,;:.–—-]+$/, "") + "…";
}

export interface ImageFit {
  /** Never drawn wider than this: the picture's own width. The column is the other limit. */
  maxWidth: number;
  /** `w / h`, for `aspect-ratio`. */
  aspectRatio: string;
}

/**
 * How a body image is drawn once its size is known. Before that it has a 16:9
 * box (the WebKitGTK scroll-lock workaround in index.css). With the size known
 * the box takes the picture's own shape, and a picture narrower than the
 * column is shown at its own width instead of being blown up. A maximum, not
 * a width: the column can change after the picture loaded.
 */
export function fitArticleImage(naturalWidth: number, naturalHeight: number): ImageFit | null {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return null;
  return { maxWidth: naturalWidth, aspectRatio: `${naturalWidth} / ${naturalHeight}` };
}

/**
 * How far through the text the reader is, 0 to 100. `bodyEnd` is where the
 * article's text ends, in the scroll container's coordinates (its distance
 * from the top of the scrolled content), so what comes after the text, the
 * footer, the writer and their other articles, does not count: measured over
 * the whole container, the last paragraph of a short article sat at 60%. A
 * body that fits the pane is read in full.
 */
export function readingProgress(scrollTop: number, clientHeight: number, bodyEnd: number): number {
  const max = bodyEnd - clientHeight;
  if (max <= 0) return 100;
  return Math.max(0, Math.min(100, (scrollTop / max) * 100));
}
