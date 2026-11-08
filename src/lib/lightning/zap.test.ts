import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NDKUser } from "@nostr-dev-kit/ndk";

const wallet = vi.hoisted(() => ({ pay: vi.fn(async (): Promise<string> => "preimage") }));
vi.mock("./nwc", async (importOriginal) => {
  const real = await importOriginal<typeof import("./nwc")>();
  return { ...real, payInvoiceViaNWC: wallet.pay };
});

import { zapPayment, zapFailure, zapTookTooLong, ZAP_UNCONFIRMED } from "./zap";
import { NwcTimeoutError } from "./nwc";

const NWC = "nostr+walletconnect://w?relay=wss://r&secret=s";
const INVOICE_21_SATS = "lnbc210n1pvjluez";
const pay = (lnPay: ReturnType<typeof zapPayment>["lnPay"], pr: string, amount: number, unit = "msat") =>
  lnPay({ pr, amount, unit, target: {} as NDKUser, recipientPubkey: "p" });

beforeEach(() => { wallet.pay.mockReset(); wallet.pay.mockResolvedValue("preimage"); });

describe("zapPayment", () => {
  it("pays an invoice for the amount the zapper asked for", async () => {
    const { lnPay, failures } = zapPayment(NWC);
    await expect(pay(lnPay, INVOICE_21_SATS, 21_000)).resolves.toEqual({ preimage: "preimage" });
    await expect(pay(lnPay, INVOICE_21_SATS, 21, "sat")).resolves.toEqual({ preimage: "preimage" });
    expect(wallet.pay).toHaveBeenCalledWith(NWC, INVOICE_21_SATS);
    expect(failures).toEqual([]);
  });

  it("does not ask the wallet to pay an invoice for another amount, and keeps why", async () => {
    const { lnPay, failures } = zapPayment(NWC);
    await expect(pay(lnPay, INVOICE_21_SATS, 2_000)).rejects.toThrow("The invoice from their wallet asks for 21 sats, not 2 sats, so it was not paid.");
    await expect(pay(lnPay, "lnbc1pvjluez", 21_000)).rejects.toThrow("names no amount");
    expect(wallet.pay).not.toHaveBeenCalled();
    expect(failures).toHaveLength(2);
  });

  // NDK reads a split's weight from the wrong place in a NIP-57 zap tag and asks for NaN.
  it("says Vega could not work out the share, not that their wallet is wrong", async () => {
    const { lnPay } = zapPayment(NWC);
    for (const [amount, unit] of [[Number.NaN, "msat"], [21_000, "usd"], [0, "msat"]] as const) {
      await expect(pay(lnPay, INVOICE_21_SATS, amount, unit)).rejects.toThrow("Vega could not work out how much this zap should send, so nothing was paid.");
    }
    expect(wallet.pay).not.toHaveBeenCalled();
  });

  it("keeps the wallet's own refusal", async () => {
    wallet.pay.mockRejectedValue(new Error("Insufficient balance"));
    const { lnPay, failures } = zapPayment(NWC);
    await expect(pay(lnPay, INVOICE_21_SATS, 21_000)).rejects.toThrow("Insufficient balance");
    expect(failures[0].message).toBe("Insufficient balance");
  });
});

describe("zapTookTooLong", () => {
  it("says the sats may be on their way once the wallet was asked", async () => {
    let answer: (preimage: string) => void = () => {};
    wallet.pay.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const payment = zapPayment(NWC);
    const paying = pay(payment.lnPay, INVOICE_21_SATS, 21_000);
    await Promise.resolve();
    expect(zapTookTooLong(payment).message).toBe(ZAP_UNCONFIRMED);
    answer("preimage");
    await expect(paying).resolves.toEqual({ preimage: "preimage" });
    // A split recipient whose server answers later is not paid after the dialog has answered.
    await expect(pay(payment.lnPay, INVOICE_21_SATS, 21_000)).rejects.toThrow("stopped before it was paid");
    expect(wallet.pay).toHaveBeenCalledTimes(1);
  });

  // NDK goes on after the dialog has stopped waiting: what it asks for afterwards is not paid.
  it("stops the zap when the wallet was not asked yet, so nothing is paid later", async () => {
    const payment = zapPayment(NWC);
    expect(zapTookTooLong(payment).message).toBe("The zap took too long and was stopped. Nothing was paid.");
    await expect(pay(payment.lnPay, INVOICE_21_SATS, 21_000)).rejects.toThrow("stopped before it was paid");
    expect(wallet.pay).not.toHaveBeenCalled();
  });
});

describe("zapFailure", () => {
  const paid = { preimage: "x" };

  it("is nothing when every recipient was paid", () => {
    expect(zapFailure([paid], [], [])).toBeNull();
    expect(zapFailure([paid, paid], [], [])).toBeNull();
  });

  // NDK records a recipient whose payment step threw as undefined, not as an error: the store
  // took that for success, and the dialog said "Zapped!".
  it("is a failure for a recipient NDK left undefined, with the reason the payment step kept", () => {
    const failure = zapFailure([undefined], [new Error("The invoice from their wallet asks for 210 sats, not 21 sats, so it was not paid.")], []);
    expect(failure?.message).toBe("The invoice from their wallet asks for 210 sats, not 21 sats, so it was not paid.");
    expect(zapFailure([undefined], [new Error("Insufficient balance")], [])?.message).toBe("Insufficient balance.");
  });

  it("says NDK's reason when the payment step was never reached", () => {
    expect(zapFailure([undefined], [], ["NIP-57 attempt failed: Unable to get payment request", "Zap methods exhausted and there was no fallback to NIP-61"])?.message)
      .toBe("The zap did not go out: Unable to get payment request.");
    expect(zapFailure([undefined], [], ["Zap methods exhausted and there was no fallback to NIP-61"])?.message)
      .toBe("The zap did not go out: they have no Lightning address Vega can pay.");
    expect(zapFailure([], [], [])?.message).toBe("The zap did not go out: they have no Lightning address Vega can pay.");
    expect(zapFailure([new Error("Unable to generate zap request")], [], [])?.message).toBe("Unable to generate zap request.");
  });

  // The sats may already be on their way: "Try again" would pay twice.
  it("says a wallet that did not answer in time may still pay", () => {
    expect(zapFailure([undefined], [new NwcTimeoutError("NWC payment")], [])?.message).toBe(ZAP_UNCONFIRMED);
  });

  // The dialog offers "Try again", which would pay the ones already paid a second time.
  it("says when only some of a split zap went out, and that zapping again pays them all", () => {
    expect(zapFailure([paid, undefined], [new Error("Insufficient balance")], [])?.message)
      .toBe("Only part of this zap went out: 1 of 2 recipients was paid, and zapping again pays all of them again. Insufficient balance.");
    expect(zapFailure([paid, paid, undefined], [new NwcTimeoutError("NWC payment")], [])?.message)
      .toBe(`Only part of this zap went out: 2 of 3 recipients were paid, and zapping again pays all of them again. ${ZAP_UNCONFIRMED}`);
  });
});
