import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

// Settings after the October 2026 UI review: six groups in a fixed order,
// Advanced closed until asked, the relay privacy switches gone to Relays, and
// nothing hidden when empty.

const user = vi.hoisted(() => ({ pubkey: "11".repeat(32) as string | null, npub: "npub1harpo" as string | null, loggedIn: true, follows: [] as string[], followsStatus: "loaded", accounts: [{ pubkey: "11".repeat(32), npub: "npub1harpo", name: "Harpo", loginType: "nsec" }], removeAccount: vi.fn() }));
vi.mock("../../stores/user", () => ({ useUserStore: () => user, useCanSign: () => true, readSecretKey: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({ enabled: false, url: "" })) }));
vi.mock("../../lib/nostr", () => ({ getStoredRelayUrls: () => ["wss://a"] }));
vi.mock("../../lib/localRelay", () => ({ isLocalRelayEnabled: () => false, setLocalRelayEnabled: vi.fn(), connectLocalRelay: vi.fn(), disconnectLocalRelay: vi.fn(), getRelayPort: vi.fn(), getRelayStats: vi.fn() }));
vi.mock("../../lib/feedDiagnostics", () => ({ isDiagLogEnabled: () => false, setDiagLogEnabled: vi.fn(), getDiagLogPath: vi.fn() }));
vi.mock("../../lib/notifications", () => ({ getNotificationSettings: () => ({ mentions: true, dms: true, zaps: true, followers: true }), saveNotificationSettings: vi.fn(), ensurePermission: vi.fn() }));
vi.mock("../../lib/proxy", () => ({ refreshProxySettingsCache: vi.fn() }));
vi.mock("../../hooks/useProfile", () => ({ useProfile: () => null }));
vi.mock("./NWCWizard", () => ({ NWCWizard: () => <div>wallet wizard</div> }));
vi.mock("../sidebar/AccountSwitcher", () => ({ RemoveAccountConfirm: ({ name }: { name: string }) => <div role="alertdialog">Remove {name}?</div> }));

import { SettingsView } from "./SettingsView";
import { useUIStore } from "../../stores/ui";
import { useLightningStore } from "../../stores/lightning";
import { useMuteStore } from "../../stores/mute";

const groupTitles = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

beforeEach(() => {
  localStorage.clear();
  useLightningStore.setState({ nwcUri: null });
  useMuteStore.setState({ mutedPubkeys: [] });
  useUIStore.setState({ currentView: "settings", viewStack: [] });
});
afterEach(cleanup);

describe("Settings", () => {
  it("is six groups, daily things first, with a row of jumps", () => {
    render(<SettingsView />);
    expect(groupTitles()).toEqual(["Appearance", "Account", "Wallet for zaps", "Notifications", "What you see", "Advanced"]);
    const jumps = within(screen.getByRole("navigation", { name: "Settings sections" })).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(jumps).toEqual(["Go to Appearance", "Go to Account", "Go to Wallet for zaps", "Go to Notifications", "Go to What you see", "Go to Advanced"]);
  });

  it("keeps Advanced closed, with one line saying what is in it, until asked", () => {
    render(<SettingsView />);
    expect(screen.getByText("Proxy, local relay, diagnostics. Most people never need these.")).toBeTruthy();
    expect(screen.queryByText("Network proxy")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Advanced" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Network proxy")).toBeTruthy();
    expect(screen.getByText("Personal relay")).toBeTruthy();
    expect(screen.getByText("Diagnostics")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Relays" })).toBeTruthy();
  });

  it("opens Advanced when its jump is used", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Go to Advanced" }));
    expect(screen.getByText("Network proxy")).toBeTruthy();
  });

  it("no longer carries the relay privacy switches, which live in Relays", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.queryByText(/Relay reach/)).toBeNull();
    expect(screen.queryByText(/Relay authentication/)).toBeNull();
    expect(screen.queryByText(/NIP-65/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Relays" }));
    expect(useUIStore.getState().currentView).toBe("relays");
  });

  it("shows the wallet as one row until asked, then the wizard", () => {
    render(<SettingsView />);
    expect(screen.getByText("No wallet connected")).toBeTruthy();
    expect(screen.queryByText("wallet wizard")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect a wallet" }));
    expect(screen.getByText("wallet wizard")).toBeTruthy();
  });

  it("comes back to one row when the wizard is put away, or when a wallet connects", () => {
    const { rerender } = render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Connect a wallet" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByText("No wallet connected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect a wallet" }));
    useLightningStore.setState({ nwcUri: "nostr+walletconnect://abc?relay=wss%3A%2F%2Fr&secret=s" });
    rerender(<SettingsView />);
    expect(screen.queryByText(/Zaps are small Bitcoin tips/)).toBeNull();
    useLightningStore.setState({ nwcUri: null });
    rerender(<SettingsView />);
    expect(screen.getByText("No wallet connected")).toBeTruthy();
  });

  it("opens Advanced and moves focus to the group a jump leads to", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Go to Account" }));
    expect(document.activeElement?.id).toBe("settings-account-title");
    fireEvent.click(screen.getByRole("button", { name: "Go to Advanced" }));
    expect(screen.getByText("Network proxy")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Advanced" })).toBeTruthy();
  });

  it("lands on the group it was opened for, with the wizard already open, and forgets the request", () => {
    useUIStore.setState({ pendingSettingsGroup: "wallet" });
    render(<SettingsView />);
    expect(document.activeElement?.id).toBe("settings-wallet-title");
    expect(useUIStore.getState().pendingSettingsGroup).toBeNull();
    // Not a second "Connect a wallet": the steps were promised.
    expect(screen.getByText("wallet wizard")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect a wallet" })).toBeNull();
  });

  it("shows the wizard's connected state when a wallet is connected", () => {
    useLightningStore.setState({ nwcUri: "nostr+walletconnect://abc?relay=wss%3A%2F%2Fr&secret=s" });
    render(<SettingsView />);
    expect(screen.queryByText("No wallet connected")).toBeNull();
    expect(screen.getByText("wallet wizard")).toBeTruthy();
  });

  it("always shows the muted accounts, with their count", () => {
    render(<SettingsView />);
    expect(screen.getByText("Muted accounts (0)")).toBeTruthy();
    expect(screen.getByText(/People you mute appear here/)).toBeTruthy();
  });

  it("says the text size changes the whole window", () => {
    render(<SettingsView />);
    expect(screen.getByText(/Changes the size of everything in the window/)).toBeTruthy();
  });

  it("names things in plain words", () => {
    render(<SettingsView />);
    expect(screen.getByText("Text size")).toBeTruthy();
    expect(screen.getByText("Hide strangers")).toBeTruthy();
    expect(screen.getByText("Back up follows and bookmarks")).toBeTruthy();
    expect(screen.getByText(/does not include your secret key/)).toBeTruthy();
    expect(screen.queryByText(/Your keys, your data/)).toBeNull();
    expect(screen.getByRole("switch", { name: "Hide automatic news reposts" })).toBeTruthy();
  });

  it("offers to remove this account from this computer, through the same confirmation as the menu", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Remove this account from this computer…" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("Remove Harpo?");
    expect(user.removeAccount).not.toHaveBeenCalled();
  });

  it("ends with the version", () => {
    render(<SettingsView />);
    expect(screen.getByText(/^Vega v\d+\.\d+\.\d+$/)).toBeTruthy();
  });
});
