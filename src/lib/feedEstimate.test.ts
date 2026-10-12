import { describe, it, expect } from "vitest";
import { nip19, type NDKEvent } from "@nostr-dev-kit/ndk";
import { estimateNoteHeight } from "./feedEstimate";

// The estimate feeds the feed's virtual list. When it is far off, every row
// snaps from the guess to its real height on first measurement and the list
// visibly jumps on upward scroll. Each case below was a real miss.

const WIDTH = 580; // content column in a default window
const E = "f".repeat(64);
const P = "c".repeat(64);
let n = 0;
const note = (content: string, tags: string[][] = [], kind = 1) =>
  ({ id: `id-${n++}`, kind, content, tags, pubkey: "ab".repeat(32) }) as unknown as NDKEvent;
const height = (content: string, tags: string[][] = [], width = WIDTH) => estimateNoteHeight(note(content, tags), width);
const oneLine = height("hello");

describe("estimateNoteHeight, notes", () => {
  // Measured: a one-line note renders 119px tall (name row 24, text 24,
  // action band 44, card padding 24, divider 1 and rounding).
  it("is calibrated to a rendered one-line note", () => {
    expect(oneLine).toBe(119);
  });

  it("grows by a line of body text at a time", () => {
    expect(height("one\ntwo") - oneLine).toBeGreaterThanOrEqual(24);
    expect(height("one\ntwo") - oneLine).toBeLessThanOrEqual(25);
    expect(height("a\nb\nc\nd\ne") - oneLine).toBe(Math.round(95 + 5 * 24.375) - oneLine);
  });

  it("wraps long paragraphs by the column width", () => {
    const long = "word ".repeat(60); // 300 characters, 76 fit on a 580px line
    expect(height(long)).toBe(Math.round(95 + 4 * 24.375));
    expect(height(long, [], 300)).toBeGreaterThan(height(long));
  });

  // A reply shows "replying to @name" above its text. NoteCard needs both the
  // parent event and someone to name.
  it("adds the reply line only for a note with a parent event and an author to name", () => {
    expect(height("hello", [["e", E], ["p", P]]) - oneLine).toBe(24);
    expect(height("hello", [["e", E]])).toBe(oneLine);
    expect(height("hello", [["p", P]])).toBe(oneLine);
  });

  // A link is rendered shortened to about 50 characters. Counting the raw URL
  // put an 800-character link down as fifteen lines.
  it("counts a link by what is shown, not by its full length", () => {
    expect(height(`look https://example.com/${"a".repeat(780)}`)).toBe(oneLine);
  });

  // An article reference shows its title, or 16 characters until that loads.
  it("counts an article reference as a short link, not as its long address", () => {
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: P, identifier: "a-very-long-article-slug-".repeat(8), relays: ["wss://relay.example.com"] });
    expect(naddr.length).toBeGreaterThan(200);
    expect(height(`read this nostr:${naddr}`)).toBe(oneLine);
  });

  // Spam notes are padded with hundreds of zero-width characters.
  it("ignores characters that take no room", () => {
    for (const filler of ["‌​⁠‍", "️", "­", "⁦⁩"]) {
      const padded = "Small " + filler.repeat(Math.ceil(760 / filler.length)) + "progress today";
      expect(padded.length).toBeGreaterThan(700);
      expect(height(padded), JSON.stringify(filler)).toBe(oneLine);
    }
  });

  it("gives wide scripts twice the room per character", () => {
    // 76 Latin characters fill one 580px line; 76 CJK characters need two.
    expect(height("a".repeat(76))).toBe(oneLine);
    expect(height("漢".repeat(76)) - oneLine).toBeGreaterThanOrEqual(24);
    expect(height("漢".repeat(38))).toBe(oneLine);
    // 39 of them are 78 Latin widths: one more than fits
    expect(height("漢".repeat(39)) - oneLine).toBeGreaterThanOrEqual(24);
  });

  it("adds a 4:3 frame for one image, half of that for two, and 16:9 for a video", () => {
    const bare = 95; // no text line
    expect(height("https://example.com/a.jpg")).toBe(Math.round(bare + WIDTH * 0.75 + 8));
    expect(height("https://example.com/a.jpg https://example.com/b.jpg")).toBe(Math.round(bare + ((WIDTH - 4) / 2) * 0.75 + 8));
    expect(height("https://example.com/a.mp4")).toBe(Math.round(bare + (WIDTH * 9) / 16 + 8));
  });

  // The text block ends at its last character: "caption\n<image>" is one line of text.
  it("does not count the blank line a caption leaves before its image", () => {
    const captioned = height("caption\nhttps://example.com/a.jpg");
    expect(captioned - height("https://example.com/a.jpg")).toBeGreaterThanOrEqual(24);
    expect(captioned - height("https://example.com/a.jpg")).toBeLessThanOrEqual(25);
  });

  // A quoted note is a box under the text and an inline "↩ note" link.
  it("counts a quote as its box and the line that links to it", () => {
    const quoted = height(`nostr:${nip19.noteEncode(E)}`);
    expect(quoted).toBe(Math.round(95 + 88 + 24.375));
    // with a comment above it, the link shares no line with the comment's text
    expect(height(`look at this\nnostr:${nip19.noteEncode(E)}`)).toBe(Math.round(95 + 88 + 2 * 24.375));
  });

  it("gives a link card the height of its own kind", () => {
    const bare = 95;
    expect(height("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(bare + 98);
    expect(height("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")).toBe(bare + 74);
  });

  // A resize changes where every line wraps. An estimate kept from another
  // width was reused for the life of the session.
  it("does not reuse an estimate made for a different column width", () => {
    const same = note("word ".repeat(60));
    const wide = estimateNoteHeight(same, 580);
    const narrow = estimateNoteHeight(same, 300);
    expect(narrow).toBeGreaterThan(wide);
    expect(estimateNoteHeight(same, 580)).toBe(wide);
  });
});

describe("estimateNoteHeight, article cards", () => {
  const article = (tags: string[][]) => estimateNoteHeight(note("body ".repeat(500), tags, 30023), WIDTH);

  it("does not depend on the article's body", () => {
    const tags = [["title", "A title"]];
    expect(estimateNoteHeight(note("short", tags, 30023), WIDTH)).toBe(estimateNoteHeight(note("# long ".repeat(900), tags, 30023), WIDTH));
  });

  // Title 23, gap 6, byline 20, gap 6, card padding and divider 25.
  it("is calibrated to a card with a one-line title and nothing else", () => {
    expect(article([["title", "A title"]])).toBe(Math.round(23.375 + 6 + 20 + 6 + 25));
  });

  it("adds the summary, up to two lines, and the row of tags", () => {
    const bare = article([["title", "A title"]]);
    const oneLineSummary = article([["title", "A title"], ["summary", "Short."]]);
    const longSummary = article([["title", "A title"], ["summary", "words ".repeat(200)]]);
    expect(oneLineSummary - bare).toBe(Math.round(23.375 + 6 + 24.375 + 8 + 20 + 6 + 25) - bare);
    expect(longSummary - oneLineSummary).toBeGreaterThanOrEqual(24);
    expect(longSummary - oneLineSummary).toBeLessThanOrEqual(25);
    expect(article([["title", "A title"], ["t", "nostr"]]) - bare).toBe(24);
  });

  it("clamps a long title at two lines", () => {
    const two = article([["title", "word ".repeat(30)]]);
    expect(article([["title", "word ".repeat(300)]])).toBe(two);
    expect(two).toBeGreaterThan(article([["title", "A title"]]));
  });

  it("is at least as tall as its thumbnail", () => {
    expect(article([["title", "A title"], ["image", "https://example.com/c.jpg"]])).toBe(80 + 25);
  });
});
