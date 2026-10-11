import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const zap = vi.fn();
const setView = vi.fn();
const state = { nwcUri: "nostr+walletconnect://x" as string | null, canSign: true };
vi.mock("../../stores/lightning", () => ({ useLightningStore: () => ({ nwcUri: state.nwcUri, zap }) }));
vi.mock("../../stores/ui", () => ({ useUIStore: () => ({ setView }) }));
vi.mock("../../stores/user", () => ({ useCanSign: () => state.canSign }));
vi.mock("../shared/LoginModal", () => ({ LoginModal: () => <div>login dialog</div> }));

import { ZapModal } from "./ZapModal";

const onClose = vi.fn();
const target = { type: "profile", pubkey: "p1" } as never;
const open = () => render(<ZapModal target={target} recipientName="Alice" onClose={onClose} />);
const dialog = () => screen.getByRole("dialog");
const zapButton = () => screen.getByRole("button", { name: /^Zap/ }) as HTMLButtonElement;
const pressBackdrop = () => { fireEvent.pointerDown(dialog()); fireEvent.click(dialog()); };

beforeEach(() => { vi.clearAllMocks(); state.nwcUri = "nostr+walletconnect://x"; state.canSign = true; zap.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

describe("ZapModal", () => {
  it("is a dialog named for who is being zapped", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Zap Alice" })).toBe(dialog());
  });

  // The dialog puts focus in the first field when it opens. That field used
  // to switch to "custom amount" on focus, which cleared the amount and
  // disabled the button: every zap needed an extra click.
  it("opens ready to send the default amount", () => {
    open();
    expect(zapButton().textContent).toContain("21 sats");
    expect(zapButton().disabled).toBe(false);
    fireEvent.click(zapButton());
    expect(zap).toHaveBeenCalledWith(target, 21, undefined);
  });

  it("does not change the amount when the custom field is only focused", () => {
    open();
    const custom = screen.getByPlaceholderText("custom amount…");
    custom.focus();
    fireEvent.focus(custom);
    expect(zapButton().textContent).toContain("21 sats");
  });

  it("uses the custom amount once one is typed, and a preset again once one is picked", () => {
    open();
    fireEvent.change(screen.getByPlaceholderText("custom amount…"), { target: { value: "750" } });
    expect(zapButton().textContent).toContain("750 sats");
    fireEvent.click(screen.getByRole("button", { name: "100" }));
    expect(zapButton().textContent).toContain("100 sats");
  });

  it("will not send nothing", () => {
    open();
    const custom = screen.getByPlaceholderText("custom amount…");
    fireEvent.change(custom, { target: { value: "5" } });
    fireEvent.change(custom, { target: { value: "" } });
    expect(zapButton().disabled).toBe(true);
    fireEvent.click(zapButton());
    expect(zap).not.toHaveBeenCalled();
  });

  it("says when no wallet is connected, and offers the way to connect one", () => {
    state.nwcUri = null;
    open();
    expect(screen.getByText("No wallet connected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Go to settings/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(setView).toHaveBeenCalledWith("settings");
  });

  it("closes on a backdrop press while nothing would be lost", () => {
    open();
    pressBackdrop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps a typed comment when the backdrop is pressed", () => {
    open();
    fireEvent.change(screen.getByPlaceholderText("Great post!"), { target: { value: "thank you for this" } });
    pressBackdrop();
    expect(onClose).not.toHaveBeenCalled();
  });

  // The result of a payment appears here and nowhere else.
  it("stays open while a payment is in flight, and shows a failure", async () => {
    let fail: (e: Error) => void = () => {};
    zap.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    open();
    fireEvent.click(zapButton());
    expect(screen.getByText(/Sending 21 sats/)).toBeTruthy();
    pressBackdrop();
    expect(onClose).not.toHaveBeenCalled();
    fail(new Error("wallet said no"));
    await waitFor(() => expect(screen.getByText("wallet said no")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(zapButton().textContent).toContain("21 sats");
  });

  it("asks a read-only account to sign in, over the dialog", () => {
    state.canSign = false;
    open();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("login dialog")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Zap Alice" })).toBeTruthy();
  });
});
