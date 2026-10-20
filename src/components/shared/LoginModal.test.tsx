import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const store = {
  loginError: null as string | null,
  loginWithNsec: vi.fn(),
  loginWithPubkey: vi.fn(),
  loginWithRemoteSigner: vi.fn(),
};
vi.mock("../../stores/user", () => ({ useUserStore: Object.assign(() => store, { getState: () => store }) }));
beforeEach(() => { useUIStore.setState({ signup: null }); });

import { LoginModal } from "./LoginModal";
import { HelpModal } from "./HelpModal";
import { useUIStore } from "../../stores/ui";

const onClose = vi.fn();
beforeEach(() => { vi.clearAllMocks(); store.loginError = null; store.loginWithNsec.mockResolvedValue(undefined); store.loginWithPubkey.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

describe("LoginModal", () => {
  it("is a dialog at the body, with the key field ready to type in", () => {
    const { container } = render(<div><LoginModal onClose={onClose} /></div>);
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Sign in" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText("nsec1…"));
  });

  it("logs in on Enter, then closes", async () => {
    render(<LoginModal onClose={onClose} />);
    const field = screen.getByPlaceholderText("nsec1…");
    fireEvent.change(field, { target: { value: "nsec1abc" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(store.loginWithNsec).toHaveBeenCalledWith("nsec1abc");
  });

  it("stays open and says why when the login fails", async () => {
    store.loginWithNsec.mockImplementation(async () => { store.loginError = "That is not a valid key."; });
    render(<LoginModal onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText("nsec1…"), { target: { value: "nonsense" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(store.loginWithNsec).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses the method of the tab it is on", async () => {
    render(<LoginModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("tab", { name: "Read-only" }));
    fireEvent.change(screen.getByPlaceholderText("npub1…"), { target: { value: "npub1abc" } });
    fireEvent.click(screen.getByRole("button", { name: "View as read-only" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(store.loginWithPubkey).toHaveBeenCalledWith("npub1abc");
    expect(store.loginWithNsec).not.toHaveBeenCalled();
  });

  // Escape used to work only while focus was inside the dialog's own subtree.
  it("closes on Escape with focus anywhere", () => {
    render(<LoginModal onClose={onClose} />);
    screen.getByRole("button", { name: "Close" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Opened from "Add account", a menu item that is gone when it closes.
  it("returns focus where it was told to", () => {
    const arrow = createRef<HTMLButtonElement>();
    const { rerender } = render(<><button ref={arrow}>Switch account</button><LoginModal onClose={onClose} returnFocus={arrow} /></>);
    rerender(<><button ref={arrow}>Switch account</button></>);
    expect(document.activeElement).toBe(arrow.current);
  });
});

// Making an account is the sign-up flow's job, not a fourth tab here.
describe("LoginModal: a new account", () => {
  it("offers the sign-up flow, and closes to make way for it", () => {
    render(<LoginModal onClose={onClose} />);
    expect(screen.queryByRole("tab", { name: /new account/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().signup).toBe("create");
  });
});

describe("HelpModal", () => {
  it("is a dialog that lists the shortcuts and can be closed", () => {
    render(<HelpModal onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog.textContent).toContain("Search");
    expect(dialog.querySelectorAll("kbd").length).toBeGreaterThan(4);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape without the press reaching the app", () => {
    const app = vi.fn();
    window.addEventListener("keydown", app);
    render(<HelpModal onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", app);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(app).not.toHaveBeenCalled();
  });
});
