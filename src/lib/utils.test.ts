import { describe, it, expect, vi, afterEach } from "vitest";
import { timeAgo, shortNpub, ownName, nameOf, initialOf, olderProfile, clipText, endSentence } from "./utils";

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

// The pair from the NIP-19 specification.
const HEX = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";

// What an account with no name is called. One string, wherever it is shown.
describe("shortNpub", () => {
  it("is the two ends of the public address, not of the hex key", () => {
    expect(shortNpub(HEX)).toBe("npub180c…h6w6");
  });

  it("is the same for the hex key, the hex key in capitals and the npub", () => {
    expect(shortNpub(HEX.toUpperCase())).toBe("npub180c…h6w6");
    expect(shortNpub(NPUB)).toBe("npub180c…h6w6");
  });

  it("shortens what is not a key as it is, and never throws", () => {
    expect(shortNpub("not-a-key-but-long-enough-to-cut")).toBe("not-a-ke…-cut");
    expect(shortNpub("p1")).toBe("p1");
    expect(shortNpub("")).toBe("");
    // 64 characters, not hex: shortened as it is, not encoded.
    expect(shortNpub("z".repeat(64))).toBe("zzzzzzzz…zzzz");
    // Hex, but not 64 characters.
    expect(shortNpub("ab".repeat(20))).toBe("abababab…abab");
  });

  it("leaves alone what is already as short as it would be made", () => {
    expect(shortNpub("1234567890123")).toBe("1234567890123");
    expect(shortNpub("12345678901234")).toBe("12345678…1234");
  });
});

describe("ownName", () => {
  it("prefers the display name, then the name", () => {
    expect(ownName({ displayName: "Ana K.", name: "ana" })).toBe("Ana K.");
    expect(ownName({ name: "ana" })).toBe("ana");
  });

  it("reads a profile as published too", () => {
    expect(ownName({ display_name: "Ana K." })).toBe("Ana K.");
  });

  it("does not take a row of spaces for a name", () => {
    expect(ownName({ displayName: "   ", name: "ana" })).toBe("ana");
    expect(ownName({ displayName: " \n\t ", name: "  " })).toBeNull();
  });

  it("trims the name it returns", () => {
    expect(ownName({ name: "  ana  " })).toBe("ana");
  });

  // `trim()` leaves these in place, and a name made of them is drawn as a blank.
  it("does not take characters that draw nothing for a name", () => {
    expect(ownName({ displayName: "\u200B\u200B", name: "ana" })).toBe("ana");
    expect(ownName({ name: "\u200B \u200D\uFEFF\u2060" })).toBeNull();
    // Direction marks, the invisible separator, the soft hyphen, a Hangul filler, the blank braille cell.
    for (const blank of ["\u200E", "\u200F", "\u2063", "\u180E", "\u00AD", "\u3164", "\u2800", "\u0000"]) {
      expect(ownName({ name: `${blank}${blank}` }), `U+${blank.codePointAt(0)!.toString(16)}`).toBeNull();
    }
    // One among real letters is the owner's business.
    expect(ownName({ name: "a\u200Dna" })).toBe("a\u200Dna");
  });

  it("does not take a number or an object for a name", () => {
    expect(ownName({ displayName: 42, name: { first: "ana" } })).toBeNull();
    expect(ownName({ displayName: ["ana"], name: "ana" })).toBe("ana");
  });

  it("is null without a profile", () => {
    expect(ownName(null)).toBeNull();
    expect(ownName(undefined)).toBeNull();
    expect(ownName("ana")).toBeNull();
    // A function has a `name` of its own.
    expect(ownName(function ana() { /* nothing */ })).toBeNull();
  });
});

describe("nameOf", () => {
  it("is the account's own name when it has one", () => {
    expect(nameOf({ name: "ana" }, HEX)).toBe("ana");
  });

  it("is the shortened public address when it has none", () => {
    expect(nameOf(null, HEX)).toBe("npub180c…h6w6");
    expect(nameOf({ name: "  " }, HEX)).toBe("npub180c…h6w6");
  });
});

// The letter in the round placeholder where a picture would be.
describe("initialOf", () => {
  it("is the first letter, in capitals", () => {
    expect(initialOf("ana")).toBe("A");
    expect(initialOf("  ana")).toBe("A");
    expect(initialOf("élan")).toBe("É");
  });

  it("is a whole emoji, not half of one", () => {
    expect(initialOf("😀 ana")).toBe("😀");
  });

  it("keeps a flag and a joined emoji together", () => {
    expect(initialOf("🇸🇮 ana")).toBe("🇸🇮");
    expect(initialOf("👩‍💻 ana")).toBe("👩‍💻");
  });

  it("is one character still when its capital would be two", () => {
    expect(initialOf("ßeta")).toBe("ß");
  });

  it("is null for no name", () => {
    expect(initialOf(null)).toBeNull();
    expect(initialOf("")).toBeNull();
    expect(initialOf("   ")).toBeNull();
  });
});

// What arrives from a relay is not always the newest there is.
describe("olderProfile", () => {
  it("is true for one dated before the one held", () => {
    expect(olderProfile({ created_at: 100 }, { created_at: 200 })).toBe(true);
  });

  it("is false for a newer one, and for one of the same moment", () => {
    expect(olderProfile({ created_at: 300 }, { created_at: 200 })).toBe(false);
    expect(olderProfile({ created_at: 200 }, { created_at: 200 })).toBe(false);
  });

  it("is true for nothing, against something", () => {
    expect(olderProfile(null, { created_at: 200 })).toBe(true);
    expect(olderProfile(undefined, {})).toBe(true);
  });

  it("is false against nothing held", () => {
    expect(olderProfile({ created_at: 100 }, null)).toBe(false);
    expect(olderProfile(null, null)).toBe(false);
    expect(olderProfile(null, undefined)).toBe(false);
  });

  it("is false when either has no date to go by", () => {
    expect(olderProfile({}, { created_at: 200 })).toBe(false);
    expect(olderProfile({ created_at: 100 }, {})).toBe(false);
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
