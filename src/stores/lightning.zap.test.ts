import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import NDK, { NDKPrivateKeySigner, NDKUser } from "@nostr-dev-kit/ndk";

// A zap through NDK's real zapper, as the zap dialog starts it. The recipient's Lightning address
// server and the wallet are played here; everything between them is NDK and the store.
const wallet = vi.hoisted(() => ({ pay: null as unknown as () => Promise<string> }));
vi.mock("../lib/lightning/nwc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/lightning/nwc")>();
  return { ...real, payInvoiceViaNWC: vi.fn(() => wallet.pay()) };
});
const session = vi.hoisted(() => ({ ndk: null as unknown }));
vi.mock("../lib/nostr", () => ({ getNDK: () => session.ndk }));

import { useLightningStore } from "./lightning";
import { payInvoiceViaNWC, NwcTimeoutError } from "../lib/lightning/nwc";
import { ZAP_UNCONFIRMED } from "../lib/lightning/zap";

type ZapInfo = Awaited<ReturnType<NDKUser["getZapInfo"]>>;
const ALICE = "a".repeat(64);
/** One millisatoshi is ten pico-bitcoin (`p`). */
const invoiceFor = (msats: number) => `lnbc${msats * 10}p1pvjluez`;

/** The amounts the recipient's server was asked for, and what it answers with. */
let asked: number[];
let answer: (msats: number) => string | undefined;

beforeEach(() => {
  asked = [];
  answer = invoiceFor;
  wallet.pay = async () => "preimage";
  vi.mocked(payInvoiceViaNWC).mockClear();
  // Before NDK is made: it takes the global fetch for its LNURL requests when it is constructed.
  vi.stubGlobal("fetch", async (url: string) => {
    const request = new URL(url);
    const body = request.pathname.includes("/.well-known/")
      ? { callback: "https://pay.example/cb", allowsNostr: true }
      : (asked.push(Number(request.searchParams.get("amount"))), { pr: answer(asked[asked.length - 1]) });
    return { status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) };
  });
  const ndk = new NDK({ explicitRelayUrls: [] });
  ndk.signer = NDKPrivateKeySigner.generate();
  session.ndk = ndk;
  vi.spyOn(NDKUser.prototype, "getZapInfo").mockResolvedValue(new Map([["nip57", { lud16: "alice@pay.example" }]]) as unknown as ZapInfo);
  useLightningStore.setState({ nwcUri: "nostr+walletconnect://w?relay=wss://r&secret=s" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const zap = () => useLightningStore.getState().zap({ type: "profile", pubkey: ALICE }, 21);

describe("a zap", () => {
  it("pays the invoice for the amount asked for", async () => {
    await expect(zap()).resolves.toBeUndefined();
    expect(asked).toEqual([21_000]);
    expect(payInvoiceViaNWC).toHaveBeenCalledTimes(1);
  });

  // NDK keeps what the payment step throws to itself and records the recipient as undefined; the
  // store read that as success, so every failed zap said "Zapped!".
  it("is not paid, and fails with the reason, when the invoice asks for another amount", async () => {
    answer = (msats) => invoiceFor(msats * 10);
    await expect(zap()).rejects.toThrow("The invoice from their wallet asks for 210 sats, not 21 sats, so it was not paid.");
    expect(payInvoiceViaNWC).not.toHaveBeenCalled();
  });

  it("fails with the wallet's words when the wallet refuses", async () => {
    wallet.pay = async () => { throw new Error("Insufficient balance"); };
    await expect(zap()).rejects.toThrow("Insufficient balance.");
  });

  it("says the sats may still go out when the wallet did not answer in time", async () => {
    wallet.pay = async () => { throw new NwcTimeoutError("NWC payment"); };
    await expect(zap()).rejects.toThrow(ZAP_UNCONFIRMED);
  });

  // NDK's own words, from its notice: the payment step was never reached. A test of the real
  // zapper, so an NDK that words it differently fails here.
  it("fails with NDK's reason when the server sends no invoice", async () => {
    answer = () => undefined;
    await expect(zap()).rejects.toThrow("The zap did not go out: Unable to get payment request.");
    expect(payInvoiceViaNWC).not.toHaveBeenCalled();
  });

  // The dialog waits 45 s. A payment still on its way then may go through: "Try again" would pay twice.
  it("says the sats may still go out when the wait runs out with the wallet asked", async () => {
    vi.useFakeTimers();
    let asked: () => void = () => {};
    const walletAsked = new Promise<void>((resolve) => { asked = resolve; });
    wallet.pay = () => { asked(); return new Promise<string>(() => {}); };
    const zapping = zap();
    zapping.catch(() => {});
    while (vi.mocked(payInvoiceViaNWC).mock.calls.length === 0) await vi.advanceTimersByTimeAsync(500);
    await walletAsked;
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(zapping).rejects.toThrow(ZAP_UNCONFIRMED);
  });
});
