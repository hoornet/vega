import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
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
vi.mock("../../stores/user", () => ({ useUserStore: () => store }));
vi.mock("../../stores/ui", () => ({ useUIStore: () => ({ openProfile: vi.fn() }) }));
vi.mock("../shared/LoginModal", () => ({ LoginModal: () => null }));

import { AccountSwitcher } from "./AccountSwitcher";

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

  it("removes only after the second, explicit click", () => {
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    fireEvent.click(screen.getByText("Remove account"));

    expect(store.removeAccount).toHaveBeenCalledTimes(1);
    expect(store.removeAccount).toHaveBeenCalledWith(ME);
  });

  it("offers the secret key first, and copies it from the keychain", async () => {
    vi.mocked(invoke).mockResolvedValue("nsec1thekey");
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    fireEvent.click(screen.getByText("Copy secret key first"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("nsec1thekey"));
    expect(invoke).toHaveBeenCalledWith("load_nsec", { pubkey: ME });
    expect(await screen.findByText(/Copied/)).toBeTruthy();
    expect(store.removeAccount).not.toHaveBeenCalled();
  });

  it("says so when the key cannot be read, instead of pretending it was copied", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    openMenu();
    fireEvent.click(screen.getByText("Remove from this computer…"));
    fireEvent.click(screen.getByText("Copy secret key first"));

    expect(await screen.findByText(/Couldn't read the key/)).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
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
