import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NDKNip46Signer } from "@nostr-dev-kit/ndk";
import {
  connectWithTimeout,
  acceptSecretEchoAsAck,
  forgetPendingClientKey,
  pendingClientKeyFor,
  rememberPendingClientKey,
  explainBunkerConnectError,
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

describe("acceptSecretEchoAsAck idempotency", () => {
  it("does not stack a second wrapper when restore and switch both hook the same rpc", async () => {
    const signer = fakeSigner("s3cret", { id: "1", result: "s3cret" });
    acceptSecretEchoAsAck(signer);
    const afterFirst = signer.rpc.parseEvent;

    acceptSecretEchoAsAck(signer);
    expect(signer.rpc.parseEvent).toBe(afterFirst);

    // ...and the single wrapper still does its job.
    const parsed = await signer.rpc.parseEvent(anyEvent);
    expect((parsed as { result: string }).result).toBe("ack");
  });
});

describe("connectWithTimeout", () => {
  function signerThatConnects(result: unknown, delayMs = 0) {
    return {
      blockUntilReady: () => new Promise((resolve) => setTimeout(() => resolve(result), delayMs)),
    } as unknown as NDKNip46Signer;
  }

  it("resolves with the user when the bunker answers", async () => {
    const user = { pubkey: "ab".repeat(32) };
    await expect(connectWithTimeout(signerThatConnects(user))).resolves.toBe(user);
  });

  it("rejects once the bunker stays silent past the deadline", async () => {
    // A bunker that is offline leaves blockUntilReady pending forever — neither
    // resolving nor rejecting. Restore and switch used to await that directly,
    // hanging the account switch with no error (#47).
    const silent = { blockUntilReady: () => new Promise(() => {}) } as unknown as NDKNip46Signer;
    await expect(connectWithTimeout(silent, 20)).rejects.toThrow(/didn't respond/);
  });

  it("surfaces the bunker's own rejection rather than masking it as a timeout", async () => {
    const refused = {
      blockUntilReady: () => Promise.reject(new Error("Unknown client")),
    } as unknown as NDKNip46Signer;
    await expect(connectWithTimeout(refused, 5000)).rejects.toThrow("Unknown client");
  });
});

describe("explainBunkerConnectError", () => {
  it("explains 'Unknown client' instead of passing it through", () => {
    // Measured against a real Bunker46: this single message covers a spent
    // secret, an expired one, and a signer restart that dropped the in-memory
    // pending-secret map. We hit all three in one afternoon of testing.
    const msg = explainBunkerConnectError(new Error("Unknown client"));
    expect(msg).toMatch(/single-use|no longer valid/i);
    expect(msg).toMatch(/generate a fresh/i);
    expect(msg).not.toBe("Unknown client");
  });

  it("keeps the timeout message, which already says the useful thing", () => {
    const original = "Remote signer didn't respond within 15 seconds. Check your connection.";
    expect(explainBunkerConnectError(new Error(original))).toBe(original);
  });

  it("names the signer when it refused on permissions", () => {
    const msg = explainBunkerConnectError(new Error("Permission denied for sign_event kind:22242"));
    expect(msg).toMatch(/your signer refused/i);
    expect(msg).toContain("kind:22242");
  });

  it("never renders 'undefined' when the bunker replied without an error", () => {
    // NDK rejects with the raw `error` field, which is undefined on a bunker
    // reply that carried none — the original #17 symptom.
    expect(explainBunkerConnectError(undefined)).not.toMatch(/undefined/);
    expect(explainBunkerConnectError(undefined)).toMatch(/rejected the connection/i);
  });
});

describe("connectWithTimeout retries", () => {
  /** A signer whose blockUntilReady resolves, rejects, or hangs, per call. */
  function scriptedSigner(script: Array<"hang" | "ok" | Error>) {
    let call = 0;
    const calls = () => call;
    const signer = {
      blockUntilReady: () => {
        const step = script[call++];
        if (step === "hang") return new Promise(() => {});
        if (step === "ok") return Promise.resolve({ pubkey: "aa".repeat(32) });
        return Promise.reject(step);
      },
    } as unknown as NDKNip46Signer;
    return { signer, calls };
  }

  it("re-sends the request when the first attempt goes unanswered", async () => {
    // The signer's subscription drops and re-subscribes periodically; a request
    // published into that window is never seen. The second one usually is.
    vi.useFakeTimers();
    try {
      const { signer, calls } = scriptedSigner(["hang", "ok"]);
      const promise = connectWithTimeout(signer, 1000, 2);
      await vi.advanceTimersByTimeAsync(1100);
      await expect(promise).resolves.toMatchObject({ pubkey: "aa".repeat(32) });
      expect(calls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after the configured number of attempts", async () => {
    vi.useFakeTimers();
    try {
      const { signer, calls } = scriptedSigner(["hang", "hang"]);
      const promise = connectWithTimeout(signer, 1000, 2);
      const settled = promise.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(2200);
      const err = await settled;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/didn't respond/);
      expect(calls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a signer that actually answered no", async () => {
    // An expired link or a refused permission fails identically the second
    // time. Retrying it would only double the wait before telling the user
    // something they can act on.
    const { signer, calls } = scriptedSigner([new Error("Unknown client")]);
    await expect(connectWithTimeout(signer, 1000, 2)).rejects.toThrow("Unknown client");
    expect(calls()).toBe(1);
  });

  it("still honours a single-attempt caller", async () => {
    vi.useFakeTimers();
    try {
      const { signer, calls } = scriptedSigner(["hang", "ok"]);
      const promise = connectWithTimeout(signer, 1000, 1);
      const settled = promise.catch((e) => e);
      await vi.advanceTimersByTimeAsync(1100);
      await settled;
      expect(calls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
