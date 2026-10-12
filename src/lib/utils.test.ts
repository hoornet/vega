import { describe, it, expect, vi, afterEach } from "vitest";
import { timeAgo, shortenPubkey, clipText, endSentence } from "./utils";

describe("timeAgo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns seconds for < 60s", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 30)).toBe("30s");
  });

  it("returns minutes for < 1h", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 300)).toBe("5m");
  });

  it("returns hours for < 1d", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 7200)).toBe("2h");
  });

  it("returns days for < 1w", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 86400 * 3)).toBe("3d");
  });

  it("returns weeks for >= 1w", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 604800 * 2)).toBe("2w");
  });

  it("returns 0s for current timestamp", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now)).toBe("0s");
  });
});

describe("shortenPubkey", () => {
  it("shortens a standard hex pubkey", () => {
    const key = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    expect(shortenPubkey(key)).toBe("abcdef12…7890");
  });

  it("handles short strings gracefully", () => {
    expect(shortenPubkey("abcd")).toBe("abcd…abcd");
  });
});

// Someone else's words, in a sentence of ours: a display name, a relay's error, a signer's.
describe("clipText", () => {
  it("leaves text that fits as it is", () => {
    expect(clipText("Alice", 40)).toBe("Alice");
    expect(clipText("x".repeat(40), 40)).toBe("x".repeat(40));
  });

  it("cuts what does not fit to the limit, ellipsis included", () => {
    const cut = clipText("x".repeat(41), 40);
    expect(cut).toBe(`${"x".repeat(39)}…`);
    expect(Array.from(cut)).toHaveLength(40);
  });

  // Cut in UTF-16 units, the last emoji was halved and shown as a broken glyph.
  it("cuts between characters, never through one", () => {
    expect(clipText("😀".repeat(50), 40)).toBe(`${"😀".repeat(39)}…`);
  });

  it("does not leave a space before the ellipsis", () => {
    expect(clipText(`${"z".repeat(38)} and more`, 40)).toBe(`${"z".repeat(38)}…`);
  });
});

describe("endSentence", () => {
  it("adds a full stop to words that have no ending", () => {
    expect(endSentence("rate-limited")).toBe("rate-limited.");
  });

  // Not "slow down…." and not "Stop!."
  it("leaves words that bring their own ending", () => {
    for (const said of ["blocked.", "slow down…", "Stop!", "why?"]) expect(endSentence(said)).toBe(said);
  });
});
