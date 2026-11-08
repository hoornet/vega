import type { LnPayCb } from "@nostr-dev-kit/ndk";
import { payInvoiceViaNWC, NwcTimeoutError } from "./nwc";
import { invoiceAmountProblem } from "./invoice";
import { clipText, endSentence } from "../utils";

/** What is said when the sats may be on their way: "Try again" would pay twice. */
export const ZAP_UNCONFIRMED = "Your wallet did not confirm the zap in time. It may still go through, so check your wallet before you zap again.";

export interface ZapPayment {
  /** The payment step NDK's zapper calls. */
  lnPay: LnPayCb;
  /** What the payment step threw, which NDK keeps to itself. */
  failures: Error[];
  /** Whether the wallet has been asked to pay. */
  walletAsked: () => boolean;
  /** Pays nothing more: a call that comes after this throws without asking the wallet. */
  giveUp: () => void;
}

/**
 * The payment step NDK's zapper calls (`lnPay`) with the invoice the recipient's server returned
 * and the amount it asked that server for. It pays through the wallet only when the two agree.
 *
 * NDK catches whatever this step throws, says it in a "notice" and records the recipient as
 * `undefined`, not as an error, so `failures` keeps what went wrong for `zapFailure`.
 */
export function zapPayment(nwcUri: string): ZapPayment {
  const failures: Error[] = [];
  let asked = false;
  let gaveUp = false;
  const lnPay: LnPayCb = async ({ pr, amount, unit }) => {
    try {
      if (gaveUp) throw new Error("The zap was stopped before it was paid.");
      const expectedMsats = unit === "msat" ? amount : unit === "sat" ? amount * 1000 : Number.NaN;
      // NDK works out each recipient's share; a share it could not work out is Vega's to say, not their wallet's.
      if (!Number.isSafeInteger(expectedMsats) || expectedMsats <= 0) {
        throw new Error("Vega could not work out how much this zap should send, so nothing was paid.");
      }
      const problem = invoiceAmountProblem(pr, expectedMsats);
      if (problem) throw new Error(`The invoice from their wallet ${problem}, so it was not paid.`);
      asked = true;
      return { preimage: await payInvoiceViaNWC(nwcUri, pr) };
    } catch (err) {
      failures.push(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };
  return { lnPay, failures, walletAsked: () => asked, giveUp: () => { gaveUp = true; } };
}

/**
 * What the zap dialog says when the zap has taken longer than it waits. Nothing more is paid from
 * then on, including a split recipient whose server has not answered yet; a payment the wallet
 * was already asked for may still go through.
 */
export function zapTookTooLong(payment: ZapPayment): Error {
  payment.giveUp();
  if (payment.walletAsked()) return new Error(ZAP_UNCONFIRMED);
  return new Error("The zap took too long and was stopped. Nothing was paid.");
}

const NIP57_FAILED = "NIP-57 attempt failed: ";

/**
 * How a zap ended, from what NDK's zapper reported when it completed: null when every recipient
 * was paid, else the error the zap dialog shows.
 *
 * Until October 2026 the store took only an `Error` among the results for a failure. NDK records a
 * recipient whose payment step threw as `undefined`, so a wallet that refused, a spent budget and
 * an invoice for the wrong amount all read "Zapped!".
 *
 * A wallet that did not answer in time may still pay, and a zap that paid some of its recipients
 * pays them again if it is sent again: both are said, because the dialog offers "Try again".
 */
export function zapFailure(outcomes: readonly unknown[], failures: readonly Error[], notices: readonly string[]): Error | null {
  const paid = outcomes.filter((outcome) => outcome !== undefined && outcome !== null && !(outcome instanceof Error)).length;
  if (outcomes.length > 0 && paid === outcomes.length) return null;
  const part = paid > 0
    ? `Only part of this zap went out: ${paid} of ${outcomes.length} recipients ${paid === 1 ? "was" : "were"} paid, and zapping again pays all of them again. `
    : "";
  if (failures.some((failure) => failure instanceof NwcTimeoutError)) return new Error(`${part}${ZAP_UNCONFIRMED}`);
  const notice = notices.filter((text) => text.startsWith(NIP57_FAILED)).pop();
  const reason =
    failures[0]?.message ??
    outcomes.find((outcome): outcome is Error => outcome instanceof Error)?.message ??
    (notice ? `The zap did not go out: ${clipText(notice.slice(NIP57_FAILED.length), 140)}` : "The zap did not go out: they have no Lightning address Vega can pay.");
  // A wallet's own words can be long.
  return new Error(`${part}${endSentence(clipText(reason, 200))}`);
}
