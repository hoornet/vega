import { describe, it, expect } from "vitest";
import { nip19 } from "@nostr-dev-kit/ndk";
import { mentionAt, insertMention, mentionedPubkeys, matchScore, rankPeople } from "./mentions";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);

describe("mentionAt", () => {
  it("finds the @word the caret ends", () => {
    expect(mentionAt("hi @al", 6, false)).toEqual({ start: 3, end: 6, query: "al" });
    expect(mentionAt("@", 1, false)).toEqual({ start: 0, end: 1, query: "" });
    expect(mentionAt("thanks (@bo", 11, false)?.query).toBe("bo");
  });

  it("is not an email address, a word being edited, or a pasted key", () => {
    expect(mentionAt("mail jure@getalby", 17, false)).toBeNull();
    expect(mentionAt("hi @alice there", 6, false)).toBeNull();
    expect(mentionAt("hi @npub1abc", 12, false)).toBeNull();
    expect(mentionAt("hi @al ", 7, false)).toBeNull();
  });

  it("leaves @vega at the start of the box to the assistant, and every beginning of it", () => {
    for (const typed of ["@", "@v", "@ve", "@veg", "@vega", "  @VEG"]) expect(mentionAt(typed, typed.length, true)).toBeNull();
    // Past where it could still be @vega, or anywhere else in the text, it is a mention.
    expect(mentionAt("@vex", 4, true)?.query).toBe("vex");
    expect(mentionAt("hi @ve", 6, true)?.query).toBe("ve");
    // With the assistant off, @vega is a name like any other.
    expect(mentionAt("@ve", 3, false)?.query).toBe("ve");
  });
});

describe("insertMention", () => {
  it("writes the person's npub in place of the @word, with a space after, and puts the caret there", () => {
    const text = "hi @al";
    const out = insertMention(text, mentionAt(text, 6, false)!, ALICE);
    const npub = nip19.npubEncode(ALICE);
    expect(out.text).toBe(`hi nostr:${npub} `);
    expect(out.caret).toBe(out.text.length);
  });

  it("keeps what follows the caret, without a second space", () => {
    const text = "hi @al nice";
    const at = { start: 3, end: 6, query: "al" };
    const out = insertMention(text, at, ALICE);
    expect(out.text).toBe(`hi nostr:${nip19.npubEncode(ALICE)} nice`);
  });
});

describe("mentionedPubkeys", () => {
  it("reads npubs and nprofiles once each, and ignores broken ones", () => {
    const text = `nostr:${nip19.npubEncode(ALICE)} and nostr:${nip19.nprofileEncode({ pubkey: BOB })} and nostr:${nip19.npubEncode(ALICE)} nostr:npub1broken`;
    expect(mentionedPubkeys(text)).toEqual([ALICE, BOB]);
  });
});

describe("matchScore and rankPeople", () => {
  const profiles: Record<string, { name?: string; displayName?: string; nip05?: string }> = {
    [ALICE]: { name: "alice", nip05: "alice@example.com" },
    [BOB]: { displayName: "Uncle Bob" },
    [CAROL]: { name: "carolina" },
  };
  const profileOf = (pk: string) => profiles[pk] as never;

  it("a name or a word of it starting with the query beats one that only contains it", () => {
    expect(matchScore(profileOf(BOB), "bob")).toBe(2);
    expect(matchScore(profileOf(CAROL), "lin")).toBe(1);
    expect(matchScore(profileOf(ALICE), "zzz")).toBe(0);
    expect(matchScore(undefined, "a")).toBe(0);
  });

  it("follows first, newest followed first, best match first, never yourself", () => {
    const follows = [ALICE, BOB, CAROL];
    expect(rankPeople(follows, profileOf, "", [], null)).toEqual([CAROL, BOB, ALICE]);
    expect(rankPeople(follows, profileOf, "a", [], null)).toEqual([ALICE, CAROL]);
    expect(rankPeople(follows, profileOf, "", [], CAROL)).toEqual([BOB, ALICE]);
  });

  it("people found by search come after the follows, once", () => {
    const dave = "d".repeat(64);
    const found = [{ pubkey: dave, profile: { name: "alfred" } as never }, { pubkey: ALICE, profile: { name: "alice" } as never }];
    expect(rankPeople([ALICE], profileOf, "al", found, null)).toEqual([ALICE, dave]);
  });
});
