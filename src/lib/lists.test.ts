import { describe, it, expect } from "vitest";
import { tagValues, recordChange, withListChanges, hasChanges, noChanges, parseStoredChanges } from "./lists";

const base = [["p", "a"], ["p", "b"], ["t", "spam"], ["e", "note1"], ["word", "crypto"]];

describe("tagValues", () => {
  it("lists one tag kind in order, once each", () => {
    expect(tagValues([...base, ["p", "a"]], "p")).toEqual(["a", "b"]);
    expect(tagValues(base, "e")).toEqual(["note1"]);
    expect(tagValues(base, "a")).toEqual([]);
  });
});

describe("recordChange", () => {
  it("records an add and a remove, once each, and lets the later one win for one entry", () => {
    let c = recordChange(noChanges(), "p", { add: "x" });
    c = recordChange(c, "p", { add: "x" });
    c = recordChange(c, "p", { remove: "b" });
    expect(c).toEqual({ p: { add: ["x"], remove: ["b"] } });
    c = recordChange(c, "p", { remove: "x" });
    expect(c.p).toEqual({ add: [], remove: ["b", "x"] });
    c = recordChange(c, "p", { add: "b" });
    expect(c.p).toEqual({ add: ["b"], remove: ["x"] });
    expect(hasChanges(c)).toBe(true);
    expect(hasChanges(noChanges())).toBe(false);
    expect(hasChanges({ p: { add: [], remove: [] } })).toBe(false);
  });
});

describe("withListChanges", () => {
  it("applies this device's say to the relays' list and carries everything else over", () => {
    const next = withListChanges(base, { p: { add: ["c", "a"], remove: ["b"] }, e: { add: [], remove: ["note1"] } });
    expect(next).toEqual([["p", "a"], ["t", "spam"], ["word", "crypto"], ["p", "c"]]);
    // The base is untouched.
    expect(base).toHaveLength(5);
  });

  it("builds a first list from the changes alone", () => {
    expect(withListChanges([], { p: { add: ["a"], remove: ["z"] } })).toEqual([["p", "a"]]);
  });
});

describe("parseStoredChanges", () => {
  it("reads what was stored, strictly", () => {
    expect(parseStoredChanges(null)).toEqual({});
    expect(parseStoredChanges("{")).toEqual({});
    expect(parseStoredChanges("[1]")).toEqual({});
    expect(parseStoredChanges(JSON.stringify({ p: { add: ["a", 1], remove: null }, e: "x" }))).toEqual({ p: { add: ["a"], remove: [] } });
  });
});
