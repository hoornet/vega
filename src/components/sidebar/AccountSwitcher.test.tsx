import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SavedAccount } from "../../stores/user";

const ME = "11".repeat(32);
const OTHER = "22".repeat(32);

const store = {
  accounts: [] as SavedAccount[],
  pubkey: ME as string | null,
  loggedIn: true,
  switchAccount: vi.fn(),
  removeAccount: vi.fn(),
  logout: vi.fn(),
};
const readSecretKey = vi.hoisted(() => vi.fn());
vi.mock("../../stores/user", () => ({ useUserStore: () => store, readSecretKey }));
const openProfile = vi.hoisted(() => vi.fn());
const openView = vi.hoisted(() => vi.fn());
const openSignup = vi.hoisted(() => vi.fn());
vi.mock("../../stores/ui", () => ({ useUIStore: Object.assign(() => ({ openProfile, openView }), { getState: () => ({ openProfile, openView, openSignup }) }) }));
const loginProps = vi.hoisted(() => ({ last: null as null | { returnFocus?: { current: HTMLElement | null } } }));
vi.mock("../shared/LoginModal", () => ({ LoginModal: (props: { returnFocus?: { current: HTMLElement | null } }) => { loginProps.last = props; return <div>login dialog</div>; } }));

import { AccountSwitcher } from "./AccountSwitcher";
import { useToastStore } from "../../stores/toast";
import { useBackupStore } from "../../stores/backup";

const writeText = vi.fn();

function account(pubkey: string, name: string, loginType: SavedAccount["loginType"] = "nsec"): SavedAccount {
  return { pubkey, npub: `npub1${name.toLowerCase()}`, name, loginType };
}

function openMenu() {
  render(<AccountSwitcher />);
  fireEvent.click(screen.getByTitle("Switch account"));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.accounts = [account(ME, "Harpo"), account(OTHER, "Zeppo")];
  store.pubkey = ME;
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

// Removing an account deletes its secret key from the OS keychain. Until
// v0.15.9 one click on a 10px "Remove" link beside "Sign out" did that, with
// no confirmation, to what may be the only copy of the key.
describe("removing an account", () => {
  it("asks first: clicking the menu entry removes nothing", () => {
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));

    expect(store.removeAccount).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("Remove Harpo from this computer?");
    expect(screen.getByRole("alertdialog").textContent).toMatch(/you can never sign in to this account again/i);
  });

  it("keeps the account when cancelled, and returns to the menu", () => {
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(store.removeAccount).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText("Sign out")).toBeTruthy();
  });

  it("cancels on Escape, without the key press reaching the app-wide handler", () => {
    const appHandler = vi.fn();
    window.addEventListener("keydown", appHandler);
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));

    fireEvent.keyDown(document, { key: "Escape" });
    window.removeEventListener("keydown", appHandler);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(store.removeAccount).not.toHaveBeenCalled();
    expect(appHandler).not.toHaveBeenCalled();
  });

  it("removes only after the second, explicit click", () => {
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    fireEvent.click(screen.getByText("Remove account"));

    expect(store.removeAccount).toHaveBeenCalledTimes(1);
    expect(store.removeAccount).toHaveBeenCalledWith(ME);
  });

  it("offers the secret key first, and copies it", async () => {
    readSecretKey.mockResolvedValue({ nsec: "nsec1thekey", stored: true });
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    fireEvent.click(screen.getByText("Copy secret key first"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("nsec1thekey"));
    expect(readSecretKey).toHaveBeenCalledWith(ME);
    expect(await screen.findByText(/Copied/)).toBeTruthy();
    expect(store.removeAccount).not.toHaveBeenCalled();
  });

  // Copied here, then the removal cancelled: the key is out, so the reminder
  // to back it up has done its work.
  it("ends the backup reminder once the key is copied, even if the removal is then cancelled", async () => {
    readSecretKey.mockResolvedValue({ nsec: "nsec1thekey", stored: true });
    useBackupStore.setState({ pending: [ME] });
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    fireEvent.click(screen.getByText("Copy secret key first"));
    await waitFor(() => expect(useBackupStore.getState().pending).toEqual([]));
    fireEvent.click(screen.getByText("Cancel"));
    expect(store.removeAccount).not.toHaveBeenCalled();
  });

  // The keychain never took it (no secret service): this session's copy is
  // the only one there is, and removing the account is what destroys it.
  it("copies a key that is only in this session", async () => {
    readSecretKey.mockResolvedValue({ nsec: "nsec1onlyhere", stored: false });
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    fireEvent.click(screen.getByText("Copy secret key first"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("nsec1onlyhere"));
    expect(await screen.findByText(/Copied/)).toBeTruthy();
  });

  it("copies the key of the account being removed, not of the one signed in", async () => {
    readSecretKey.mockResolvedValue({ nsec: "nsec1zeppo", stored: true });
    openMenu();
    fireEvent.click(screen.getByLabelText("Remove Zeppo from this computer"));
    fireEvent.click(screen.getByText("Copy secret key first"));
    await waitFor(() => expect(readSecretKey).toHaveBeenCalledWith(OTHER));
  });

  it("says so when there is no key to copy, instead of pretending it was copied", async () => {
    readSecretKey.mockResolvedValue(null);
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    fireEvent.click(screen.getByText("Copy secret key first"));

    const said = await screen.findByText("No key for this account is on this computer.");
    expect(said.textContent).not.toContain("Settings");
    expect(writeText).not.toHaveBeenCalled();
  });

  // A clipboard that refuses is not a key that cannot be read. It used to be
  // reported as one, and sent the user to Settings, where the same clipboard would refuse.
  it("says the copy failed, and lets it be tried again, when the clipboard refuses", async () => {
    readSecretKey.mockResolvedValue({ nsec: "nsec1thekey", stored: true });
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    useToastStore.setState({ toasts: [] });
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    fireEvent.click(screen.getByText("Copy secret key first"));
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => [t.type, t.message])).toEqual([["error", "Couldn't copy to the clipboard."]]));
    expect(screen.queryByText(/No key for this account/)).toBeNull();
    expect(screen.queryByText(/Copied\./)).toBeNull();
    expect(screen.getByText("Copy secret key first")).toBeTruthy();
    expect(JSON.stringify(useToastStore.getState().toasts)).not.toContain("nsec1thekey");
  });

  it("does not talk about a secret key for an account that has none here", () => {
    store.accounts = [account(ME, "Harpo", "pubkey")];
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));

    expect(screen.queryByText("Copy secret key first")).toBeNull();
    expect(screen.getByRole("alertdialog").textContent).toMatch(/read-only here/i);
  });

  it("asks first for the other accounts in the list too", () => {
    openMenu();
    fireEvent.click(screen.getByLabelText("Remove Zeppo from this computer"));

    expect(store.removeAccount).not.toHaveBeenCalled();
    expect(store.switchAccount).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("Remove Zeppo from this computer?");

    fireEvent.click(screen.getByText("Remove account"));
    expect(store.removeAccount).toHaveBeenCalledWith(OTHER);
  });
});

describe("signing out", () => {
  it("signs out at once, removes nothing, and says the account stays", () => {
    openMenu();
    expect(screen.getByText("keeps this account here")).toBeTruthy();
    fireEvent.click(screen.getByText("Sign out"));

    expect(store.logout).toHaveBeenCalledTimes(1);
    expect(store.removeAccount).not.toHaveBeenCalled();
  });
});

// The menu stayed open until its own arrow was pressed again, across navigation.
describe("closing the menu", () => {
  const menuOpen = () => screen.queryByText("Sign out") !== null;

  it("closes on Escape", () => {
    openMenu();
    expect(menuOpen()).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(menuOpen()).toBe(false);
  });

  it("closes on a click outside it, and that click does nothing else", () => {
    const outside = vi.fn();
    render(<button onClick={outside}>Feed</button>);
    openMenu();
    fireEvent.click(screen.getByText("Feed"));
    expect(menuOpen()).toBe(false);
    expect(outside).not.toHaveBeenCalled();
    // the next click is an ordinary one
    fireEvent.click(screen.getByText("Feed"));
    expect(outside).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a click on one of its own items", () => {
    openMenu();
    fireEvent.click(screen.getByText("keeps this account here"));
    expect(store.logout).toHaveBeenCalledTimes(1);
  });

  // Closed from the keyboard, the focused item is gone: focus must not fall to the page.
  it("puts focus back on its arrow when Escape closes it", () => {
    openMenu();
    screen.getByText("Add account").closest("button")!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(menuOpen()).toBe(false);
    expect(document.activeElement).toBe(screen.getByTitle("Switch account"));
  });

  it("leaves focus where the pointer put it when a click closes it", () => {
    render(<button>Feed</button>);
    openMenu();
    const arrow = screen.getByTitle("Switch account");
    fireEvent.click(screen.getByText("Feed"));
    expect(menuOpen()).toBe(false);
    expect(document.activeElement).not.toBe(arrow);
  });

  // It stayed open over the profile it had just opened.
  it("closes when your own name is clicked, and opens your profile", () => {
    openMenu();
    fireEvent.click(screen.getByText("Harpo"));
    expect(openProfile).toHaveBeenCalledWith(ME);
    expect(menuOpen()).toBe(false);
  });

  // "Add account" is a menu item: gone by the time the login dialog closes.
  it("closes for Add account, and tells the login dialog to return focus to the arrow", () => {
    openMenu();
    fireEvent.click(screen.getByText("Add account"));
    expect(menuOpen()).toBe(false);
    expect(screen.getByText("login dialog")).toBeTruthy();
    expect(loginProps.last?.returnFocus?.current).toBe(screen.getByTitle("Switch account"));
  });

  it("says whether it is open", () => {
    render(<AccountSwitcher />);
    const arrow = screen.getByTitle("Switch account");
    expect(arrow.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(arrow);
    expect(arrow.getAttribute("aria-expanded")).toBe("true");
  });

  // Escape backs out of the dangerous question and does only that. A stray
  // click must not dismiss a question about deleting a key either.
  it("leaves the removal confirmation alone", () => {
    const outside = vi.fn();
    render(<button onClick={outside}>Feed</button>);
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    fireEvent.click(screen.getByText("Feed"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // back in the menu, not out of it
    expect(menuOpen()).toBe(true);
    expect(store.removeAccount).not.toHaveBeenCalled();
  });
});

// People and Zap history left the sidebar's list for the account menu.
describe("your places in the menu", () => {
  it("opens the profile, People and Zap history, through the view stack so Back returns", () => {
    openMenu();
    const reopen = () => fireEvent.click(screen.getByTitle("Switch account"));
    fireEvent.click(screen.getByText("Profile"));
    expect(openProfile).toHaveBeenCalledWith(ME);
    reopen();
    fireEvent.click(screen.getByText("People"));
    expect(openView).toHaveBeenCalledWith("follows");
    reopen();
    fireEvent.click(screen.getByText("Zap history"));
    expect(openView).toHaveBeenCalledWith("zaps");
  });
});

// Signed out, with or without accounts saved here.
describe("signed out", () => {
  it("offers to create an account, through the sign-up flow, and to sign in", () => {
    store.pubkey = null;
    render(<AccountSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(openSignup).toHaveBeenCalledWith("create");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("login dialog")).toBeTruthy();
  });
});
