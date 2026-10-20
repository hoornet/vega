import { describe, it, expect, beforeEach } from "vitest";
import { saveInterests, storedInterests } from "./interests";

beforeEach(() => localStorage.clear());

describe("interests", () => {
  it("are kept for the account that picked them", () => {
    localStorage.setItem("wrystr_accounts", JSON.stringify([{ pubkey: "a" }, { pubkey: "b" }]));
    saveInterests("a", ["bitcoin", "art"]);
    expect(storedInterests("a")).toEqual(["bitcoin", "art"]);
    expect(storedInterests("b")).toEqual([]);
  });

  // Before October 2026 there was one list for the whole computer.
  it("hands the old list to the only account on the computer, once", () => {
    localStorage.setItem("wrystr_interests", JSON.stringify(["nostr"]));
    localStorage.setItem("wrystr_accounts", JSON.stringify([{ pubkey: "a" }]));
    expect(storedInterests("a")).toEqual(["nostr"]);
    expect(JSON.parse(localStorage.getItem("wrystr_interests_a")!)).toEqual(["nostr"]);
    expect(localStorage.getItem("wrystr_interests")).toBeNull();
    expect(storedInterests("a")).toEqual(["nostr"]);
  });

  it("hands it to the first of several accounts, the one that picked it, and never to another", () => {
    localStorage.setItem("wrystr_interests", JSON.stringify(["nostr"]));
    localStorage.setItem("wrystr_accounts", JSON.stringify([{ pubkey: "a" }, { pubkey: "b" }]));
    expect(storedInterests("b")).toEqual([]);
    expect(localStorage.getItem("wrystr_interests")).not.toBeNull();
    expect(storedInterests("a")).toEqual(["nostr"]);
    expect(localStorage.getItem("wrystr_interests")).toBeNull();
    // Removing the first account must not hand the list to the next.
    localStorage.setItem("wrystr_accounts", JSON.stringify([{ pubkey: "b" }]));
    expect(storedInterests("b")).toEqual([]);
  });

  it("reads the old list with no account signed in only when there is at most one", () => {
    localStorage.setItem("wrystr_interests", JSON.stringify(["nostr"]));
    localStorage.setItem("wrystr_accounts", JSON.stringify([{ pubkey: "a" }, { pubkey: "b" }]));
    expect(storedInterests(null)).toEqual([]);
    localStorage.setItem("wrystr_accounts", JSON.stringify([{ pubkey: "a" }]));
    expect(storedInterests(null)).toEqual(["nostr"]);
    expect(localStorage.getItem("wrystr_interests")).not.toBeNull();
  });

  it("takes a corrupt or odd stored list as nothing", () => {
    localStorage.setItem("wrystr_interests_a", "{");
    expect(storedInterests("a")).toEqual([]);
    localStorage.setItem("wrystr_interests_a", JSON.stringify(["x", 3]));
    expect(storedInterests("a")).toEqual(["x"]);
  });
});
