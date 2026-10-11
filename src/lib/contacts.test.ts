import { describe, it, expect } from "vitest";
import {
  contactPubkeys,
  newerContactList,
  nextContactTags,
  parseStoredContactList,
  summarizeContactAnswers,
  type ContactListSnapshot,
  type RelayContactAnswer,
} from "./contacts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

const list = (createdAt: number, pubkeys: string[] = [A]): ContactListSnapshot => ({
  tags: pubkeys.map((pk) => ["p", pk]),
  content: "",
  createdAt,
});
const answer = (over: Partial<RelayContactAnswer> = {}): RelayContactAnswer => ({
  lists: [],
  answered: true,
  local: false,
  ...over,
});

describe("contactPubkeys", () => {
  it("returns followed pubkeys in order, ignoring other tags and duplicates", () => {
    expect(contactPubkeys([["p", A, "wss://relay.example", "alice"], ["t", "nostr"], ["p", B], ["p", A], ["p"]])).toEqual([A, B]);
  });
});

describe("newerContactList", () => {
  it("picks the later one and tolerates a missing side", () => {
    const older = list(100);
    const newer = list(200);
    expect(newerContactList(older, newer)).toBe(newer);
    expect(newerContactList(newer, older)).toBe(newer);
    expect(newerContactList(null, older)).toBe(older);
    expect(newerContactList(older, null)).toBe(older);
    expect(newerContactList(null, null)).toBeNull();
  });
});

describe("summarizeContactAnswers", () => {
  it("returns the newest list any relay sent", () => {
    const newest = list(300, [A, B]);
    const result = summarizeContactAnswers([answer({ lists: [list(100)] }), answer({ lists: [newest] }), answer()]);
    expect(result).toEqual({ status: "found", list: newest });
  });

  // The 2026-10-11 case: three relays answered "nothing" and the fourth, the
  // only one holding the list, was slow. That must not read as "follows nobody".
  it("is unknown, not none, when a relay stayed silent and nobody returned a list", () => {
    const result = summarizeContactAnswers([answer(), answer(), answer(), answer({ answered: false })]);
    expect(result).toEqual({ status: "unknown" });
  });

  it("is none only when every remote relay finished and none has a list", () => {
    expect(summarizeContactAnswers([answer(), answer(), answer(), answer()])).toEqual({ status: "none" });
  });

  it("uses a list from a relay even if others stayed silent", () => {
    const found = list(50);
    expect(summarizeContactAnswers([answer({ lists: [found] }), answer({ answered: false })])).toEqual({ status: "found", list: found });
  });

  it("does not let the embedded relay vouch that there is no list", () => {
    // Offline: only the embedded relay answers, instantly, with nothing.
    expect(summarizeContactAnswers([answer({ local: true })])).toEqual({ status: "unknown" });
    expect(summarizeContactAnswers([answer({ local: true }), answer({ answered: false })])).toEqual({ status: "unknown" });
  });

  it("does accept a list the embedded relay holds", () => {
    const cached = list(70);
    expect(summarizeContactAnswers([answer({ local: true, lists: [cached] }), answer({ answered: false })])).toEqual({ status: "found", list: cached });
  });

  it("is unknown when nothing was asked", () => {
    expect(summarizeContactAnswers([])).toEqual({ status: "unknown" });
  });
});

describe("nextContactTags", () => {
  const base = [["p", A, "wss://relay.example", "alice"], ["t", "nostr"], ["p", B]];

  it("adds a follow at the end and keeps everything else as it was", () => {
    expect(nextContactTags(base, { add: C })).toEqual([...base, ["p", C]]);
  });

  it("does not add someone twice", () => {
    expect(nextContactTags(base, { add: A })).toEqual(base);
  });

  it("removes only that person, keeping hints, petnames and non-p tags", () => {
    expect(nextContactTags(base, { remove: B })).toEqual([["p", A, "wss://relay.example", "alice"], ["t", "nostr"]]);
  });

  it("removing someone who is not followed changes nothing", () => {
    expect(nextContactTags(base, { remove: C })).toEqual(base);
  });

  it("never mutates the base it was given", () => {
    const frozen = JSON.stringify(base);
    const next = nextContactTags(base, { add: C });
    next[0].push("mutated");
    expect(JSON.stringify(base)).toBe(frozen);
  });

  it("starts a list from nothing for a first follow", () => {
    expect(nextContactTags([], { add: A })).toEqual([["p", A]]);
  });
});

describe("parseStoredContactList", () => {
  it("round-trips a saved list", () => {
    const saved = { tags: [["p", A, "wss://relay.example", "alice"], ["t", "nostr"]], content: "{}", createdAt: 123 };
    expect(parseStoredContactList(JSON.stringify(saved))).toEqual(saved);
  });

  it("returns null for anything that is not a well-formed list", () => {
    for (const raw of [
      null,
      "",
      "not json",
      "[]",
      "null",
      '{"tags":"x","content":"","createdAt":1}',
      '{"tags":[["p",1]],"content":"","createdAt":1}',
      '{"tags":[["p","a"]],"content":null,"createdAt":1}',
      '{"tags":[["p","a"]],"content":"","createdAt":"1"}',
      '{"tags":[["p","a"]],"content":""}',
    ]) {
      expect(parseStoredContactList(raw)).toBeNull();
    }
  });
});

