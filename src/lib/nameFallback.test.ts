import { describe, it, expect } from "vitest";

// An account with no name is called one thing everywhere: `shortNpub`, by way
// of `nameOf` (lib/utils.ts). Before October 2026 each view shortened the key
// its own way (eight hex characters, twelve, both ends of the hex key, both
// ends of the npub), and took the letter in the placeholder avatar from
// whichever it had made: a new account was "npub1ksj…" with an "N" in the
// sidebar and "b42581de…a3f3" with a "B" on its own profile.
//
// This reads the sources so the next view does not start a fifth. It goes by
// names: it sees a cut made on something called `pubkey` or `npub`, and a
// letter taken from something called `name`. A key held in a variable called
// `pk` or `hex` gets past it. It is a tripwire for the usual way of writing
// it, not a proof.

const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.*"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * A key cut short: `.slice(0,`, `.substring(0,` or `.substr(0,` on something
 * whose name says it is a key. A list of keys (`pubkeys.slice(0, 50)`) is
 * not a key: the plural is only taken when one of them is picked out first.
 */
export const CUT_KEY = /(pubkey|npub)(?!s\s*\??\.)\w*[^;\n]{0,12}?\.\s*(slice|substring|substr)\(\s*0\s*,/i;
/** The first character of something whose name says it is a name: `.charAt(0)`, `.at(0)`, `[0]`, `Array.from(…)[0]`. */
export const FIRST_OF_NAME = /\b\w*name\b[^;\n=]{0,24}?(\.\s*charAt\(\s*0\s*\)|\.\s*at\(\s*0\s*\)|\[0\])|Array\.from\(\s*\w*name\w*\s*\)\s*\[0\]/i;

/** Source lines that match, as "file:line: text". Lines that only write to the debug log are left out. */
function lines(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const [file, src] of Object.entries(sources)) {
    src.split("\n").forEach((text, i) => {
      if (pattern.test(text) && !/\bdebug\.(log|warn|error)\(/.test(text)) found.push(`${file.replace("../", "src/")}:${i + 1}: ${text.trim()}`);
    });
  }
  return found;
}

describe("one fallback for an account with no name", () => {
  it("reads the sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(Object.keys(sources).some((file) => file.endsWith("components/feed/NoteCard.tsx"))).toBe(true);
    expect(Object.keys(sources).some((file) => file.includes(".test."))).toBe(false);
  });

  it("no view cuts a key short by hand", () => {
    expect(lines(CUT_KEY)).toEqual([]);
  });

  it("no view takes the placeholder letter from whatever it shows as the name", () => {
    expect(lines(FIRST_OF_NAME)).toEqual([]);
  });

  it("the old helpers are gone", () => {
    expect(lines(/\b(shortenPubkey|profileName)\b/)).toEqual([]);
  });
});

// The patterns themselves: what they catch, and what they leave alone.
describe("the patterns", () => {
  it("catch a key cut by hand, however it is reached", () => {
    for (const line of [
      'const name = pubkey.slice(0, 8) + "…";',
      "authorPubkey.slice(0, 12)",
      "{nip11.pubkey.slice(0, 16)}…",
      "event.pubkey?.slice(0, 8)",
      "event.pubkey!.slice( 0 , 8)",
      "a.npub.substring(0, 12)",
      '(a.npub || "").slice(0, 8)',
      "npubs[i].substr(0, 8)",
    ]) expect(CUT_KEY.test(line), line).toBe(true);
  });

  it("leave other cuts alone", () => {
    for (const line of [
      "event.content.slice(0, 160)",
      "pubkeys.slice(0, 50)",
      "const authors = followPubkeys.slice(i, i + CHUNK);",
      "shortNpub(pubkey)",
      "relays.slice(0, 4).map((r) => r.pubkey)",
    ]) expect(CUT_KEY.test(line), line).toBe(false);
  });

  it("catch a letter taken from a name by hand", () => {
    for (const line of [
      "{name.charAt(0).toUpperCase()}",
      "{authorName.charAt(0)}",
      '(account.name || "?").charAt(0)',
      "displayName.at(0)",
      "const initial = name[0];",
      "Array.from(name)[0]",
    ]) expect(FIRST_OF_NAME.test(line), line).toBe(true);
  });

  it("leave other first things alone", () => {
    for (const line of [
      "className={sizes[0]}",
      "const first = names[0];",
      "<AvatarInitial profile={profile} />",
      "t.charAt(0).toUpperCase() + t.slice(1)",
      "fileName = parts.at(-1)",
    ]) expect(FIRST_OF_NAME.test(line), line).toBe(false);
  });
});
