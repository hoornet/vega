// @vitest-environment node
//
// Node, not jsdom: a real relay connection uses undici's WebSocket, whose
// Event objects jsdom rejects. No relay is reached, which is the point: one
// address refuses the connection, one never resolves, and one drops every
// packet, so its socket is still connecting when the limit runs out.
import { describe, it, expect } from "vitest";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { payInvoiceViaNWC, payKeysendViaNWC, NwcTimeoutError, isNdkOwnFailure } from "./nwc";

const WALLET = NDKPrivateKeySigner.generate().pubkey;
const SECRET = NDKPrivateKeySigner.generate().privateKey;
const code = (relay: string) => `nostr+walletconnect://${WALLET}?relay=${encodeURIComponent(relay)}&secret=${SECRET}`;

/** Runs `pay` and says how it ended, how long it took, and how many of the sockets it opened are still open. */
async function outcome(pay: () => Promise<string>) {
  const Real = globalThis.WebSocket;
  const opened: WebSocket[] = [];
  globalThis.WebSocket = class extends Real {
    constructor(...args: ConstructorParameters<typeof WebSocket>) { super(...args); opened.push(this); }
  } as typeof WebSocket;
  const started = Date.now();
  try {
    const err = await pay().then(() => null, (e: Error) => e);
    const took = Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 300)); // a close is not instant
    return { err, took, open: opened.filter((ws) => ws.readyState < WebSocket.CLOSING).length };
  } finally {
    globalThis.WebSocket = Real;
  }
}

// NDK's connect() without a limit resolves only once the relay has connected.
// Both payment paths awaited it that way, so a wallet relay that was down held
// the payment for good: the zap dialog said "timed out" after its own 45 s,
// and podcast streaming, which pays one round at a time, stopped paying for
// the rest of the episode without a word.
describe.each([
  ["refuses the connection", "ws://127.0.0.1:1"],
  ["does not resolve", "wss://wallet-relay.invalid"],
  // TEST-NET-1, reserved for documentation and never routed.
  ["drops every packet", "ws://192.0.2.1"],
])("a payment whose wallet relay %s", (_, relay) => {
  it("fails within the connect limit, as a failure and not as sent", async () => {
    const { err, took, open } = await outcome(() => payInvoiceViaNWC(code(relay), "lnbc1test", { connectMs: 1000, answerMs: 5000 }));
    expect(err).toBeInstanceOf(Error);
    // A timeout means "the request went out", which streaming counts as paid.
    expect(err).not.toBeInstanceOf(NwcTimeoutError);
    expect(err?.message).toMatch(/could not be reached/);
    expect(took).toBeLessThan(4000);
    expect(open).toBe(0);
  }, 15_000);

  it("fails the same way by keysend", async () => {
    const { err, took, open } = await outcome(() => payKeysendViaNWC(code(relay), WALLET, 1000, [], { connectMs: 1000, answerMs: 5000 }));
    expect(err).not.toBeInstanceOf(NwcTimeoutError);
    expect(err?.message).toMatch(/could not be reached/);
    expect(took).toBeLessThan(4000);
    expect(open).toBe(0);
  }, 15_000);
});

// A payment fails before the wallet's answer only on a relay's own "no". NDK's
// words for "no answer" (no OK in time, the relay gone) must not count as one:
// the request may have gone out, and a payment failed then is paid twice.
describe("isNdkOwnFailure", () => {
  it("tells NDK's own words for no answer from a relay's reason", () => {
    expect(isNdkOwnFailure("Timeout: 2500ms")).toBe(true);
    expect(isNdkOwnFailure("Relay wss://relay.getalby.com/v1 disconnected")).toBe(true);
    // A drop after the request was written: NDK rejects what was waiting for an OK through its AUTH path.
    expect(isNdkOwnFailure("Authentication failed: Relay wss://relay.getalby.com/v1 disconnected")).toBe(true);
    expect(isNdkOwnFailure("Authentication failed: auth rejected")).toBe(true);
    expect(isNdkOwnFailure("blocked: not today")).toBe(false);
    expect(isNdkOwnFailure("rate-limited: slow down")).toBe(false);
    expect(isNdkOwnFailure("restricted: Timeout: 5ms")).toBe(false);
  });

  it("matches what NDK as installed says", async () => {
    // The app has no Node typings, so the file is read through an untyped import, as in themes.test.ts.
    const fsModule = "node:fs";
    const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string, encoding: string): string };
    const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? ".";
    const ndk = fs.readFileSync(`${cwd}/node_modules/@nostr-dev-kit/ndk/dist/index.mjs`, "utf8");
    expect(ndk).toContain("reject(new Error(`Timeout: ${timeoutMs}ms`));");
    expect(ndk).toContain("new Error(`Relay ${this.ndkRelay.url} disconnected`)");
    expect(ndk).toContain("resolver.reject(new Error(`Authentication failed: ${error.message}`));");
  });
});
