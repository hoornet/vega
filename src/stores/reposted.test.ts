import { describe, it, expect, beforeEach } from "vitest";
import { repostKey, useRepostedStore } from "./reposted";

const A = "a".repeat(64);
const B = "b".repeat(64);
const NOTE = "e".repeat(64);
const store = () => useRepostedStore.getState();

beforeEach(() => useRepostedStore.setState({ byKey: {} }));

describe("the reposted store", () => {
  it("lets a note be claimed once", () => {
    expect(store().begin(A, NOTE)).toBe(true);
    expect(store().begin(A, NOTE)).toBe(false);
    expect(store().byKey[repostKey(A, NOTE)]).toBe("pending");
  });

  it("keeps a published repost, so it cannot be published again", () => {
    store().begin(A, NOTE);
    store().finish(A, NOTE, true);
    expect(store().byKey[repostKey(A, NOTE)]).toBe("done");
    expect(store().begin(A, NOTE)).toBe(false);
  });

  it("forgets a repost that was not published, so it can be tried again", () => {
    store().begin(A, NOTE);
    store().finish(A, NOTE, false);
    expect(store().byKey[repostKey(A, NOTE)]).toBeUndefined();
    expect(store().begin(A, NOTE)).toBe(true);
  });

  // After switching accounts the note showed "Reposted" for an account that
  // never reposted it, and its Repost item did nothing until restart.
  it("keeps accounts apart", () => {
    store().begin(A, NOTE);
    store().finish(A, NOTE, true);
    expect(store().byKey[repostKey(B, NOTE)]).toBeUndefined();
    expect(store().begin(B, NOTE)).toBe(true);
  });
});
