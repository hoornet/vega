import { describe, it, expect, beforeEach } from "vitest";
import type { NDKNip46Signer } from "@nostr-dev-kit/ndk";
import {
  acceptSecretEchoAsAck,
  forgetPendingClientKey,
  pendingClientKeyFor,
  rememberPendingClientKey,
} from "./nip46";

/**
 * Minimal stand-in for NDKNip46Signer: only `secret` and `rpc.parseEvent` are
 * touched by acceptSecretEchoAsAck. `parsed` is what the real parseEvent would
 * return after decrypting the bunker's reply.
 */
function fakeSigner(secret: string | null, parsed: unknown) {
  return {
    secret,
    rpc: { parseEvent: async () => parsed },
  } as unknown as NDKNip46Signer;
}

const anyEvent = {} as never;

describe("acceptSecretEchoAsAck", () => {
  it("rewrites a secret echo into the ack NDK insists on", async () => {
    const signer = fakeSigner("s3cret", { id: "1", result: "s3cret" });
    acceptSecretEchoAsAck(signer);

    const parsed = await signer.rpc.parseEvent(anyEvent);
    expect((parsed as { result: string }).result).toBe("ack");
  });

  it("leaves a plain ack alone", async () => {
    const signer = fakeSigner("s3cret", { id: "1", result: "ack" });
    acceptSecretEchoAsAck(signer);

    const parsed = await signer.rpc.parseEvent(anyEvent);
    expect((parsed as { result: string }).result).toBe("ack");
  });

  it("leaves real errors alone so they still surface to the user", async () => {
    const signer = fakeSigner("s3cret", { id: "1", result: undefined, error: "Unknown client" });
    acceptSecretEchoAsAck(signer);

    const parsed = await signer.rpc.parseEvent(anyEvent);
    expect((parsed as { result?: string }).result).toBeUndefined();
    expect((parsed as { error: string }).error).toBe("Unknown client");
  });

  it("does not rewrite an inbound request that happens to carry the secret", async () => {
    const signer = fakeSigner("s3cret", { id: "1", method: "ping", params: [], result: "s3cret" });
    acceptSecretEchoAsAck(signer);

    const parsed = await signer.rpc.parseEvent(anyEvent);
    expect((parsed as { result: string }).result).toBe("s3cret");
  });

  it("is a no-op when the bunker:// URI carried no secret", async () => {
    const signer = fakeSigner(null, { id: "1", result: "whatever" });
    const original = signer.rpc.parseEvent;
    acceptSecretEchoAsAck(signer);

    expect(signer.rpc.parseEvent).toBe(original);
  });
});

describe("pending client key", () => {
  beforeEach(() => forgetPendingClientKey());

  it("reuses the key when the same bunker URI is retried", () => {
    rememberPendingClientKey("bunker://abc?secret=s1", "aa".repeat(32));
    expect(pendingClientKeyFor("bunker://abc?secret=s1")).toBe("aa".repeat(32));
  });

  it("issues a fresh identity for a newly generated URI", () => {
    rememberPendingClientKey("bunker://abc?secret=s1", "aa".repeat(32));
    expect(pendingClientKeyFor("bunker://abc?secret=s2")).toBeUndefined();
  });

  it("survives a corrupted localStorage entry", () => {
    localStorage.setItem("wrystr_nip46_pending_client_key", "{not json");
    expect(pendingClientKeyFor("bunker://abc?secret=s1")).toBeUndefined();
  });

  it("ignores a stored key that is not a 32-byte hex key", () => {
    rememberPendingClientKey("bunker://abc?secret=s1", "nope");
    expect(pendingClientKeyFor("bunker://abc?secret=s1")).toBeUndefined();
  });
});
