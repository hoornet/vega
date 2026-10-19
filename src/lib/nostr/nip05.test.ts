import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import NDK from "@nostr-dev-kit/ndk";

// `resolveNip05` returned null for every address since at least March 2026:
// NDK 3.0.3's NDKUser constructor ignores `nip05`, so the old code threw "npub
// not set" and swallowed it. This runs the real function against a stubbed fetch.
vi.mock("./core", () => ({ getNDK: () => new NDK(), fetchWithTimeout: vi.fn(), withTimeout: vi.fn(), FEED_TIMEOUT: 5000 }));

import { resolveNip05 } from "./search";

const ALICE = "a".repeat(64);
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.startsWith("https://example.com/.well-known/nostr.json")) {
      const name = new URL(u).searchParams.get("name");
      return new Response(JSON.stringify({ names: name === "alice" ? { alice: ALICE } : {} }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("resolveNip05", () => {
  it("finds the key behind an address", async () => {
    expect(await resolveNip05("alice@example.com")).toBe(ALICE);
  });
  it("is null for a name the domain does not list, and for a domain that does not answer", async () => {
    expect(await resolveNip05("nobody@example.com")).toBeNull();
    expect(await resolveNip05("nobody@nowhere.invalid")).toBeNull();
  });
});
