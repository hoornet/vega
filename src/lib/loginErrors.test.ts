import { describe, it, expect } from "vitest";
import { explainPublicKeyError, explainSecretKeyError } from "./loginErrors";

describe("explainSecretKeyError", () => {
  it("says what a secret key looks like", () => {
    expect(explainSecretKeyError("this-is-not-a-key")).toBe("That doesn't look like a secret key. It starts with nsec1.");
  });

  it("points a pasted public key at the right tab", () => {
    expect(explainSecretKeyError("  npub1abc")).toMatch(/public key.*Public key tab/);
  });

  it("points a pasted bunker address at the right tab", () => {
    expect(explainSecretKeyError("bunker://abc?relay=wss://r")).toMatch(/Remote signer tab/);
  });

  it("never echoes what was typed", () => {
    // The input may be a real secret with a typo in it.
    expect(explainSecretKeyError("nsec1almostright")).not.toContain("almostright");
  });
});

describe("explainPublicKeyError", () => {
  it("says what a public key looks like", () => {
    expect(explainPublicKeyError("nope")).toBe("That doesn't look like a public key. It starts with npub1.");
  });

  it("points a pasted secret key at the right tab without repeating it", () => {
    const message = explainPublicKeyError("nsec1supersecret");
    expect(message).toMatch(/secret key.*Secret key tab/);
    expect(message).not.toContain("supersecret");
  });
});
