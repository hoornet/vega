import { describe, it, expect } from "vitest";
import { explainPublishError, publishFailureReason } from "./publishErrors";

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

  // A message is sent, not published.
  it("uses the verb it is given", () => {
    expect(explainPublishError(new Error("Not enough relays received the event (0 published, 1 required)"), "Your message is still in the box.", "send"))
      .toBe("Couldn't send: none of your relays accepted it. Your message is still in the box. Check your relays and try again.");
    expect(explainPublishError(new Error("Not logged in"), "Nothing was sent.", "send")).toBe("Couldn't send: you are not signed in with a key that can sign. Nothing was sent.");
    expect(explainPublishError(new Error("boom"), "Nothing was sent.", "send")).toBe("Couldn't send: boom. Nothing was sent.");
  });

  // A relay's or a remote signer's own words can be any length.
  it("cuts someone else's words to a length that fits, and keeps ours whole", () => {
    const said = explainPublishError(new Error("x".repeat(5000)), "Your note is still here.");
    expect(said.startsWith("Couldn't publish: xxx")).toBe(true);
    // The ellipsis ends the clause by itself: not "….".
    expect(said.endsWith("x… Your note is still here.")).toBe(true);
    expect(said.length).toBeLessThan(200);
  });

  it("cuts exactly at the limit, and not a reason that just fits", () => {
    const fits = explainPublishError(new Error("y".repeat(140)), "Kept.");
    expect(fits).toBe(`Couldn't publish: ${"y".repeat(140)}. Kept.`);
    const over = explainPublishError(new Error("y".repeat(141)), "Kept.");
    expect(over).toBe(`Couldn't publish: ${"y".repeat(139)}… Kept.`);
  });

  // Cut in UTF-16 units, the last emoji was halved and shown as a broken glyph.
  it("cuts between characters, never through one", () => {
    const said = explainPublishError(new Error("😀".repeat(200)), "Kept.");
    expect(said).toBe(`Couldn't publish: ${"😀".repeat(139)}… Kept.`);
  });

  it("does not leave a space before the ellipsis", () => {
    const said = explainPublishError(new Error(`${"z".repeat(138)} and more words than fit here`), "Kept.");
    expect(said).toBe(`Couldn't publish: ${"z".repeat(138)}… Kept.`);
  });

  // A relay that ends its own sentence: not "slow down…." and not "Stop!."
  it("does not add a full stop to a reason that brings its own ending", () => {
    expect(explainPublishError(new Error("slow down…"), "Kept.")).toBe("Couldn't publish: slow down… Kept.");
    expect(explainPublishError(new Error("Stop!"), "Kept.")).toBe("Couldn't publish: Stop! Kept.");
    expect(explainPublishError(new Error("blocked"), "Kept.")).toBe("Couldn't publish: blocked. Kept.");
  });

  it("says only what was being done when there is no reason at all", () => {
    expect(explainPublishError(new Error(""), "Kept.")).toBe("Couldn't publish. Kept.");
    expect(explainPublishError(undefined, "Kept.", "send")).toBe("Couldn't send. Kept.");
  });

  it("leaves a short reason as it is", () => {
    expect(explainPublishError(new Error("rate-limited: slow down."), "Nothing was sent.")).toBe("Couldn't publish: rate-limited: slow down. Nothing was sent.");
  });
});

// The reason on its own, for a sentence that does not end on "try again".
describe("publishFailureReason", () => {
  it("is NDK's relay-count failure without the counting", () => {
    expect(publishFailureReason(new Error("Not enough relays received the event (0 published, 1 required)"))).toBe("none of your relays accepted it");
  });

  it("names a missing key", () => {
    expect(publishFailureReason(new Error("Not logged in"))).toBe("you are not signed in with a key that can sign");
    expect(publishFailureReason(new Error("No signer available"))).toBe("you are not signed in with a key that can sign");
  });

  it("is someone else's words as they are, trimmed", () => {
    expect(publishFailureReason(new Error("  socket closed.  "))).toBe("socket closed.");
    expect(publishFailureReason("relay said no")).toBe("relay said no");
  });

  it("is cut to the same length as in a full explanation", () => {
    expect(publishFailureReason(new Error("y".repeat(140)))).toBe("y".repeat(140));
    expect(publishFailureReason(new Error("y".repeat(141)))).toBe(`${"y".repeat(139)}…`);
  });

  it("is empty when there is nothing to say", () => {
    expect(publishFailureReason(undefined)).toBe("");
    expect(publishFailureReason({})).toBe("");
    expect(publishFailureReason(new Error("   "))).toBe("");
  });
});
