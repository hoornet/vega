import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const user = vi.hoisted(() => ({
  pubkey: null as string | null,
  loggedIn: false,
  restoring: false,
  accounts: [] as { pubkey: string; npub: string; name?: string; loginType?: string }[],
  canSign: false,
  readSecretKey: vi.fn(),
  copySecretKey: vi.fn(),
}));
vi.mock("../../stores/user", () => ({
  useUserStore: (select: (s: typeof user) => unknown) => select(user),
  useCanSign: () => user.canSign,
  readSecretKey: (pubkey: string) => user.readSecretKey(pubkey),
  copySecretKey: (...args: unknown[]) => user.copySecretKey(...args),
}));
vi.mock("./LoginModal", () => ({ LoginModal: () => <div role="dialog" aria-label="Sign in" /> }));

import { IdentityBanner, BackupBanner } from "./Banners";
import { BackupDialog } from "./BackupDialog";
import { useUIStore } from "../../stores/ui";
import { useBackupStore } from "../../stores/backup";

const ANA = "aa".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(user, { pubkey: null, loggedIn: false, restoring: false, accounts: [], canSign: false });
  useUIStore.setState({ signup: null });
  useBackupStore.setState({ pending: [] });
});
afterEach(cleanup);

// Who is looking, and the way to an account.
describe("IdentityBanner", () => {
  it("offers an account to someone looking around, in two ways", () => {
    render(<IdentityBanner />);
    expect(screen.getByText("You're looking around. Create an account to post, follow and reply.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(useUIStore.getState().signup).toBe("create");
    fireEvent.click(screen.getByRole("button", { name: "I have a key" }));
    expect(useUIStore.getState().signup).toBe("login");
  });

  it("does not call it a mode, or a warning", () => {
    const { container } = render(<IdentityBanner />);
    expect(container.textContent).not.toMatch(/read-only mode/i);
    expect(container.firstElementChild!.className).toContain("bg-accent/10");
  });

  it("says whose view it is for an account signed in with a public key, and offers the key", () => {
    Object.assign(user, { pubkey: ANA, loggedIn: true, accounts: [{ pubkey: ANA, npub: "npub1", name: "Ana", loginType: "pubkey" }] });
    render(<IdentityBanner />);
    expect(screen.getByText("Viewing as Ana, read-only. Sign in with your key to post, reply and zap.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("dialog", { name: "Sign in" })).toBeTruthy();
  });

  it("calls an unnamed account by its address", () => {
    Object.assign(user, { pubkey: ANA, loggedIn: true, accounts: [{ pubkey: ANA, npub: "npub1", loginType: "pubkey" }] });
    render(<IdentityBanner />);
    expect(screen.getByText(/^Viewing as npub1.{3}….{4}, read-only/)).toBeTruthy();
  });

  // Who is signed in is not known until the saved session is restored.
  it("says nothing while the saved session is being restored", () => {
    Object.assign(user, { restoring: true, accounts: [{ pubkey: ANA, npub: "npub1", name: "Ana", loginType: "nsec" }] });
    expect(render(<IdentityBanner />).container.textContent).toBe("");
  });

  // Signed out with accounts saved: not "looking around", and not an offer to make a second account.
  it("offers sign-in, not a new account, to someone signed out", () => {
    Object.assign(user, { accounts: [{ pubkey: ANA, npub: "npub1", name: "Ana", loginType: "nsec" }] });
    render(<IdentityBanner />);
    expect(screen.getByText("You're signed out. Sign in to post, follow and reply.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("dialog", { name: "Sign in" })).toBeTruthy();
  });

  // An account made here whose key is not on this computer. The old banner
  // showed for it; the first version of this one said nothing at all.
  it("says the key is not on this computer for an account that cannot be signed in", () => {
    Object.assign(user, { pubkey: ANA, loggedIn: false, accounts: [{ pubkey: ANA, npub: "npub1", name: "Ana", loginType: "nsec" }] });
    render(<IdentityBanner />);
    expect(screen.getByText("Viewing as Ana, read-only: the key for this account is not on this computer. Sign in with your key to post, reply and zap.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("is not shown to an account that can sign", () => {
    Object.assign(user, { pubkey: ANA, loggedIn: true, canSign: true });
    expect(render(<IdentityBanner />).container.textContent).toBe("");
  });

  // A bunker that did not answer is said elsewhere, with its reason.
  it("is not shown for an account whose key could not be restored", () => {
    Object.assign(user, { pubkey: ANA, loggedIn: false, accounts: [{ pubkey: ANA, npub: "npub1", loginType: "remote-signer" }] });
    expect(render(<IdentityBanner />).container.textContent).toBe("");
  });
});

// The reminder for an account that chose "later" at the backup step.
describe("BackupBanner", () => {
  beforeEach(() => {
    Object.assign(user, { pubkey: ANA, loggedIn: true, canSign: true });
    user.readSecretKey.mockResolvedValue({ nsec: "nsec1secret", stored: true });
  });

  it("is shown while the account's key is not backed up", () => {
    useBackupStore.getState().markPending(ANA);
    render(<BackupBanner />);
    expect(screen.getByText("Your secret key is not backed up. If this computer is lost, so is your account.")).toBeTruthy();
  });

  // Nothing here to back up: the identity banner says the key is not on this computer.
  it("is not shown for an account that cannot sign", () => {
    useBackupStore.getState().markPending(ANA);
    Object.assign(user, { canSign: false, loggedIn: false });
    expect(render(<BackupBanner />).container.textContent).toBe("");
  });

  it("is not shown otherwise, nor for another account's reminder", () => {
    expect(render(<BackupBanner />).container.textContent).toBe("");
    cleanup();
    useBackupStore.getState().markPending("bb".repeat(32));
    expect(render(<BackupBanner />).container.textContent).toBe("");
  });

  it("opens the backup dialog, which copies the key and ends the reminder", async () => {
    useBackupStore.getState().markPending(ANA);
    user.copySecretKey.mockImplementation(async (pubkey: string) => { useBackupStore.getState().clearPending(pubkey); return true; });
    render(<BackupBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    const dialog = await screen.findByRole("dialog", { name: "Back up your secret key" });
    expect(dialog).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Copy secret key" })).toBeTruthy();
    expect(screen.queryByText("nsec1secret")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy secret key" }));
    expect(await screen.findByText("Done")).toBeTruthy();
    // Quiet: the button says it was copied; a toast as well would say it twice.
    expect(user.copySecretKey).toHaveBeenCalledWith(ANA, { quiet: true });
    // The reminder is gone; the dialog stays until closed, so the copy can be pasted first.
    expect(screen.queryByText(/Your secret key is not backed up/)).toBeNull();
    expect(screen.getByRole("dialog", { name: "Back up your secret key" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the reminder when the copy did not happen", async () => {
    useBackupStore.getState().markPending(ANA);
    user.copySecretKey.mockResolvedValue(false);
    render(<BackupBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy secret key" }));
    await vi.waitFor(() => expect(user.copySecretKey).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Done")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy secret key" }).textContent).not.toContain("Copied");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByText(/Your secret key is not backed up/)).toBeTruthy();
  });

  // Not reachable from the app today (the dialog covers the sidebar), but
  // the dialog must not show one account's key under another's name.
  it("starts again for another account, with nothing of the first on screen", async () => {
    const BO = "bb".repeat(32);
    user.readSecretKey.mockImplementation(async (pubkey: string) => ({ nsec: pubkey === ANA ? "nsec1ana" : "nsec1bo", stored: true }));
    const { rerender } = render(<BackupDialog pubkey={ANA} onClose={() => {}} />);
    fireEvent.click(await screen.findByText("reveal"));
    expect(screen.getByText("nsec1ana")).toBeTruthy();
    rerender(<BackupDialog pubkey={BO} onClose={() => {}} />);
    expect(screen.queryByText("nsec1ana")).toBeNull();
    expect(await screen.findByText("reveal")).toBeTruthy();
    expect(screen.queryByText("nsec1bo")).toBeNull();
    expect(user.readSecretKey).toHaveBeenLastCalledWith(BO);
  });

  it("says when there is no key on this computer to back up", async () => {
    useBackupStore.getState().markPending(ANA);
    user.readSecretKey.mockResolvedValue(null);
    render(<BackupBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy secret key" })).toBeNull();
  });
});
