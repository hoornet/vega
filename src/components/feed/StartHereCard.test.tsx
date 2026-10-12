import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const user = vi.hoisted(() => ({ pubkey: "me" as string | null, loggedIn: true, profile: null as Record<string, unknown> | null, follows: [] as string[], canSign: true, ownProfileRead: "none" as "pending" | "found" | "none" | "unknown" }));
vi.mock("../../stores/user", () => ({ useUserStore: <T,>(pick: (s: typeof user) => T) => pick(user), useCanSign: () => user.canSign }));
vi.mock("../shared/BackupDialog", () => ({ BackupDialog: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="Back up"><button onClick={() => useBackupStore.getState().clearPending("me")}>Copy</button><button onClick={onClose}>Done</button></div> }));

import { StartHereCard } from "./StartHereCard";
import { useUIStore } from "../../stores/ui";
import { useBackupStore } from "../../stores/backup";
import { markFirstRun, isFirstRun, useFirstRunStore, markSaidHello, FOLLOWS_TO_START } from "../../stores/firstRun";

const row = (name: string) => screen.getByRole("button", { name: new RegExp(name) });

beforeEach(() => {
  localStorage.clear();
  Object.assign(user, { pubkey: "me", loggedIn: true, profile: { name: "Ana" }, follows: [], canSign: true, ownProfileRead: "none" });
  useBackupStore.setState({ pending: [] });
  useFirstRunStore.setState({ accounts: [], hello: [] });
  useUIStore.setState({ currentView: "feed", viewStack: [], composeRequest: 0, editProfileFor: null, followsTab: "following" });
  markFirstRun("me");
});
afterEach(cleanup);

describe("StartHereCard", () => {
  it("is only for an account made here, signed in with its key", () => {
    useFirstRunStore.setState({ accounts: [] });
    const { unmount } = render(<StartHereCard />);
    expect(screen.queryByText(/Welcome/)).toBeNull();
    unmount();
    markFirstRun("me");
    user.canSign = false;
    render(<StartHereCard />);
    expect(screen.queryByText(/Welcome/)).toBeNull();
  });

  it("greets by name and lists what to do, each leading where it is done", () => {
    render(<StartHereCard />);
    expect(screen.getByRole("heading", { name: "Welcome, Ana." })).toBeTruthy();
    fireEvent.click(row("Add a picture"));
    expect(useUIStore.getState().currentView).toBe("profile");
    expect(useUIStore.getState().editProfileFor).toBe("me");
    useUIStore.setState({ currentView: "feed", editProfileFor: null });
    fireEvent.click(row("Write a bio"));
    expect(useUIStore.getState().editProfileFor).toBe("me");
    fireEvent.click(row("Follow a few people"));
    expect(useUIStore.getState().currentView).toBe("follows");
    expect(useUIStore.getState().followsTab).toBe("following");
    fireEvent.click(row("Say hello"));
    expect(useUIStore.getState().currentView).toBe("feed");
    expect(useUIStore.getState().composeRequest).toBe(1);
    expect(screen.queryByText("Back up your secret key")).toBeNull();
  });

  it("greets without a name when there is none", () => {
    user.profile = null;
    render(<StartHereCard />);
    expect(screen.getByRole("heading", { name: "Welcome." })).toBeTruthy();
  });

  it("offers the backup only while the key has not been copied, and opens the dialog for it", () => {
    useBackupStore.setState({ pending: ["me"] });
    render(<StartHereCard />);
    fireEvent.click(row("Back up your secret key"));
    expect(screen.getByRole("dialog", { name: "Back up" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useBackupStore.getState().clearPending("me"));
    expect(screen.queryByText("Back up your secret key")).toBeNull();
  });

  it("ticks off what is done: the picture and the bio each on their own, three follows, and a note posted", () => {
    user.profile = { name: "Ana", about: "hi" };
    user.follows = ["a"];
    const { unmount } = render(<StartHereCard />);
    expect(row("Add a picture").textContent).not.toContain("Done:");
    expect(row("Write a bio").textContent).toContain("Done:");
    expect(row("Follow a few people").textContent).not.toContain("Done:");
    expect(row("Say hello").textContent).not.toContain("Done:");
    unmount();
    user.profile = { name: "Ana", picture: "https://x/a.png", about: "   " };
    render(<StartHereCard />);
    expect(row("Add a picture").textContent).toContain("Done:");
    expect(row("Write a bio").textContent).not.toContain("Done:");
    cleanup();
    user.profile = { name: "Ana", about: "hi", picture: "https://x/a.png" };
    user.follows = ["a", "b", "c"];
    useBackupStore.setState({ pending: ["me"] });
    render(<StartHereCard />);
    expect(row("Follow a few people").textContent).toContain("Done:");
    act(() => markSaidHello("me"));
    expect(row("Say hello").textContent).toContain("Done:");
  });

  it("hears about an account made from inside the app, with the feed already on screen", () => {
    useFirstRunStore.setState({ accounts: [] });
    render(<StartHereCard />);
    expect(screen.queryByText(/Welcome/)).toBeNull();
    act(() => markFirstRun("me"));
    expect(screen.getByText(/Welcome/)).toBeTruthy();
  });

  // The edit form opens on what is held; before the relays have answered that is nothing.
  it("leads to the profile, not its edit form, while the profile has not been read", () => {
    user.profile = null;
    user.ownProfileRead = "pending";
    render(<StartHereCard />);
    fireEvent.click(row("Add a picture"));
    expect(useUIStore.getState().currentView).toBe("profile");
    expect(useUIStore.getState().editProfileFor).toBeNull();
  });

  it("keeps the backup dialog up when the copy completes the card", () => {
    user.profile = { name: "Ana", about: "hi", picture: "https://x/a.png" };
    user.follows = ["a", "b", "c"];
    useBackupStore.setState({ pending: ["me"] });
    markSaidHello("me");
    render(<StartHereCard />);
    fireEvent.click(row("Back up your secret key"));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("dialog", { name: "Back up" })).toBeTruthy();
    expect(isFirstRun("me")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Welcome/)).toBeNull();
    expect(isFirstRun("me")).toBe(false);
  });

  it("clips a long name and does not double the full stop", () => {
    user.profile = { name: "Dr. " + "x".repeat(60) };
    render(<StartHereCard />);
    const title = screen.getByRole("heading", { level: 2 }).textContent!;
    expect(title.startsWith("Welcome, Dr. xxx")).toBe(true);
    expect(title.endsWith("…")).toBe(true);
    expect(Array.from(title).length).toBeLessThan(55);
    user.profile = { name: "Ana." };
    cleanup();
    render(<StartHereCard />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Welcome, Ana.");
  });

  it("offers the topics this account picked, opening each", () => {
    localStorage.setItem("wrystr_interests_me", JSON.stringify(["bitcoin", "art"]));
    render(<StartHereCard />);
    fireEvent.click(screen.getByRole("button", { name: "#art" }));
    expect(useUIStore.getState().currentView).toBe("hashtag");
  });

  it("goes for good when dismissed", () => {
    render(<StartHereCard />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Welcome/)).toBeNull();
    expect(isFirstRun("me")).toBe(false);
  });

  it("goes for good once everything on it is done", () => {
    user.profile = { name: "Ana", picture: "https://x/a.png", about: "hi" };
    user.follows = Array.from({ length: FOLLOWS_TO_START }, (_, i) => `p${i}`);
    markSaidHello("me");
    render(<StartHereCard />);
    expect(screen.queryByText(/Welcome/)).toBeNull();
    expect(isFirstRun("me")).toBe(false);
  });

  it("is not done while the key is still to be backed up, no note has been posted, or the bio is missing", () => {
    user.profile = { name: "Ana", picture: "https://x/a.png", about: "hi" };
    user.follows = Array.from({ length: FOLLOWS_TO_START }, (_, i) => `p${i}`);
    render(<StartHereCard />);
    expect(screen.getByText(/Welcome/)).toBeTruthy();
    cleanup();
    markSaidHello("me");
    user.profile = { name: "Ana", picture: "https://x/a.png" };
    render(<StartHereCard />);
    expect(screen.getByText(/Welcome/)).toBeTruthy();
    cleanup();
    user.profile = { name: "Ana", picture: "https://x/a.png", about: "hi" };
    markSaidHello("me");
    useBackupStore.setState({ pending: ["me"] });
    render(<StartHereCard />);
    expect(screen.getByText(/Welcome/)).toBeTruthy();
  });
});
