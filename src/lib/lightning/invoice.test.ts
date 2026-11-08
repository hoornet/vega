import { describe, it, expect } from "vitest";
import { invoiceAmountMsats, invoiceAmountProblem } from "./invoice";

// Invoices from the examples in BOLT 11 (lightning/bolts, 11-payment-encoding.md), byte for byte,
// under the spec's own headings.
// Please make a donation of any amount
const DONATION_ANY_AMOUNT =
  "lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql";
// Please send $3 for a cup of coffee
const COFFEE_2500U =
  "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh";
// Now send $24 for an entire list of things (hashed)
const LIST_20M =
  "lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qrsgq7ea976txfraylvgzuxs8kgcw23ezlrszfnh8r6qtfpr6cxga50aj6txm9rxrydzd06dfeawfk6swupvz4erwnyutnjq7x39ymw6j38gp7ynn44";
// The same, on testnet, with a fallback address
const TESTNET_20M =
  "lntb20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygshp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqfpp3x9et2e20v6pu37c5d9vax37wxq72un989qrsgqdj545axuxtnfemtpwkc45hx9d2ft7x04mt8q7y6t0k2dge9e7h8kpy9p34ytyslj3yu569aalz2xdk8xkd7ltxqld94u8h2esmsmacgpghe9k8";
// Please send 0.00967878534 BTC for a list of items within one week, amount in pico-BTC
const PICO_BTC =
  "lnbc9678785340p1pwmna7lpp5gc3xfm08u9qy06djf8dfflhugl6p7lgza6dsjxq454gxhj9t7a0sd8dgfkx7cmtwd68yetpd5s9xar0wfjn5gpc8qhrsdfq24f5ggrxdaezqsnvda3kkum5wfjkzmfqf3jkgem9wgsyuctwdus9xgrcyqcjcgpzgfskx6eqf9hzqnteypzxz7fzypfhg6trddjhygrcyqezcgpzfysywmm5ypxxjemgw3hxjmn8yptk7untd9hxwg3q2d6xjcmtv4ezq7pqxgsxzmnyyqcjqmt0wfjjq6t5v4khxsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsxqyjw5qcqp2rzjq0gxwkzc8w6323m55m4jyxcjwmy7stt9hwkwe2qxmy8zpsgg7jcuwz87fcqqeuqqqyqqqqlgqqqqn3qq9q9qrsgqrvgkpnmps664wgkp43l22qsgdw4ve24aca4nymnxddlnp8vh9v2sdxlu5ywdxefsfvm0fq3sesf08uf6q9a2ke0hc9j6z6wlxg5z5kqpu2v9wz";
// Same, but all upper case
const UPPER_CASE_25M =
  "LNBC25M1PVJLUEZPP5QQQSYQCYQ5RQWZQFQQQSYQCYQ5RQWZQFQQQSYQCYQ5RQWZQFQYPQDQ5VDHKVEN9V5SXYETPDEESSP5ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYGS9Q5SQQQQQQQQQQQQQQQQSGQ2A25DXL5HRNTDTN6ZVYDT7D66HYZSYHQS4WDYNAVYS42XGL6SGX9C4G7ME86A27T07MDTFRY458RTJR0V92CNMSWPSJSCGT2VCSE3SGPZ3UAPA";
// Invalid multiplier
const BAD_MULTIPLIER =
  "lnbc2500x1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpusp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs9qrsgqrrzc4cvfue4zp3hggxp47ag7xnrlr8vgcmkjxk3j5jqethnumgkpqp23z9jclu3v0a7e0aruz366e9wqdykw6dxhdzcjjhldxq0w6wgqcnu43j";
// Invalid sub-millisatoshi precision
const SUB_MSAT =
  "lnbc2500000001p1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpusp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs9qrsgq0lzc236j96a95uv0m3umg28gclm5lqxtqqwk32uuk4k6673k6n5kfvx3d2h8s295fad45fdhmusm8sjudfhlf6dcsxmfvkeywmjdkxcp99202x";

describe("invoiceAmountMsats", () => {
  it("reads the amount the spec's examples ask for", () => {
    expect(invoiceAmountMsats(COFFEE_2500U)).toBe(250_000_000n); // 2500u: 250,000 sats
    expect(invoiceAmountMsats(LIST_20M)).toBe(2_000_000_000n);
    expect(invoiceAmountMsats(TESTNET_20M)).toBe(2_000_000_000n);
    expect(invoiceAmountMsats(PICO_BTC)).toBe(967_878_534n); // 9678785340p
    expect(invoiceAmountMsats(UPPER_CASE_25M)).toBe(2_500_000_000n);
  });

  it("reads every multiplier, whole bitcoins and each network", () => {
    expect(invoiceAmountMsats("lnbc21pvjluez")).toBe(200_000_000_000n); // 2 BTC
    expect(invoiceAmountMsats("lnbc5m1pvjluez")).toBe(500_000_000n);
    expect(invoiceAmountMsats("lnbc5u1pvjluez")).toBe(500_000n);
    expect(invoiceAmountMsats("lnbc5n1pvjluez")).toBe(500n);
    expect(invoiceAmountMsats("lnbc50p1pvjluez")).toBe(5n);
    expect(invoiceAmountMsats("lnbcrt5u1pvjluez")).toBe(500_000n);
    expect(invoiceAmountMsats("lntbs5u1pvjluez")).toBe(500_000n);
    expect(invoiceAmountMsats("lnsb5u1pvjluez")).toBe(500_000n);
  });

  it("takes surrounding space and a lightning: prefix, in either case", () => {
    expect(invoiceAmountMsats(`  ${COFFEE_2500U}\n`)).toBe(250_000_000n);
    expect(invoiceAmountMsats(`lightning:${COFFEE_2500U}`)).toBe(250_000_000n);
    expect(invoiceAmountMsats(`LIGHTNING:${UPPER_CASE_25M}`)).toBe(2_500_000_000n);
  });

  it("finds no amount in an invoice that names none, or in what is not an invoice", () => {
    expect(invoiceAmountMsats(DONATION_ANY_AMOUNT)).toBeNull();
    expect(invoiceAmountMsats("lnbcrt1pvjluez")).toBeNull();
    expect(invoiceAmountMsats(BAD_MULTIPLIER)).toBeNull();
    expect(invoiceAmountMsats(SUB_MSAT)).toBeNull();
    expect(invoiceAmountMsats("lnbc0250u1pvjluez")).toBeNull(); // a leading zero
    expect(invoiceAmountMsats(`lnbc${"9".repeat(21)}p1pvjluez`)).toBeNull(); // more digits than any amount needs
    expect(invoiceAmountMsats("lno1pvjluez")).toBeNull(); // a BOLT 12 offer
    expect(invoiceAmountMsats("")).toBeNull();
    expect(invoiceAmountMsats("not an invoice")).toBeNull();
  });

  // What a server sends is JSON, and `pr` can be anything.
  it("finds none in what is not a string", () => {
    for (const value of [5, {}, null, undefined, ["lnbc5u1pvjluez"]]) expect(invoiceAmountMsats(value)).toBeNull();
  });
});

describe("invoiceAmountProblem", () => {
  it("passes an invoice for exactly the amount asked for", () => {
    expect(invoiceAmountProblem(COFFEE_2500U, 250_000_000)).toBeNull();
    expect(invoiceAmountProblem(PICO_BTC, 967_878_534)).toBeNull();
  });

  it("says what an invoice for another amount asks for", () => {
    expect(invoiceAmountProblem(COFFEE_2500U, 21_000)).toBe("asks for 250,000 sats, not 21 sats");
    expect(invoiceAmountProblem(PICO_BTC, 1000)).toBe("asks for 967,878.534 sats, not 1 sat");
    // Less than asked is refused too: it is not what was asked for.
    expect(invoiceAmountProblem(COFFEE_2500U, 300_000_000)).toBe("asks for 250,000 sats, not 300,000 sats");
  });

  it("refuses an invoice that names no amount, which would let the wallet choose, and what is not one", () => {
    expect(invoiceAmountProblem(DONATION_ANY_AMOUNT, 21_000)).toBe("names no amount");
    expect(invoiceAmountProblem(BAD_MULTIPLIER, 21_000)).toBe("does not read as a Lightning invoice");
    expect(invoiceAmountProblem(SUB_MSAT, 21_000)).toBe("does not read as a Lightning invoice");
    expect(invoiceAmountProblem(5, 21_000)).toBe("does not read as a Lightning invoice");
  });

  it("checks nothing against an amount that is not a positive whole number of millisatoshis", () => {
    for (const amount of [0, -1000, 0.5, Number.NaN, 2 ** 53]) {
      expect(invoiceAmountProblem(COFFEE_2500U, amount)).toBe("could not be checked against the amount asked for");
    }
  });
});
