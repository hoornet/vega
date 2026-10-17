import { describe, it, expect, vi, beforeEach } from "vitest";

// The wallet's word belongs to one code. Another account's code is another
// wallet, and two checks can end in either order.
const probe = vi.hoisted(() => ({ pending: [] as Array<(v: "ok" | "refused" | "unreachable") => void> }));
vi.mock("../lib/lightning/nwc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/lightning/nwc")>();
  return { ...real, probeWallet: vi.fn(() => new Promise<"ok" | "refused" | "unreachable">((resolve) => { probe.pending.push(resolve); })) };
});
vi.mock("../lib/nostr", () => ({ getNDK: () => ({}) }));

import { useLightningStore } from "./lightning";

const code = (n: string) => "nostr+walletconnect://" + n.repeat(64) + "?relay=wss%3A%2F%2Frelay.example&secret=" + "b".repeat(64);
const answer = async (v: "ok" | "refused" | "unreachable", which = 0) => { probe.pending[which]?.(v); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { localStorage.clear(); probe.pending = []; useLightningStore.setState({ nwcUri: null, walletStatus: "unknown" }); });

describe("useLightningStore: the wallet's word", () => {
  it("is unknown again for another account's code, and kept for the same code", () => {
    localStorage.setItem("wrystr_nwc_a", code("a"));
    localStorage.setItem("wrystr_nwc_b", code("c"));
    useLightningStore.setState({ nwcUri: code("a"), walletStatus: "ok" });
    useLightningStore.getState().loadNwcForAccount("a");
    expect(useLightningStore.getState().walletStatus).toBe("ok");
    useLightningStore.getState().loadNwcForAccount("b");
    expect(useLightningStore.getState().walletStatus).toBe("unknown");
    useLightningStore.setState({ walletStatus: "ok" });
    useLightningStore.getState().forgetAccount("b", true);
    expect(useLightningStore.getState()).toMatchObject({ nwcUri: null, walletStatus: "unknown" });
  });

  it("keeps only the newest check's answer, and none for a code that was replaced", async () => {
    useLightningStore.setState({ nwcUri: code("a") });
    const first = useLightningStore.getState().checkWallet();
    expect(useLightningStore.getState().walletStatus).toBe("checking");
    const second = useLightningStore.getState().checkWallet();
    await answer("ok", 1);
    expect(useLightningStore.getState().walletStatus).toBe("ok");
    // The slow first check ends later: its word is stale.
    await answer("unreachable", 0);
    expect(useLightningStore.getState().walletStatus).toBe("ok");
    await Promise.all([first, second]);
    // A check for a code that is gone by the time it answers says nothing.
    const third = useLightningStore.getState().checkWallet();
    useLightningStore.getState().setNwcUri(code("c"));
    await answer("refused", 2);
    expect(useLightningStore.getState().walletStatus).toBe("unknown");
    await third;
  });
});
