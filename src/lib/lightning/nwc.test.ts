import { describe, it, expect } from "vitest";
import { parseNwcUri, isValidNwcUri, NwcTimeoutError } from "./nwc";

describe("parseNwcUri", () => {
  it("parses a valid NWC URI", () => {
    const uri = "nostr+walletconnect://abc123?relay=wss://relay.example.com&secret=mysecret";
    const result = parseNwcUri(uri);
    expect(result.walletPubkey).toBe("abc123");
    expect(result.relayUrl).toBe("wss://relay.example.com");
    expect(result.secret).toBe("mysecret");
  });

  it("throws on missing relay", () => {
    const uri = "nostr+walletconnect://abc123?secret=mysecret";
    expect(() => parseNwcUri(uri)).toThrow("Invalid NWC URI");
  });

  it("throws on missing secret", () => {
    const uri = "nostr+walletconnect://abc123?relay=wss://relay.example.com";
    expect(() => parseNwcUri(uri)).toThrow("Invalid NWC URI");
  });

  it("throws on completely invalid URI", () => {
    expect(() => parseNwcUri("not-a-uri")).toThrow();
  });
});

describe("isValidNwcUri", () => {
  it("returns true for valid NWC URI", () => {
    const uri = "nostr+walletconnect://abc123?relay=wss://relay.example.com&secret=mysecret";
    expect(isValidNwcUri(uri)).toBe(true);
  });

  it("returns false for invalid URI", () => {
    expect(isValidNwcUri("not-valid")).toBe(false);
  });

  it("returns false for wrong prefix", () => {
    const uri = "https://abc123?relay=wss://relay.example.com&secret=mysecret";
    expect(isValidNwcUri(uri)).toBe(false);
  });

  it("returns false for missing fields", () => {
    expect(isValidNwcUri("nostr+walletconnect://abc123")).toBe(false);
  });
});

describe("NwcTimeoutError", () => {
  it("is told apart from a refusal by its class and its name", () => {
    const err = new NwcTimeoutError("NWC payment");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("NwcTimeoutError");
    expect(err.message).toBe("NWC payment timed out (30s)");
  });
});
