import { describe, it, expect } from "vitest";
import { isAuthChallenge } from "./relayHealth";

/**
 * A relay with eager NIP-42 sends its challenge before answering anything, so
 * the first frame back is not a reply to our query. Timing against it made
 * auth-required relays — the hardest ones to actually use — look like the
 * fastest, and marked them "online" on the strength of a challenge. See #54.
 */
describe("isAuthChallenge", () => {
  it("recognises a NIP-42 challenge", () => {
    expect(isAuthChallenge('["AUTH","3af1e5c0b2"]')).toBe(true);
  });

  it("does not mistake a real reply for a challenge", () => {
    expect(isAuthChallenge('["EVENT","health_ab12",{"kind":0}]')).toBe(false);
    expect(isAuthChallenge('["EOSE","health_ab12"]')).toBe(false);
    // CLOSED carries the auth-required *reason*, but it is still a reply — the
    // query is over, so the measurement should settle rather than keep waiting.
    expect(isAuthChallenge('["CLOSED","health_ab12","auth-required: need AUTH"]')).toBe(false);
  });

  it("never throws on whatever a relay actually sends", () => {
    // A health check that throws takes the whole relay dashboard with it.
    expect(isAuthChallenge("not json at all")).toBe(false);
    expect(isAuthChallenge("")).toBe(false);
    expect(isAuthChallenge('{"not":"an array"}')).toBe(false);
    expect(isAuthChallenge(new Blob())).toBe(false);
    expect(isAuthChallenge(undefined)).toBe(false);
  });
});
