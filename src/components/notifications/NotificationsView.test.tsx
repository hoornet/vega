import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("../../lib/nostr", () => ({ fetchMentions: vi.fn() }));
vi.mock("../../lib/db", () => ({ dbSaveNotifications: vi.fn(), dbLoadNotifications: vi.fn().mockResolvedValue([]), dbMarkNotificationRead: vi.fn() }));
vi.mock("../../stores/user", () => ({ useUserStore: () => ({ pubkey: "me", loggedIn: true }) }));
const muted = vi.hoisted(() => ({ pubkeys: [] as string[] }));
vi.mock("../../stores/mute", () => ({ useMuteStore: () => ({ mutedPubkeys: muted.pubkeys, contentMatchesMutedKeyword: () => false }) }));
vi.mock("../feed/NoteCard", () => ({ NoteCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));

import { NotificationsView } from "./NotificationsView";
import { useNotificationsStore } from "../../stores/notifications";

const mention = (id: string, pubkey = "someone") => ({ id, created_at: 1000, kind: 1, pubkey, content: `mention ${id}`, tags: [] }) as unknown as NDKEvent;
/** A new follower. The store holds these for the People badge; this view never lists them. */
const follower = (id: string) => ({ ...mention(id), kind: 3 }) as unknown as NDKEvent;
const fetchNotifications = vi.fn();
const EMPTY = "No mentions yet.";

beforeEach(() => {
  muted.pubkeys = [];
  fetchNotifications.mockReset();
  useNotificationsStore.setState({ notifications: [], unreadCount: 0, loading: false, fetchOutcome: "answered", readIds: new Set(), fetchNotifications });
});
afterEach(cleanup);

describe("NotificationsView", () => {
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

  it("says there are none when a relay answered with none", () => {
    render(<NotificationsView />);
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The whole point: this used to read "No mentions yet."
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

  // The store held one follower event, which counted as "rows held", so an
  // unanswered fetch read "No mentions yet."
  for (const failed of ["unreachable", "error"] as const) {
    it(`is ${failed}, not empty, when all the store holds are follower events`, () => {
      useNotificationsStore.setState({ notifications: [follower("f1")], fetchOutcome: failed });
      render(<NotificationsView />);
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.queryByText(EMPTY)).toBeNull();
    });
  }

  it("shows a skeleton, not the empty sentence, while loading with only follower events held", () => {
    useNotificationsStore.setState({ notifications: [follower("f1")], loading: true });
    render(<NotificationsView />);
    expect(screen.getByRole("status", { name: "Loading notifications…" })).toBeTruthy();
  });

  it("does not count your own events as rows either", () => {
    useNotificationsStore.setState({ notifications: [mention("mine", "me")], fetchOutcome: "unreachable" });
    render(<NotificationsView />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  // Everything it holds is from muted people: empty for this user, and a
  // refresh that failed afterwards does not make it a failure.
  it("is empty, not a failure, when every notification it holds is muted", () => {
    muted.pubkeys = ["someone"];
    useNotificationsStore.setState({ notifications: [mention("a")], fetchOutcome: "unreachable" });
    render(<NotificationsView />);
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
