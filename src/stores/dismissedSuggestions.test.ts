import { describe, it, expect } from "vitest";

describe("dismissed suggestions: what is stored", () => {
  it("reads a stored value that is not a list of keys as nothing dismissed", async () => {
    localStorage.setItem("wrystr_dismissed_suggestions", JSON.stringify({ a: 1 }));
    const { useDismissedSuggestionsStore } = await import("./dismissedSuggestions");
    expect(useDismissedSuggestionsStore.getState().dismissedPubkeys).toEqual([]);
  });
});
