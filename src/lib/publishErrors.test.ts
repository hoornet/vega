import { describe, it, expect } from "vitest";
import { explainPublishError } from "./publishErrors";

const KEPT = "Your draft is safe.";

describe("explainPublishError", () => {
  it("explains NDK's relay-count failure without the counting", () => {
    const err = new Error("Not enough relays received the event (0 published, 1 required)");
    expect(explainPublishError(err, KEPT)).toBe(
      "Couldn't publish: none of your relays accepted it. Your draft is safe. Check your relays and try again.",
    );
  });

  it("names a missing signer", () => {
    expect(explainPublishError(new Error("Not logged in"), KEPT)).toMatch(/not signed in.*Your draft is safe\./);
  });

  it("passes other reasons through, and always says what was kept", () => {
    expect(explainPublishError(new Error("socket closed."), KEPT)).toBe("Couldn't publish: socket closed. Your draft is safe.");
    expect(explainPublishError(undefined, KEPT)).toBe("Couldn't publish. Your draft is safe.");
    expect(explainPublishError("relay said no", KEPT)).toBe("Couldn't publish: relay said no. Your draft is safe.");
  });
});
