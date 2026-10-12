import { describe, it, expect, vi, beforeEach } from "vitest";
import { forThisAccount } from "./toastActions";
import { currentAccount, setCurrentAccount } from "./currentAccount";
import { useToastStore } from "../stores/toast";

const messages = () => useToastStore.getState().toasts.map((t) => `${t.type}: ${t.message}`);

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  setCurrentAccount("alice");
});

describe("currentAccount", () => {
  it("is what it was last set to", () => {
    expect(currentAccount()).toBe("alice");
    setCurrentAccount(null);
    expect(currentAccount()).toBeNull();
  });
});

describe("forThisAccount", () => {
  it("runs for the account that was signed in when it was made", () => {
    const run = vi.fn();
    const action = forThisAccount("Undo", run);
    expect(action.label).toBe("Undo");
    action.run();
    expect(run).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([]);
  });

  // The signature would be the current account's, whoever asked.
  it("does not run for another account, and says why", () => {
    const run = vi.fn();
    const action = forThisAccount("Try again", run);
    setCurrentAccount("bob");
    action.run();
    expect(run).not.toHaveBeenCalled();
    expect(messages()).toEqual(["info: That was for another account, so nothing was done."]);
  });

  it("does not run after signing out", () => {
    const run = vi.fn();
    const action = forThisAccount("Try again", run);
    setCurrentAccount(null);
    action.run();
    expect(run).not.toHaveBeenCalled();
  });

  // Switched away and back again: it is that account's action once more.
  it("runs again once the same account is back", () => {
    const run = vi.fn();
    const action = forThisAccount("Undo", run);
    setCurrentAccount("bob");
    setCurrentAccount("alice");
    action.run();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("works for an account that is not signed in at all", () => {
    setCurrentAccount(null);
    const run = vi.fn();
    forThisAccount("Undo", run).run();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
