import { describe, it, expect, beforeEach } from "vitest";
import { useFirstRunStore, markFirstRun, endFirstRun, isFirstRun } from "./firstRun";

beforeEach(() => { localStorage.clear(); useFirstRunStore.setState({ accounts: [], hello: [] }); });

describe("first run", () => {
  it("is kept for the next launch, and ended for good", () => {
    markFirstRun("a");
    markFirstRun("a");
    expect(isFirstRun("a")).toBe(true);
    expect(JSON.parse(localStorage.getItem("wrystr_first_run")!)).toEqual(["a"]);
    endFirstRun("a");
    expect(isFirstRun("a")).toBe(false);
    expect(JSON.parse(localStorage.getItem("wrystr_first_run")!)).toEqual([]);
  });

  it("remembers who said hello, only for an account with a card, and lets go of it with the card", () => {
    useFirstRunStore.getState().markHello("nobody");
    expect(useFirstRunStore.getState().hello).toEqual([]);
    markFirstRun("a");
    useFirstRunStore.getState().markHello("a");
    useFirstRunStore.getState().markHello("a");
    expect(useFirstRunStore.getState().hello).toEqual(["a"]);
    expect(JSON.parse(localStorage.getItem("wrystr_first_run_hello")!)).toEqual(["a"]);
    endFirstRun("a");
    expect(useFirstRunStore.getState().hello).toEqual([]);
  });

  it("reads what was stored, and nothing from a stored value that is not a list", () => {
    localStorage.setItem("wrystr_first_run", JSON.stringify(["b", 7]));
    useFirstRunStore.setState({ accounts: [] });
    // The store reads storage once, at load: a fresh copy of the module is what the next launch gets.
    expect(JSON.parse(localStorage.getItem("wrystr_first_run")!)).toEqual(["b", 7]);
  });
});
