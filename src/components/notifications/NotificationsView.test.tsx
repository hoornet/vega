import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("../../lib/nostr", () => ({ fetchMentions: vi.fn(), fetchZapsReceived: vi.fn(async () => []), fetchNewFollowers: vi.fn(async () => []), fetchNoteById: vi.fn(async () => null) }));
vi.mock("../../lib/db", () => ({ dbSaveNotifications: vi.fn(), dbLoadNotifications: vi.fn().mockResolvedValue([]), dbMarkNotificationRead: vi.fn(), dbNewestNotificationTs: vi.fn(async () => null) }));
vi.mock("../../stores/user", () => ({ useUserStore: () => ({ pubkey: "me", loggedIn: true }), useCanSign: () => true }));
const muted = vi.hoisted(() => ({ pubkeys: [] as string[] }));
vi.mock("../../stores/mute", () => ({ useMuteStore: <T,>(pick: (s: { mutedPubkeys: string[]; contentMatchesMutedKeyword: () => boolean }) => T) => pick({ mutedPubkeys: muted.pubkeys, contentMatchesMutedKeyword: () => false }) }));
vi.mock("../../hooks/useProfile", () => ({ useProfile: (pk: string) => (pk === "alice" ? { name: "Alice" } : pk === "bob" ? { name: "Bob" } : pk === "carol" ? { name: "Carol" } : null) }));
vi.mock("../../hooks/useNip05Verified", () => ({ useNip05Verified: () => "unknown" }));
vi.mock("../shared/FollowButton", () => ({ FollowButton: () => null }));
vi.mock("../feed/NoteCard", () => ({ NoteCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));

import { NotificationsView } from "./NotificationsView";
import { useNotificationsStore } from "../../stores/notifications";
import { useUIStore } from "../../stores/ui";

const mention = (id: string, pubkey = "someone", tags: string[][] = []) => ({ id, created_at: 1000, kind: 1, pubkey, content: `mention ${id}`, tags }) as unknown as NDKEvent;
const reply = (id: string, pubkey = "alice") => mention(id, pubkey, [["e", "root"], ["p", "me"]]);
/** Someone whose contact list names you. */
const follower = (id: string, pubkey = "carol") => ({ ...mention(id, pubkey), kind: 3, content: "" }) as unknown as NDKEvent;
/** A zap receipt: the zapper in `P` and in the embedded request, the amount in millisats. */
const zap = (id: string, zapper = "bob", sats = 21, comment = "nice one") => ({
  id, created_at: 1000, kind: 9735, pubkey: "ln-provider", content: "",
  tags: [["p", "me"], ["P", zapper], ["e", "note1"], ["description", JSON.stringify({ pubkey: zapper, content: comment, tags: [["amount", String(sats * 1000)]] })]],
}) as unknown as NDKEvent;
const fetchNotifications = vi.fn();
const EMPTY = "No notifications yet.";
const tab = (name: string | RegExp) => fireEvent.click(screen.getByRole("tab", { name }));
const highlighted = (text: string) => !!screen.getByText(text).closest(".bg-accent\\/5");

beforeEach(() => {
  muted.pubkeys = [];
  fetchNotifications.mockReset();
  useNotificationsStore.setState({ notifications: [], unreadCount: 0, loading: false, fetchOutcome: "answered", readIds: new Set(), newFollowerPubkeys: new Set(), newFollowersCount: 0, fetchNotifications, currentPubkey: "me" });
  useUIStore.setState({ currentView: "notifications" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("NotificationsView: states", () => {
  it("shows a skeleton while the first load is under way", () => {
    useNotificationsStore.setState({ loading: true });
    render(<NotificationsView />);
    expect(screen.getByRole("status", { name: "Loading notifications…" })).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("is loading, not empty, until the relays have been asked", () => {
    useNotificationsStore.setState({ fetchOutcome: "pending" });
    render(<NotificationsView />);
    expect(screen.getByRole("status", { name: "Loading notifications…" })).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("says there are none when a relay answered with none, on each tab in its own words", () => {
    render(<NotificationsView />);
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    tab("Mentions"); expect(screen.getByText("No mentions yet.")).toBeTruthy();
    tab("Zaps"); expect(screen.getByText("No zaps received yet.")).toBeTruthy();
    tab("Followers"); expect(screen.getByText("No followers to show from the last 30 days.")).toBeTruthy();
  });

  it("says the relays could not be reached, and never that there are none", () => {
    useNotificationsStore.setState({ fetchOutcome: "unreachable" });
    render(<NotificationsView />);
    expect(screen.getByRole("alert").textContent).toContain("so your notifications can't be loaded");
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("says the load failed, and never that there are none", () => {
    useNotificationsStore.setState({ fetchOutcome: "error" });
    render(<NotificationsView />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load your notifications.");
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("asks again on Try again", () => {
    useNotificationsStore.setState({ fetchOutcome: "unreachable" });
    render(<NotificationsView />);
    fetchNotifications.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchNotifications).toHaveBeenCalledWith("me");
  });

  it("shows what it has and no message when a refresh went unanswered", () => {
    useNotificationsStore.setState({ notifications: [mention("a")], fetchOutcome: "unreachable" });
    render(<NotificationsView />);
    expect(screen.getByText("mention a")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("keeps showing what it has while a refresh is under way", () => {
    useNotificationsStore.setState({ notifications: [mention("a")], loading: true });
    render(<NotificationsView />);
    expect(screen.getByText("mention a")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // Followers are rows of their own now. They count for All, and not for Mentions:
  // an unanswered fetch with only a follower held must not read "No mentions yet."
  it("counts a follower held as a row for All, and not for Mentions", () => {
    useNotificationsStore.setState({ notifications: [follower("f1")], fetchOutcome: "unreachable" });
    render(<NotificationsView />);
    expect(screen.getByText(/follows you$/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    tab("Mentions");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("No mentions yet.")).toBeNull();
  });

  it("does not count your own events as rows either", () => {
    useNotificationsStore.setState({ notifications: [mention("mine", "me")], fetchOutcome: "unreachable" });
    render(<NotificationsView />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("is empty, not a failure, when every notification it holds is muted", () => {
    muted.pubkeys = ["someone", "bob"];
    useNotificationsStore.setState({ notifications: [mention("a"), zap("z1", "bob")], fetchOutcome: "unreachable" });
    render(<NotificationsView />);
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("NotificationsView: tabs and reasons", () => {
  beforeEach(() => {
    useNotificationsStore.setState({
      notifications: [reply("r1"), mention("m1", "someone"), zap("z1"), follower("f1")],
      readIds: new Set(["m1"]),
      newFollowerPubkeys: new Set(["carol"]),
      newFollowersCount: 1,
    });
  });

  it("says what happened above each item, and a zap receipt is a zap, not a note", () => {
    render(<NotificationsView />);
    expect(screen.getByText("Alice replied in a thread you're in")).toBeTruthy();
    expect(screen.getByText(/mentioned you$/)).toBeTruthy();
    expect(screen.getByText("Bob zapped you 21 sats")).toBeTruthy();
    expect(screen.getByText("nice one")).toBeTruthy();
    expect(screen.getByText("Carol follows you")).toBeTruthy();
    // Two mentions are note cards; the receipt and the follower are not.
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("has a tab per kind, each saying how many still need attention", () => {
    render(<NotificationsView />);
    const names = screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label") ?? t.textContent);
    expect(names.join(" | ")).toMatch(/All.*3.*Mentions.*1.*Zaps.*1.*Followers.*1/);
    tab(/^Zaps/);
    expect(screen.getByText("Bob zapped you 21 sats")).toBeTruthy();
    expect(screen.queryByText("Alice replied in a thread you're in")).toBeNull();
    tab(/^Followers/);
    expect(screen.getByText("Carol follows you")).toBeTruthy();
    expect(within(screen.getByRole("tabpanel")).getByText("new")).toBeTruthy();
  });

  it("marks what is shown as read by being in front for a moment, keeps the highlight until the view is left, and not on a click", () => {
    vi.useFakeTimers();
    render(<NotificationsView />);
    expect(highlighted("mention r1")).toBe(true);
    expect(highlighted("mention m1")).toBe(false);
    fireEvent.click(screen.getByText("mention r1"));
    expect(useNotificationsStore.getState().readIds.has("r1")).toBe(false);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(useNotificationsStore.getState().readIds.has("r1")).toBe(true);
    expect(useNotificationsStore.getState().readIds.has("z1")).toBe(true);
    expect(useNotificationsStore.getState().newFollowersCount).toBe(0);
    // Still highlighted: it was new when the view came in front.
    expect(highlighted("mention r1")).toBe(true);
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
    act(() => { useUIStore.setState({ currentView: "feed" }); });
    act(() => { useUIStore.setState({ currentView: "notifications" }); });
    expect(highlighted("mention r1")).toBe(false);
  });

  it("marks only the tab that is showing, and an item that arrives while in front after its own moment", () => {
    vi.useFakeTimers();
    render(<NotificationsView />);
    tab(/^Zaps/);
    act(() => { vi.advanceTimersByTime(1500); });
    // The zap was looked at; the mention on another tab and the follower were not.
    expect(useNotificationsStore.getState().readIds.has("z1")).toBe(true);
    expect(useNotificationsStore.getState().readIds.has("r1")).toBe(false);
    expect(useNotificationsStore.getState().newFollowerPubkeys.has("carol")).toBe(true);
    // A zap that lands now is new: highlighted at once, read after its own moment, not before.
    act(() => { useNotificationsStore.getState().addNotifications([zap("z2", "bob", 5, "late")], "me"); });
    expect(highlighted("late")).toBe(true);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(useNotificationsStore.getState().readIds.has("z2")).toBe(false);
    act(() => { vi.advanceTimersByTime(600); });
    expect(useNotificationsStore.getState().readIds.has("z2")).toBe(true);
    expect(highlighted("late")).toBe(true);
  });

  it("does not list a zap from your own key as a zap to you", () => {
    useNotificationsStore.setState({ notifications: [zap("self", "me")] });
    render(<NotificationsView />);
    expect(screen.queryByText(/zapped you/)).toBeNull();
  });

  it("offers Mark all read while anything is unread, followers included", () => {
    useNotificationsStore.setState({ readIds: new Set(["r1", "m1", "z1"]) });
    render(<NotificationsView />);
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(useNotificationsStore.getState().newFollowersCount).toBe(0);
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });
});
