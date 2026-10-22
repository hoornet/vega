// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import NDK, { NDKEvent, NDKKind, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { payInvoiceViaNWC, payKeysendViaNWC, probeWallet, NwcTimeoutError } from "./nwc";

// The two payment requests against a real relay and a small wallet of our own:
//
//   nak serve --port 28549 &
//   VEGA_WALLET_RELAY=ws://localhost:28549 npx vitest run payWallet.live
//
// Gated on the env var so CI stays hermetic. undici's WebSocket dies under jsdom, hence node.
// A relay that is down needs no relay at all and is in payWallet.test.ts.
declare const process: { env: Record<string, string | undefined> };
const RELAY = process.env.VEGA_WALLET_RELAY;

interface Asked { method: string; params: Record<string, unknown> }

/**
 * A wallet: answers each request on the relay with what `answer` returns for it (null: no answer), NIP-04
 * encrypted to the asker, after `delayMs`: a wallet paying over Lightning takes seconds.
 */
async function wallet(answer: (asked: Asked) => object | null, delayMs = 0) {
  const signer = NDKPrivateKeySigner.generate();
  const ndk = new NDK({ explicitRelayUrls: [RELAY!], enableOutboxModel: false });
  ndk.signer = signer;
  await ndk.connect(3000);
  const pubkey = signer.pubkey;
  const asked: Asked[] = [];
  // A wallet stopped while an answer was still on its way must not publish it: NDK would reconnect
  // to send it, inside the next test's count of sockets.
  let stopped = false;
  const sub = ndk.subscribe({ kinds: [NDKKind.NostrWalletConnectReq], "#p": [pubkey], since: Math.floor(Date.now() / 1000) - 5 }, { closeOnEose: false });
  // The relay does not keep ephemeral events: the wallet must be listening before the request is sent.
  await new Promise<void>((resolve) => { sub.on("eose", () => resolve()); setTimeout(resolve, 3000); });
  sub.on("event", async (req: NDKEvent) => {
    const from = ndk.getUser({ pubkey: req.pubkey });
    const request = JSON.parse(await signer.decrypt(from, req.content, "nip04")) as Asked;
    asked.push(request);
    const reply = answer(request);
    if (!reply) return;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (stopped) return;
    const res = new NDKEvent(ndk);
    res.kind = NDKKind.NostrWalletConnectRes;
    res.content = await signer.encrypt(from, JSON.stringify(reply), "nip04");
    res.tags = [["p", req.pubkey], ["e", req.id!]];
    await res.publish();
  });
  const stop = () => {
    stopped = true;
    sub.stop();
    for (const r of ndk.pool.relays.values()) { r.connectivity.resetReconnectionState(); r.connectivity.disconnect(); }
  };
  const code = `nostr+walletconnect://${pubkey}?relay=${encodeURIComponent(RELAY!)}&secret=${NDKPrivateKeySigner.generate().privateKey}`;
  return { code, pubkey, asked, stop };
}

/**
 * What the relay does with the wallet request, played on the client's own
 * socket since `nak serve` takes every event and confirms it at once.
 */
interface RelayPlay {
  /** Answers `OK false` with this reason, and the request goes no further. */
  refuse?: string;
  /** Takes the request and never confirms it; the wallet never sees it either. */
  ignore?: boolean;
  /** Passes the request on and holds the relay's OK back this long. */
  lateOkMs?: number;
  /** Passes the request on, then the connection drops this long after it. */
  dropAfterMs?: number;
  /** Passes the request on and the connection drops at once, before the relay's OK can come back. */
  dropOnWrite?: boolean;
  /** The connection goes as the subscription's REQ goes out, and no reconnect gets through. */
  vanish?: boolean;
}

/**
 * Runs `pay`, with every WebSocket it opens recorded, and keeps watching for
 * `watchMs` after it ends. A payment used to leave its wallet-relay socket
 * open for the rest of the session, one per payment: an hour of streaming left
 * dozens, each holding the connection secret.
 */
async function paying<T>(pay: () => Promise<T>, play: RelayPlay = {}, watchMs = 0) {
  const Real = globalThis.WebSocket;
  const onmessage = Object.getOwnPropertyDescriptor(Real.prototype, "onmessage")!;
  const opened: WebSocket[] = [];
  let vanished = false;
  globalThis.WebSocket = class extends Real {
    constructor(...args: ConstructorParameters<typeof WebSocket>) {
      super(...args);
      opened.push(this);
      if (vanished) queueMicrotask(() => this.close());
      // NDK reads the relay through `ws.onmessage`; a held-back OK is delivered late through it.
      Object.defineProperty(this, "onmessage", {
        get: () => onmessage.get!.call(this),
        set: (handler: ((ev: MessageEvent) => void) | null) => onmessage.set!.call(this, handler && ((ev: MessageEvent) => {
          if (play.lateOkMs && typeof ev.data === "string" && ev.data.startsWith('["OK"')) setTimeout(() => handler.call(this, ev), play.lateOkMs);
          else handler.call(this, ev);
        })),
      });
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof data === "string" && play.vanish && data.startsWith('["REQ"')) {
        vanished = true;
        this.close();
        return;
      }
      if (typeof data === "string" && data.startsWith('["EVENT"')) {
        const id = (JSON.parse(data) as [string, { id: string }])[1].id;
        if (play.refuse) {
          setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(["OK", id, false, play.refuse]) })), 5);
          return;
        }
        if (play.ignore) return;
        if (play.dropAfterMs) setTimeout(() => this.close(), play.dropAfterMs);
        if (play.dropOnWrite) {
          super.send(data);
          this.close();
          return;
        }
      }
      super.send(data);
    }
  } as typeof WebSocket;
  try {
    const started = Date.now();
    const result = await pay().then((value) => ({ value, err: null }), (err: Error) => ({ value: null, err }));
    const took = Date.now() - started;
    const ended = opened.length;
    await new Promise((resolve) => setTimeout(resolve, Math.max(300, watchMs))); // a close is not instant
    return { ...result, preimage: result.value, took, opened, openedAfter: opened.length - ended, open: opened.filter((ws) => ws.readyState < WebSocket.CLOSING).length };
  } finally {
    globalThis.WebSocket = Real;
  }
}

const stops: Array<() => void> = [];
afterEach(() => { for (const s of stops.splice(0)) s(); });

describe.skipIf(!RELAY)("paying through a wallet, against a real relay", () => {
  it("pays an invoice: the wallet's preimage comes back, and the relay is let go of", async () => {
    const w = await wallet(() => ({ result_type: "pay_invoice", result: { preimage: "aa".repeat(32) } })); stops.push(w.stop);
    const r = await paying(() => payInvoiceViaNWC(w.code, "lnbc1test", { answerMs: 5000 }));
    expect(r.err).toBeNull();
    expect(r.preimage).toBe("aa".repeat(32));
    expect(w.asked).toEqual([{ method: "pay_invoice", params: { invoice: "lnbc1test" } }]);
    expect(r.opened.length).toBeGreaterThan(0);
    expect(r.open).toBe(0);
  }, 20_000);

  it("pays by keysend with the records the podcast names, and lets go of the relay", async () => {
    const w = await wallet(() => ({ result_type: "pay_keysend", result: { preimage: "bb".repeat(32) } })); stops.push(w.stop);
    const node = "02" + "cd".repeat(32);
    const r = await paying(() => payKeysendViaNWC(w.code, node, 21000, [{ type: 7629169, value: "episode" }], { answerMs: 5000 }));
    expect(r.err).toBeNull();
    expect(r.preimage).toBe("bb".repeat(32));
    expect(w.asked).toEqual([{ method: "pay_keysend", params: { pubkey: node, amount: 21000, tlv_records: [{ type: 7629169, value: "episode" }] } }]);
    expect(r.open).toBe(0);
  }, 20_000);

  // A refusal comes back within milliseconds: a spent budget, a method the
  // connection may not use. The reply is ephemeral, so if it reaches the relay
  // before the payment's REQ does, it is gone, and the payment then ran out its
  // wait as a timeout, which streaming counts as sent: sats that never left.
  it("hears a wallet that refuses at once, with the wallet's own reason", async () => {
    const w = await wallet(() => ({ result_type: "pay_invoice", error: { code: "QUOTA_EXCEEDED", message: "Budget exceeded" } })); stops.push(w.stop);
    for (let i = 0; i < 3; i++) {
      const r = await paying(() => payInvoiceViaNWC(w.code, `lnbc1test${i}`, { answerMs: 5000 }));
      expect(r.err).not.toBeInstanceOf(NwcTimeoutError);
      expect(r.err?.message).toBe("Budget exceeded");
      expect(r.open).toBe(0);
    }
  }, 60_000);

  // NDK never rejects the publish of an ephemeral event, and a wallet request is
  // one: it resolves with no relays. The code waited on a rejection that could
  // not come, so a refusal ran out the 30 s as a timeout, counted as sent.
  it("fails at once on a relay that refuses the request, with the relay's reason", async () => {
    const w = await wallet(() => ({ result_type: "pay_invoice", result: { preimage: "cc".repeat(32) } })); stops.push(w.stop);
    const r = await paying(() => payInvoiceViaNWC(w.code, "lnbc1test", { answerMs: 10_000 }), { refuse: "blocked: not today" });
    expect(r.err).not.toBeInstanceOf(NwcTimeoutError);
    expect(r.err?.message).toBe("Your wallet's relay (localhost:28549) refused the request: blocked: not today");
    expect(r.took).toBeLessThan(4000);
    expect(w.asked).toHaveLength(0);
    expect(r.open).toBe(0);
  }, 30_000);

  // A busy relay may pass the request on and confirm it after NDK's 2.5 s.
  // Failing the payment then would offer it again, and a second zap pays twice.
  it("waits for the wallet when the relay confirms late, and is paid", async () => {
    const w = await wallet(() => ({ result_type: "pay_invoice", result: { preimage: "ee".repeat(32) } }), 3500); stops.push(w.stop);
    const r = await paying(() => payInvoiceViaNWC(w.code, "lnbc1test", { answerMs: 10_000 }), { lateOkMs: 3000 });
    expect(r.err).toBeNull();
    expect(r.preimage).toBe("ee".repeat(32));
    expect(r.open).toBe(0);
  }, 30_000);

  it("counts a request the relay never confirmed as sent, not as failed: it may have gone out", async () => {
    const w = await wallet(() => null); stops.push(w.stop);
    const r = await paying(() => payKeysendViaNWC(w.code, "02" + "cd".repeat(32), 1000, [], { answerMs: 4000 }), { ignore: true });
    expect(r.err).toBeInstanceOf(NwcTimeoutError);
    expect(r.open).toBe(0);
  }, 30_000);

  // The connection goes after the request was written and before the OK: the
  // wallet may well have it, and pay. NDK words this "Authentication failed:
  // Relay … disconnected", which was read as the relay's refusal.
  it("counts a request whose connection dropped before the OK as sent: the wallet may have it", async () => {
    const w = await wallet(() => ({ result_type: "pay_invoice", result: { preimage: "ab".repeat(32) } })); stops.push(w.stop);
    const r = await paying(() => payInvoiceViaNWC(w.code, "lnbc1test", { answerMs: 4000 }), { dropOnWrite: true });
    expect(r.err).toBeInstanceOf(NwcTimeoutError);
    expect(w.asked).toHaveLength(1);
    expect(r.open).toBe(0);
  }, 30_000);

  it("fails as unreachable when the relay went before the request could be written", async () => {
    const w = await wallet(() => ({ result_type: "pay_invoice", result: { preimage: "ff".repeat(32) } })); stops.push(w.stop);
    const r = await paying(() => payInvoiceViaNWC(w.code, "lnbc1test", { answerMs: 15_000 }), { vanish: true });
    expect(r.err).not.toBeInstanceOf(NwcTimeoutError);
    expect(r.err?.message).toBe("Your wallet's relay (localhost:28549) could not be reached");
    expect(r.took).toBeLessThan(8000);
    expect(w.asked).toHaveLength(0);
    expect(r.open).toBe(0);
  }, 30_000);

  // A relay that drops schedules a reconnect, a second away, and
  // connectivity.disconnect() leaves it: it then opened the socket again after
  // the payment had ended, and kept it. The drop comes half a second before the
  // payment ends, so the reconnect falls after it.
  it("does not reconnect after the payment ends, when the relay dropped near its end", async () => {
    const w = await wallet(() => null); stops.push(w.stop);
    const r = await paying(() => payInvoiceViaNWC(w.code, "lnbc1test", { answerMs: 2500 }), { dropAfterMs: 2000 }, 4000);
    expect(r.err).toBeInstanceOf(NwcTimeoutError);
    expect(r.openedAfter).toBe(0);
    expect(r.open).toBe(0);
  }, 30_000);

  it("calls a wallet unreachable at once when its relay refuses the probe", async () => {
    const w = await wallet(() => ({ result_type: "get_info", result: { alias: "test" } })); stops.push(w.stop);
    const r = await paying(() => probeWallet(w.code, 10_000), { refuse: "blocked: not today" });
    expect(r.value).toBe("unreachable");
    expect(r.took).toBeLessThan(6000);
    expect(r.open).toBe(0);
  }, 30_000);

  it("waits for the wallet's answer to the probe when the relay confirms late", async () => {
    const w = await wallet(() => ({ result_type: "get_info", result: { alias: "test" } }), 3500); stops.push(w.stop);
    const r = await paying(() => probeWallet(w.code, 10_000), { lateOkMs: 3000 });
    expect(r.value).toBe("ok");
  }, 30_000);

  it("times out on a wallet that never answers, and still lets go of the relay", async () => {
    const w = await wallet(() => null); stops.push(w.stop);
    const r = await paying(() => payInvoiceViaNWC(w.code, "lnbc1test", { answerMs: 2000 }));
    expect(r.err).toBeInstanceOf(NwcTimeoutError);
    expect(w.asked).toHaveLength(1);
    expect(r.open).toBe(0);
  }, 45_000);
});
