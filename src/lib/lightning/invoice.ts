// What a Lightning invoice asks to be paid, read before it is paid.
//
// Vega asks a recipient's server (LNURL-pay) for an invoice of N sats, and the wallet pays
// whatever the invoice says, not what was asked for. LUD-06 has the payer check that the two
// agree. Until October 2026 Vega did not: podcast streaming, boosts and zaps paid the invoice as
// it came, so the recipient's server, one that had been taken over, or anyone able to answer in
// its place could ask for any amount, and only the wallet's own spending limit stood in the way.
// The streaming caps and the weekly budget counted the sats asked for, not the sats paid.

const MSATS_PER_BTC = 100_000_000_000n;
/** Millisatoshis in one unit of each multiplier. A pico-bitcoin (`p`) is a tenth of one, handled apart. */
const MSATS_PER_UNIT: Record<string, bigint> = { m: 100_000_000n, u: 100_000n, n: 100n };

// The network (mainnet, testnet, regtest, signet), then the amount and its multiplier. An offer
// (BOLT 12, `lno1…`) is not an invoice. Twenty digits hold every amount there can be; a longer
// run would only make a longer sentence.
const NO_AMOUNT = /^ln(?:bcrt|bc|tbs|tb|sb)$/;
const WITH_AMOUNT = /^ln(?:bcrt|bc|tbs|tb|sb)([1-9]\d{0,19})([munp]?)$/;

type ReadAmount = { kind: "amount"; msats: bigint } | { kind: "any" } | { kind: "invalid" };

/**
 * The amount from an invoice's human-readable part: `lnbc2500u1…` is 2500 micro-bitcoin. That part
 * is covered by the invoice's signature, so it is the amount the wallet pays. The checksum and the
 * signature are the wallet's to check: an invoice that fails them is not paid at all.
 */
function readAmount(invoice: unknown): ReadAmount {
  // What a server sends is JSON: `pr` can be anything.
  if (typeof invoice !== "string") return { kind: "invalid" };
  const text = invoice.trim().toLowerCase().replace(/^lightning:/, "");
  // The data part's alphabet has no "1", so the last one is the separator.
  const hrp = text.slice(0, Math.max(0, text.lastIndexOf("1")));
  if (NO_AMOUNT.test(hrp)) return { kind: "any" };
  const match = WITH_AMOUNT.exec(hrp);
  if (!match) return { kind: "invalid" };
  const value = BigInt(match[1]);
  const unit = match[2];
  if (unit === "") return { kind: "amount", msats: value * MSATS_PER_BTC };
  if (unit === "p") return value % 10n === 0n ? { kind: "amount", msats: value / 10n } : { kind: "invalid" };
  return { kind: "amount", msats: value * MSATS_PER_UNIT[unit] };
}

/** The amount a BOLT 11 invoice asks for, in millisatoshis; null when it names none or is not an invoice. */
export function invoiceAmountMsats(invoice: unknown): bigint | null {
  const read = readAmount(invoice);
  return read.kind === "amount" ? read.msats : null;
}

function satsText(msats: bigint): string {
  if (msats === 1000n) return "1 sat";
  if (msats % 1000n === 0n) return `${(msats / 1000n).toLocaleString("en-US")} sats`;
  return `${(Number(msats) / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} sats`;
}

/**
 * Why `invoice` must not be paid for `expectedMsats`, as the end of a sentence about the invoice
 * ("asks for 5,000 sats, not 21 sats"), or null when it asks for exactly that.
 *
 * An invoice that names no amount is refused too: the wallet would be the one to choose it.
 */
export function invoiceAmountProblem(invoice: unknown, expectedMsats: number): string | null {
  if (!Number.isSafeInteger(expectedMsats) || expectedMsats <= 0) return "could not be checked against the amount asked for";
  const read = readAmount(invoice);
  if (read.kind === "invalid") return "does not read as a Lightning invoice";
  if (read.kind === "any") return "names no amount";
  const expected = BigInt(expectedMsats);
  if (read.msats !== expected) return `asks for ${satsText(read.msats)}, not ${satsText(expected)}`;
  return null;
}
