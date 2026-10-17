import { describe, it, expect } from "vitest";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { articleAddr, cardSummary, dropLeadingTitle, fitArticleImage, plainWords, publishedAt, readingMinutes, readingProgress, stripLeadingTitle, SUMMARY_LENGTH, SUMMARY_SCAN } from "./article";

const event = (tags: string[][], extra: Partial<NDKEvent> = {}) => ({ kind: 30023, pubkey: "pk", tags, created_at: 500, ...extra }) as unknown as NDKEvent;

describe("article metadata", () => {
  it("builds the address from kind, author and d tag, and has none without a d tag", () => {
    expect(articleAddr(event([["d", "my-post"]]))).toBe("30023:pk:my-post");
    expect(articleAddr(event([["title", "x"]]))).toBeNull();
  });

  it("prefers published_at and falls back to created_at", () => {
    expect(publishedAt(event([["published_at", "1700"]]))).toBe(1700);
    expect(publishedAt(event([["published_at", "soon"]]))).toBe(500);
    expect(publishedAt(event([]))).toBe(500);
  });

  it("counts reading minutes at 230 words a minute, never under one", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes(undefined)).toBe(1);
    expect(readingMinutes(Array(231).fill("word").join(" "))).toBe(2);
    expect(readingMinutes(Array(460).fill("word").join(" "))).toBe(2);
    expect(readingMinutes(Array(461).fill("word").join(" "))).toBe(3);
  });
});

describe("a body that repeats the title", () => {
  it("loses a first heading equal to the title, whatever its case, spacing or marks", () => {
    expect(stripLeadingTitle("# Hello & welcome\n\nBody", "hello & Welcome")).toBe("Body");
    expect(stripLeadingTitle("\n\n#  *Hello*  there ##\nBody", "Hello there")).toBe("Body");
    expect(stripLeadingTitle("# [Hello](https://x.y)\nBody", "Hello")).toBe("Body");
    expect(stripLeadingTitle("Hello there\n===========\n\nBody", "Hello there")).toBe("Body");
  });

  it("keeps a heading that says something else, a second-level one, and a repeat deeper in the text", () => {
    expect(stripLeadingTitle("# Other\nx", "Hello")).toBe("# Other\nx");
    expect(stripLeadingTitle("## Hello\nx", "Hello")).toBe("## Hello\nx");
    expect(stripLeadingTitle("intro\n\n# Hello\nx", "Hello")).toBe("intro\n\n# Hello\nx");
    expect(stripLeadingTitle("#Hello\nx", "Hello")).toBe("#Hello\nx");
  });

  it("is left alone with no title, and takes no time on a hostile body", () => {
    expect(stripLeadingTitle("# \nx", "")).toBe("# \nx");
    const t0 = performance.now();
    stripLeadingTitle("\n".repeat(100_000) + "# " + "a".repeat(100_000), "b");
    stripLeadingTitle(" ".repeat(100_000) + "=".repeat(100_000), "b");
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe("plain words", () => {
  it("takes out headings, marks, links' addresses, images, code and html", () => {
    const md = "# Title\n\nSome **bold** and _soft_ words with a [link](https://x.y) and ![pic](https://img).\n\n```js\ncode();\n```\n\n> quoted\n\n- one\n- two\n\n<br>end";
    expect(plainWords(md)).toBe("Title Some bold and soft words with a link and . quoted one two end");
  });

  it("reads only the start of the body", () => {
    const md = "a ".repeat(SUMMARY_SCAN) + "ZZZ";
    expect(plainWords(md)).not.toContain("ZZZ");
  });

  // A relay can hold any kind 30023, and this runs for every card in a list.
  // With `^\s*` and unbounded brackets, 100 KB of newlines took 12 seconds.
  it("takes no measurable time on hostile input", () => {
    const hostile = ["\n".repeat(100_000), "[".repeat(100_000), "\n \n".repeat(30_000), "<".repeat(100_000), "- ".repeat(50_000), "*".repeat(100_000), "![".repeat(50_000) + "](" .repeat(1000)];
    for (const input of hostile) {
      const t0 = performance.now();
      cardSummary("", input, "Title");
      expect(performance.now() - t0).toBeLessThan(50);
    }
  });
});

describe("the card's summary", () => {
  it("is the writer's summary, flattened", () => {
    expect(cardSummary("  A short\n take ", "body", "T")).toBe("A short take");
  });

  it("drops a summary's leading repeat of the title", () => {
    expect(cardSummary("Vega 0.15: what changed. The release…", "", "Vega 0.15")).toBe("what changed. The release…");
    expect(cardSummary("Vega 0.15 — what changed", "", "Vega 0.15")).toBe("what changed");
    // Not when the title is only the start of a longer word.
    expect(cardSummary("Vegan recipes", "", "Vega")).toBe("Vegan recipes");
  });

  it("falls back to the start of the body, without the title, cut at a word with an ellipsis", () => {
    const body = "# My post\n\n" + Array(60).fill("word").join(" ") + " end";
    const out = cardSummary("", body, "My post");
    expect(out.startsWith("word word")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(Array.from(out).length).toBeLessThanOrEqual(SUMMARY_LENGTH + 1);
    // Cut between words, never through one.
    expect(out).toMatch(/ word…$/);
  });

  it("returns a short body whole, and nothing for an empty one", () => {
    expect(cardSummary("", "Just this.", "T")).toBe("Just this.");
    expect(cardSummary("", "", "T")).toBe("");
    expect(cardSummary("", "# T", "T")).toBe("");
  });

  it("counts characters, not code units, so an emoji is not cut in half", () => {
    const body = "😀".repeat(SUMMARY_LENGTH + 5);
    const out = cardSummary("", body, "");
    expect(Array.from(out).length).toBe(SUMMARY_LENGTH + 1);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("drop leading title", () => {
  it("needs the title to end as a word", () => {
    expect(dropLeadingTitle("Title: rest", "Title")).toBe("rest");
    expect(dropLeadingTitle("Title rest", "Title")).toBe("rest");
    expect(dropLeadingTitle("Titles rest", "Title")).toBe("Titles rest");
    expect(dropLeadingTitle("Title", "Title")).toBe("");
  });
});

describe("fitting a body image", () => {
  it("keeps the picture's shape and never widens it past its own size", () => {
    expect(fitArticleImage(1600, 900)).toEqual({ maxWidth: 1600, aspectRatio: "1600 / 900" });
    expect(fitArticleImage(200, 300)).toEqual({ maxWidth: 200, aspectRatio: "200 / 300" });
  });

  it("has nothing to say before the size is known", () => {
    expect(fitArticleImage(0, 0)).toBeNull();
    expect(fitArticleImage(NaN, 100)).toBeNull();
  });
});

describe("reading progress", () => {
  it("is measured to the end of the text, not of the page", () => {
    // Pane 500 tall, text ends at 1500, the writer's card and more below it.
    expect(readingProgress(0, 500, 1500)).toBe(0);
    expect(readingProgress(500, 500, 1500)).toBe(50);
    expect(readingProgress(1000, 500, 1500)).toBe(100);
    expect(readingProgress(1400, 500, 1500)).toBe(100);
  });

  it("is complete when the text fits the pane", () => {
    expect(readingProgress(0, 500, 400)).toBe(100);
    expect(readingProgress(0, 500, 500)).toBe(100);
  });
});
