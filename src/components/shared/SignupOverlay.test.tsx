import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const user = vi.hoisted(() => ({ loginError: null as string | null, loggedIn: false, loginWithNsec: vi.fn(), loginWithPubkey: vi.fn(), loginWithRemoteSigner: vi.fn(), saveProfile: vi.fn() }));
vi.mock("../../stores/user", () => ({ useUserStore: Object.assign(() => user, { getState: () => user, setState: (next: Partial<typeof user>) => Object.assign(user, next) }) }));
vi.mock("../../lib/nostr", () => ({ ensureConnected: () => Promise.resolve(true) }));

import { SignupOverlay } from "./SignupOverlay";
import { Dialog } from "./Dialog";
import { useUIStore } from "../../stores/ui";
import { discardSignupDraft } from "../onboarding/OnboardingFlow";
import { MODAL_SELECTOR } from "../../lib/escapeKey";

beforeEach(() => { useUIStore.setState({ signup: null }); user.loginError = null; discardSignupDraft(); });
afterEach(() => { cleanup(); document.body.innerHTML = ""; });
const open = (step: "create" | "login") => { render(<SignupOverlay />); act(() => { useUIStore.setState({ signup: step }); }); };

// The sign-up flow over the running app is a modal in every way the rest of
// the app can tell. It used to be a plain div with a role: the shortcuts ran
// behind it, Tab walked into the sidebar, and focus fell to the page on close.
describe("SignupOverlay", () => {
  it("is nothing while no flow is open", () => {
    render(<SignupOverlay />);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("is a modal dialog at the body, named for what it is for", () => {
    open("create");
    const dialog = document.querySelector(MODAL_SELECTOR)!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-label")).toBe("Create account");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByRole("heading", { name: "What should people call you?" })).toBeTruthy();
  });

  it("puts the keyboard in the name field, not on what opened it", () => {
    const opener = document.createElement("button");
    opener.textContent = "Create account";
    document.body.appendChild(opener);
    opener.focus();
    open("create");
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
  });

  it("closes on Escape, and gives the keyboard back", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    open("login");
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(useUIStore.getState().signup).toBeNull();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes when the flow is left by its own Back", () => {
    open("login");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(useUIStore.getState().signup).toBeNull();
  });

  // The zap dialog's "Sign in", then "Create an account": the flow must be
  // above the dialog that asked for it, and Escape must reach the flow first.
  it("is above a dialog that was open when it was asked for", () => {
    render(<Dialog title="Send a zap" onClose={() => {}}><button>Sign in</button></Dialog>);
    open("create");
    const dialogs = [...document.querySelectorAll("[role=dialog]")];
    expect(dialogs.map((d) => d.getAttribute("aria-label") ?? d.querySelector("h2")?.textContent)).toEqual(["Send a zap", "Create account"]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(useUIStore.getState().signup).toBeNull();
    expect(screen.getByRole("dialog", { name: "Send a zap" })).toBeTruthy();
  });

  it("keeps Tab inside", () => {
    open("create");
    const inside = document.querySelector(MODAL_SELECTOR)!;
    const last = [...inside.querySelectorAll<HTMLElement>("button, input")].pop()!;
    last.focus();
    const press = fireEvent.keyDown(last, { key: "Tab" });
    expect(inside.contains(document.activeElement)).toBe(true);
    expect(press).toBe(false);
  });
});
