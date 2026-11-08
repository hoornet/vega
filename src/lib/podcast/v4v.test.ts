import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PodcastEpisode } from "../../types/podcast";

const wallet = vi.hoisted(() => ({ answer: "paid" as "paid" | "timeout" | "error" | "unpublished" }));
vi.mock("../lightning/nwc", async () => {
  const actual = await vi.importActual<typeof import("../lightning/nwc")>("../lightning/nwc");
  const pay = async () => {
    if (wallet.answer === "paid") return "preimage";
    if (wallet.answer === "timeout") throw new actual.NwcTimeoutError("NWC payment");
    if (wallet.answer === "unpublished") throw new Error("Not enough relays received the event (0 published, 1 required)");
    throw new Error("Insufficient balance");
  };
  return { ...actual, payInvoiceViaNWC: vi.fn(pay), payKeysendViaNWC: vi.fn(pay) };
});
// The recipient's server. By default it answers with an invoice for exactly the amount asked
// (`amount=`, in millisatoshis; one millisatoshi is ten pico-bitcoin, `p`).
// Each address's server has its own callback, so `host` says whose invoice is asked for.
type InvoiceFor = (msats: number, host: string) => string | null;
const exact: InvoiceFor = (msats) => `lnbc${msats * 10}p1pvjluez`;
const lnurl = vi.hoisted(() => ({ invoice: null as unknown as (msats: number, host: string) => string | null }));
vi.mock("../proxy", () => ({
  fetchWithProxy: async (url: string) => {
    const request = new URL(url);
    const invoice = lnurl.invoice(Number(request.searchParams.get("amount")), request.host);
    return {
      ok: invoice !== null,
      json: async () => (url.includes("/.well-known/") ? { callback: `https://${request.host}/cb` } : { pr: invoice }),
    };
  },
}));

import { startStreaming, stopStreaming, boost } from "./v4v";
import { useV4VStore } from "../../stores/v4v";
import { useToastStore } from "../../stores/toast";
import { payInvoiceViaNWC } from "../lightning/nwc";

const episode = {
  guid: "ep1", title: "Episode", showTitle: "Show",
  value: [{ name: "Host", address: "host@pay.example", split: 100 }],
} as unknown as PodcastEpisode;
const NWC = "nostr+walletconnect://w?relay=wss://r&secret=s";
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);
/** Five minutes: the loop accumulates that long before it pays. */
const fiveMinutes = async () => { await vi.advanceTimersByTimeAsync(5 * 60000 + 50); };

beforeEach(() => {
  vi.useFakeTimers();
  wallet.answer = "paid";
  lnurl.invoice = exact;
  useV4VStore.setState({ currentEpisodeSats: 0, unconfirmedSats: 0, lastFailure: null, capReachedReason: null, perEpisodeCap: 0, weeklyBudget: 0 });
  useToastStore.setState({ toasts: [] });
  vi.mocked(payInvoiceViaNWC).mockClear();
});
afterEach(() => { stopStreaming(); vi.useRealTimers(); });

describe("streaming: what is counted", () => {
  it("counts a payment the wallet confirmed", async () => {
    const counted: number[] = [];
    startStreaming(episode, 10, NWC, (sats) => counted.push(sats));
    await fiveMinutes();
    expect(counted).toEqual([50]);
    expect(payInvoiceViaNWC).toHaveBeenCalledWith(NWC, "lnbc500000p1pvjluez");
    expect(useV4VStore.getState().currentEpisodeSats).toBe(50);
    expect(useV4VStore.getState().unconfirmedSats).toBe(0);
    expect(toasts()).toEqual([]);
  });

  // The sats left; the wallet was slow to say so. The counter stayed at zero
  // while 1-sat payments were arriving on the recipient's hub.
  it("counts a payment the wallet did not answer in time, and says it is unconfirmed", async () => {
    wallet.answer = "timeout";
    const counted: number[] = [];
    startStreaming(episode, 10, NWC, (sats) => counted.push(sats));
    await fiveMinutes();
    expect(counted).toEqual([50]);
    expect(useV4VStore.getState().currentEpisodeSats).toBe(50);
    expect(useV4VStore.getState().unconfirmedSats).toBe(50);
    expect(useV4VStore.getState().lastFailure).toBeNull();
    expect(toasts()).toEqual([]);
  });

  it("does not count a payment the wallet refused, and says so once per recipient", async () => {
    wallet.answer = "error";
    const counted: number[] = [];
    startStreaming(episode, 10, NWC, (sats) => counted.push(sats));
    await fiveMinutes();
    expect(counted).toEqual([]);
    expect(useV4VStore.getState().currentEpisodeSats).toBe(0);
    expect(useV4VStore.getState().lastFailure).toMatchObject({ recipient: "Host", reason: "Insufficient balance" });
    expect(toasts()).toEqual(["Couldn't pay Host: Insufficient balance. Streaming goes on."]);
    // The toast has closed itself by the next payment; it is not said again.
    useToastStore.setState({ toasts: [] });
    await fiveMinutes();
    expect(toasts()).toEqual([]);
    expect(useV4VStore.getState().lastFailure?.at).toBeTruthy();
  });

  it("does not count a request no relay took", async () => {
    wallet.answer = "unpublished";
    startStreaming(episode, 10, NWC, () => {});
    await fiveMinutes();
    expect(useV4VStore.getState().currentEpisodeSats).toBe(0);
    expect(useV4VStore.getState().lastFailure?.reason).toContain("Not enough relays");
  });

  it("says when no invoice came, without asking the wallet", async () => {
    lnurl.invoice = () => null;
    startStreaming(episode, 10, NWC, () => {});
    await fiveMinutes();
    expect(payInvoiceViaNWC).not.toHaveBeenCalled();
    expect(useV4VStore.getState().lastFailure?.reason).toBe("no invoice came from host@pay.example");
    expect(toasts()).toHaveLength(1);
  });

  // The wallet pays what the invoice says, not what was asked for. Until October 2026 a server
  // could ask for any amount, and the caps counted the sats asked for, not the sats paid.
  it("does not pay an invoice for another amount than it asked for, and says what it asked for", async () => {
    lnurl.invoice = (msats, host) => exact(msats * 10, host);
    const counted: number[] = [];
    startStreaming(episode, 10, NWC, (sats) => counted.push(sats));
    await fiveMinutes();
    expect(payInvoiceViaNWC).not.toHaveBeenCalled();
    expect(counted).toEqual([]);
    expect(useV4VStore.getState().currentEpisodeSats).toBe(0);
    expect(useV4VStore.getState().lastFailure?.reason).toBe("the invoice from host@pay.example asks for 500 sats, not 50 sats");
    expect(toasts()).toEqual(["Couldn't pay Host: the invoice from host@pay.example asks for 500 sats, not 50 sats. Streaming goes on."]);
  });

  it("does not pay an invoice that names no amount, which would let the wallet choose", async () => {
    lnurl.invoice = () => "lnbc1pvjluez";
    startStreaming(episode, 10, NWC, () => {});
    await fiveMinutes();
    expect(payInvoiceViaNWC).not.toHaveBeenCalled();
    expect(useV4VStore.getState().lastFailure?.reason).toBe("the invoice from host@pay.example names no amount");
  });

  it("starts each episode with a clean slate", async () => {
    wallet.answer = "error";
    startStreaming(episode, 10, NWC, () => {});
    await fiveMinutes();
    expect(toasts()).toHaveLength(1);
    stopStreaming();
    useToastStore.setState({ toasts: [] });
    startStreaming(episode, 10, NWC, () => {});
    expect(useV4VStore.getState().lastFailure).toBeNull();
    await fiveMinutes();
    expect(toasts()).toHaveLength(1);
  });
});

describe("streaming: one round at a time", () => {
  it("does not start the next round while a wallet is still being waited for", async () => {
    let finish: (v: string) => void = () => {};
    vi.mocked(payInvoiceViaNWC).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    startStreaming(episode, 10, NWC, () => {});
    await fiveMinutes();
    expect(payInvoiceViaNWC).toHaveBeenCalledTimes(1);
    // Five more minutes pass with the wallet silent: no second round, and nothing counted.
    await fiveMinutes();
    expect(payInvoiceViaNWC).toHaveBeenCalledTimes(1);
    expect(useV4VStore.getState().currentEpisodeSats).toBe(0);
    finish("preimage");
    await vi.advanceTimersByTimeAsync(10);
    expect(useV4VStore.getState().currentEpisodeSats).toBe(50);
  });
});

describe("boost", () => {
  it("counts what was paid or sent, and reports what was not", async () => {
    wallet.answer = "timeout";
    expect(await boost(episode, 21, NWC)).toBe(21);
    wallet.answer = "error";
    expect(await boost(episode, 21, NWC)).toBe(0);
    expect(useV4VStore.getState().lastFailure?.reason).toBe("Insufficient balance");
  });

  // `pr` is JSON from the recipient's server. Read as a string, a number threw out of the round,
  // the Boost button stayed busy and the recipients after it were never paid.
  it("takes an answer that is not an invoice for no invoice, and pays the next recipient", async () => {
    const two = {
      ...episode,
      value: [{ name: "Bad", address: "x@bad.example", split: 50 }, { name: "Good", address: "y@good.example", split: 50 }],
    } as unknown as PodcastEpisode;
    lnurl.invoice = ((msats: number, host: string) => (host === "bad.example" ? 5 : exact(msats, host))) as unknown as InvoiceFor;
    expect(await boost(two, 20, NWC)).toBe(10);
    expect(payInvoiceViaNWC).toHaveBeenCalledTimes(1);
    expect(useV4VStore.getState().lastFailure).toMatchObject({ recipient: "Bad", reason: "no invoice came from x@bad.example" });
  });

  it("does not pay an invoice for another amount", async () => {
    lnurl.invoice = (msats, host) => exact(msats * 10, host);
    expect(await boost(episode, 21, NWC)).toBe(0);
    expect(payInvoiceViaNWC).not.toHaveBeenCalled();
    expect(useV4VStore.getState().lastFailure?.reason).toBe("the invoice from host@pay.example asks for 210 sats, not 21 sats");
  });
});
