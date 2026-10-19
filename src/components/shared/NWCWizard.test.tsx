import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// The wallet wizard after the October 2026 UI review: plain words, a wallet
// that is "connected" only once it has answered, and a code that is kept
// whatever the wallet says, with Try again.

const probe = vi.hoisted(() => ({ answer: "ok" as "ok" | "refused" | "unreachable", calls: 0 }));
vi.mock("../../lib/lightning/nwc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/lightning/nwc")>();
  return { ...real, probeWallet: vi.fn(async () => { probe.calls += 1; return probe.answer; }) };
});
vi.mock("../../stores/user", () => ({ useUserStore: () => ({ pubkey: "me" }) }));

import { NWCWizard } from "./NWCWizard";
import { useLightningStore } from "../../stores/lightning";

const CODE = "nostr+walletconnect://" + "a".repeat(64) + "?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&secret=" + "b".repeat(64);

beforeEach(() => { localStorage.clear(); probe.answer = "ok"; probe.calls = 0; useLightningStore.setState({ nwcUri: null, walletStatus: "unknown" }); });
afterEach(cleanup);

describe("NWCWizard", () => {
  it("offers each wallet's steps, and the wallet itself, in the user's words, with no primary among the cards", () => {
    render(<NWCWizard />);
    const steps = screen.getAllByRole("button", { name: "Show steps" });
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.every((b) => !b.className.includes("bg-accent"))).toBe(true);
    expect(screen.getAllByRole("link", { name: /Get this wallet/ }).length).toBeGreaterThan(1);
    fireEvent.click(steps[0]);
    expect(screen.getByRole("heading", { level: 3, name: /^Connect / })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All wallets" })).toBeTruthy();
    expect(screen.getByText(/treat it like a password/)).toBeTruthy();
    expect(screen.queryByText(/URI|NWC/)).toBeNull();
  });

  it("asks the wallet after a code is pasted, and says Connected once it answered", async () => {
    render(<NWCWizard />);
    fireEvent.click(screen.getByRole("button", { name: /I already have a connection code/ }));
    fireEvent.change(screen.getByPlaceholderText(/nostr\+walletconnect/), { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await screen.findByText("Connected");
    expect(probe.calls).toBe(1);
    expect(useLightningStore.getState().nwcUri).toBe(CODE);
    expect(screen.getByRole("status").textContent).toBe("Connected");
    expect(screen.getByText(/Your wallet answered/)).toBeTruthy();
  });

  it("says when the wallet does not know the code, and keeps the code", async () => {
    probe.answer = "refused";
    render(<NWCWizard />);
    fireEvent.click(screen.getByRole("button", { name: /I already have a connection code/ }));
    fireEvent.change(screen.getByPlaceholderText(/nostr\+walletconnect/), { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await screen.findByText("Not recognised");
    expect(useLightningStore.getState().nwcUri).toBe(CODE);
    expect(screen.getByText(/does not recognise this code/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps a code the wallet did not answer for, says so, and asks again on Try again", async () => {
    probe.answer = "unreachable";
    render(<NWCWizard />);
    fireEvent.click(screen.getByRole("button", { name: /I already have a connection code/ }));
    fireEvent.change(screen.getByPlaceholderText(/nostr\+walletconnect/), { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await screen.findByText("Not reached");
    expect(useLightningStore.getState().nwcUri).toBe(CODE);
    expect(screen.getByText(/could not reach this wallet/)).toBeTruthy();
    probe.answer = "ok";
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Connected");
  });

  it("asks a wallet it has not asked yet when shown already connected, and does not call a stored string connected", async () => {
    useLightningStore.setState({ nwcUri: CODE, walletStatus: "unknown" });
    render(<NWCWizard />);
    expect(screen.getByRole("status").textContent).toBe("Checking…");
    await screen.findByText("Connected");
    expect(probe.calls).toBe(1);
  });

  it("words a bad code as a sentence", () => {
    render(<NWCWizard />);
    fireEvent.click(screen.getByRole("button", { name: /I already have a connection code/ }));
    fireEvent.change(screen.getByPlaceholderText(/nostr\+walletconnect/), { target: { value: "nostr+walletconnect://abc" } });
    expect(screen.getByText(/This code is not complete/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/nostr\+walletconnect/), { target: { value: "hello" } });
    expect(screen.getByText(/starts with nostr\+walletconnect/)).toBeTruthy();
  });
});
