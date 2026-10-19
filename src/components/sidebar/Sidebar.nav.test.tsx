import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

// The sidebar after the October 2026 UI review: eight destinations in two
// groups, a Write button, a footer of tools, and the account.

const signer = vi.hoisted(() => ({ canSign: true }));
vi.mock("../../stores/user", () => ({
  useCanSign: () => signer.canSign,
  useUserStore: () => ({ accounts: [{ pubkey: "11".repeat(32), npub: "npub1harpo", name: "Harpo", loginType: "nsec" }], pubkey: "11".repeat(32), loggedIn: true, switchAccount: vi.fn(), removeAccount: vi.fn(), logout: vi.fn() }),
  readSecretKey: vi.fn(),
}));
vi.mock("../shared/LoginModal", () => ({ LoginModal: () => <div>login dialog</div> }));

import { Sidebar } from "./Sidebar";
import { useUIStore } from "../../stores/ui";
import { useDraftStore } from "../../stores/drafts";
import { useNotificationsStore } from "../../stores/notifications";

const nav = () => screen.getByRole("navigation", { name: "Main" });
const rows = () => within(nav()).getAllByRole("button").map((b) => b.textContent?.trim() || b.getAttribute("aria-label")).filter((t) => t !== "Write");
const tools = () => within(screen.getByRole("group", { name: "Tools" })).getAllByRole("button").map((b) => b.getAttribute("aria-label"));

beforeEach(() => {
  localStorage.clear();
  signer.canSign = true;
  useUIStore.setState({ currentView: "feed", sidebarCollapsed: false, showHelp: false, viewStack: [] });
  useDraftStore.setState({ drafts: [], activeDraftId: null });
  useNotificationsStore.setState({ unreadCount: 2, dmUnreadCount: 0, newFollowersCount: 3, newFollowerPubkeys: new Set(["a", "b", "c"]) });
});
afterEach(cleanup);

describe("Sidebar", () => {
  it("lists where you come back to, then where you explore, and nothing else", () => {
    render(<Sidebar />);
    // 2 unread mentions or zaps and 3 new followers: one badge.
    expect(rows()).toEqual(["Home", "Notifications5 unread", "Messages", "Bookmarks", "Search", "Articles", "Media", "Podcasts"]);
    for (const gone of ["People", "Zaps", "Value 4 Value", "Feed"]) {
      expect(within(nav()).queryByText(gone)).toBeNull();
    }
  });

  it("hides the account-bound rows for a read-only account, and Write with them", () => {
    signer.canSign = false;
    render(<Sidebar />);
    expect(rows()).toEqual(["Home", "Search", "Articles", "Media", "Podcasts"]);
    expect(screen.queryByRole("button", { name: /^Write/ })).toBeNull();
  });

  it("has Write as a button with the draft count, not as a row", () => {
    useDraftStore.setState({ drafts: [{ id: "a", title: "T", content: "c", summary: "", image: "", tags: "", createdAt: 1, updatedAt: 1 }], activeDraftId: null });
    render(<Sidebar />);
    const write = screen.getByRole("button", { name: /^Write/ });
    expect(write.textContent).toContain("1");
    expect(write.getAttribute("aria-pressed")).toBeNull();
    fireEvent.click(write);
    expect(useUIStore.getState().currentView).toBe("article-editor");
  });

  it("keeps the tools in a footer: Settings, Relays, Help, Support", () => {
    render(<Sidebar />);
    expect(tools()).toEqual(["Settings", "Relays", "Keyboard shortcuts", "Support"]);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(useUIStore.getState().showHelp).toBe(true);
    expect(screen.getByRole("button", { name: "Keyboard shortcuts" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Relays" }));
    expect(useUIStore.getState().currentView).toBe("relays");
    // A place, not a toggle: pressing Relays again does not switch it back.
    expect(screen.getByRole("button", { name: "Relays" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Relays" }).getAttribute("aria-pressed")).toBeNull();
  });

  it("marks the current view", () => {
    useUIStore.setState({ currentView: "dm" });
    render(<Sidebar />);
    expect(within(nav()).getByRole("button", { name: /Messages/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav()).getByRole("button", { name: /Home/ }).getAttribute("aria-current")).toBeNull();
  });

  it("keeps the account and the tools when collapsed; the avatar expands the sidebar to its menu", () => {
    useUIStore.setState({ sidebarCollapsed: true });
    render(<Sidebar />);
    const account = screen.getByRole("button", { name: /^Account/ });
    expect(tools()).toHaveLength(4);
    // Collapsed rows carry their counts in their names.
    expect(within(nav()).getByRole("button", { name: "Notifications, 5 unread" })).toBeTruthy();
    fireEvent.click(account);
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("counts new followers on the Notifications badge, where their tab is, and nowhere else", () => {
    render(<Sidebar />);
    expect(screen.getByRole("button", { name: "Switch account" })).toBeTruthy();
    expect(screen.queryByText(/new followers/)).toBeNull();
    useNotificationsStore.setState({ newFollowersCount: 0, newFollowerPubkeys: new Set() });
    cleanup();
    render(<Sidebar />);
    expect(rows()[1]).toBe("Notifications2 unread");
  });

  it("does not show the version string", () => {
    render(<Sidebar />);
    expect(screen.queryByText(/^v\d+\.\d+/)).toBeNull();
  });
});
