import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const ME = "11".repeat(32);
const OTHER = "22".repeat(32);

const user = vi.hoisted(() => ({ pubkey: null as string | null, npub: null as string | null, loggedIn: false }));
const readSecretKey = vi.hoisted(() => vi.fn());
vi.mock("../../stores/user", () => ({ useUserStore: () => user, readSecretKey }));

import { IdentitySection } from "./SettingsView";
import { useToastStore } from "../../stores/toast";
import { useBackupStore } from "../../stores/backup";

const writeText = vi.fn();
const keyRow = () => screen.queryByText("reveal") ?? screen.queryByText("hide");
const NOT_STORED = /not saved in this computer's keychain/;

beforeEach(() => {
  vi.clearAllMocks();
  user.pubkey = ME;
  user.npub = "npub1harpo";
  user.loggedIn = true;
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  useToastStore.setState({ toasts: [] });
});
afterEach(cleanup);

describe("Settings: the secret key", () => {
  it("shows the key row for a key in the keychain, hidden until revealed, with no warning", async () => {
    readSecretKey.mockResolvedValue({ nsec: "nsec1thekey", stored: true });
    render(<IdentitySection />);
    expect(await screen.findByText("reveal")).toBeTruthy();
    expect(readSecretKey).toHaveBeenCalledWith(ME);
    expect(screen.queryByText("nsec1thekey")).toBeNull();
    expect(screen.queryByText(NOT_STORED)).toBeNull();
    fireEvent.click(screen.getByText("reveal"));
    expect(screen.getByText("nsec1thekey")).toBeTruthy();
  });

  // The keychain did not take the key (on Linux, no secret service is an
  // ordinary setup). Settings read only the keychain, so there was no row at
  // all: the one screen that could have saved the account showed nothing.
  it("shows a key that is only in this session, and says it is gone when Vega closes", async () => {
    readSecretKey.mockResolvedValue({ nsec: "nsec1onlyhere", stored: false });
    render(<IdentitySection />);
    expect(await screen.findByText("reveal")).toBeTruthy();
    const warning = screen.getByRole("alert");
    expect(warning.textContent).toMatch(NOT_STORED);
    expect(warning.textContent).toContain("Copy it now");
    fireEvent.click(screen.getByText("reveal"));
    fireEvent.click(screen.getByText("copy"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("nsec1onlyhere"));
  });

  // Copied from here counts as backed up: the reminder that asks for it ends.
  it("ends the backup reminder once the key has been copied", async () => {
    readSecretKey.mockResolvedValue({ nsec: "nsec1stored", stored: true });
    useBackupStore.setState({ pending: [user.pubkey!] });
    render(<IdentitySection />);
    expect(await screen.findByText("reveal")).toBeTruthy();
    fireEvent.click(screen.getByText("reveal"));
    fireEvent.click(screen.getByText("copy"));
    await vi.waitFor(() => expect(useBackupStore.getState().pending).toEqual([]));
  });

  it("does not end it on a copy the clipboard refused", async () => {
    readSecretKey.mockResolvedValue({ nsec: "nsec1stored", stored: true });
    useBackupStore.setState({ pending: [user.pubkey!] });
    writeText.mockRejectedValueOnce(new Error("no clipboard"));
    render(<IdentitySection />);
    expect(await screen.findByText("reveal")).toBeTruthy();
    fireEvent.click(screen.getByText("reveal"));
    fireEvent.click(screen.getByText("copy"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    await act(async () => {});
    expect(useBackupStore.getState().pending).toEqual([user.pubkey!]);
  });

  // A locked keychain may well hold the key. Saying "not saved" would be a guess.
  it("says it cannot tell when the keychain could not be read", async () => {
    readSecretKey.mockResolvedValue({ nsec: "nsec1maybe", stored: null });
    render(<IdentitySection />);
    expect(await screen.findByText("reveal")).toBeTruthy();
    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain("could not read this computer's keychain");
    expect(warning.textContent).toContain("cannot tell whether this key is saved there");
    expect(warning.textContent).not.toMatch(NOT_STORED);
    expect(warning.textContent).toContain("Copy it now");
  });

  it("has no key row for an account that holds no key here", async () => {
    readSecretKey.mockResolvedValue(null);
    render(<IdentitySection />);
    await act(async () => {});
    expect(keyRow()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("npub1harpo")).toBeTruthy();
  });

  // The row is for whoever is signed in. After a switch it showed the
  // previous account's key, revealed, until the new read came back.
  it("does not go on showing the previous account's key after a switch", async () => {
    let answer: (key: { nsec: string; stored: boolean } | null) => void = () => {};
    readSecretKey.mockResolvedValueOnce({ nsec: "nsec1harpo", stored: true });
    const view = render(<IdentitySection />);
    fireEvent.click(await screen.findByText("reveal"));
    expect(screen.getByText("nsec1harpo")).toBeTruthy();

    readSecretKey.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    user.pubkey = OTHER;
    user.npub = "npub1zeppo";
    view.rerender(<IdentitySection />);
    expect(screen.queryByText("nsec1harpo")).toBeNull();
    expect(keyRow()).toBeNull();

    await act(async () => { answer({ nsec: "nsec1zeppo", stored: true }); });
    expect(screen.getByText("reveal")).toBeTruthy(); // hidden again: it was the other key that was revealed
    expect(screen.queryByText("nsec1zeppo")).toBeNull();
  });

  // A slow read for the account before must not land in the row of the one after.
  it("ignores a key that comes back for the account that was signed in before", async () => {
    let late: (key: { nsec: string; stored: boolean } | null) => void = () => {};
    readSecretKey.mockReturnValueOnce(new Promise((resolve) => { late = resolve; }));
    const view = render(<IdentitySection />);
    readSecretKey.mockResolvedValueOnce(null);
    user.pubkey = OTHER;
    user.npub = "npub1zeppo";
    view.rerender(<IdentitySection />);
    await act(async () => { late({ nsec: "nsec1harpo", stored: true }); });
    expect(keyRow()).toBeNull();
  });

  it("says nobody is signed in, and reads no key", () => {
    user.pubkey = null;
    user.npub = null;
    user.loggedIn = false;
    render(<IdentitySection />);
    expect(screen.getByText("Not logged in.")).toBeTruthy();
    expect(readSecretKey).not.toHaveBeenCalled();
  });
});
