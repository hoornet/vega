import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const user = vi.hoisted(() => ({ pubkey: "me", follows: [] as string[], followsStatus: "loaded" as "idle" | "loading" | "loaded" | "unknown", fetchFollows: (() => {}) as () => void }));
const ui = vi.hoisted(() => ({ followsTab: "followers" as "followers" | "following", viewStack: [] as unknown[], goBack: () => {} }));

vi.mock("../../lib/nostr", () => ({ fetchFollowers: vi.fn(), ensureConnected: vi.fn().mockResolvedValue(true) }));
vi.mock("../../lib/db", () => ({ dbLoadFollowers: vi.fn().mockResolvedValue([]), dbSaveFollowers: vi.fn() }));
vi.mock("../../stores/user", () => ({ useUserStore: () => user }));
vi.mock("../../stores/ui", () => ({ useUIStore: () => ({ followsTab: ui.followsTab, setFollowsTab: (tab: "followers" | "following") => { ui.followsTab = tab; }, openProfile: () => {}, viewStack: ui.viewStack, goBack: ui.goBack }) }));
vi.mock("../../stores/notifications", () => ({ useNotificationsStore: () => ({ newFollowerPubkeys: [] as string[], clearNewFollowers: () => {} }) }));
vi.mock("../../hooks/useProfile", () => ({ useProfile: () => null }));
vi.mock("../../hooks/useNip05Verified", () => ({ useNip05Verified: () => "unknown" }));
vi.mock("../shared/FollowButton", () => ({ FollowButton: () => null }));

import { FollowsView } from "./FollowsView";
import { fetchFollowers } from "../../lib/nostr";
import { dbLoadFollowers } from "../../lib/db";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const A = "a".repeat(64);
const answering = (pubkeys: string[]) => async () => { recordFetchOutcome(true); return pubkeys; };
const timingOut = async () => { recordFetchOutcome(false); return [] as string[]; };
const fetchFollows = vi.fn();
/** Lets the load run, including the three-second pause before it asks a second time. */
const settle = async (ms = 3100) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const tab = (name: RegExp) => screen.getByRole("tab", { name }).textContent;
const EMPTY = "No followers found yet.";

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(user, { pubkey: "me", follows: [], followsStatus: "loaded", fetchFollows });
  ui.followsTab = "followers";
  vi.mocked(fetchFollowers).mockReset();
  vi.mocked(dbLoadFollowers).mockReset().mockResolvedValue([]);
  fetchFollows.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("FollowsView: Followers", () => {
  it("says it is loading, then lists them with their count", async () => {
    vi.mocked(fetchFollowers).mockImplementation(answering([A]));
    render(<FollowsView />);
    await settle(0);
    expect(screen.queryByText(EMPTY)).toBeNull();
    await settle();
    expect(tab(/Followers/)).toBe("Followers1");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("says there are none, with a zero, when a relay answered with none", async () => {
    vi.mocked(fetchFollowers).mockImplementation(answering([]));
    render(<FollowsView />);
    await settle();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(tab(/Followers/)).toBe("Followers0");
  });

  // The whole point: this used to read "No followers found yet." beside "Followers 0".
  it("says the relays could not be reached when nobody answered, with no zero beside it", async () => {
    vi.mocked(fetchFollowers).mockImplementation(timingOut);
    render(<FollowsView />);
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("so your followers can't be loaded");
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(tab(/Followers/)).toBe("Followers");
  });

  it("asks again on Try again, and lists what that finds", async () => {
    vi.mocked(fetchFollowers).mockImplementationOnce(timingOut).mockImplementationOnce(timingOut).mockImplementation(answering([A]));
    render(<FollowsView />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(tab(/Followers/)).toBe("Followers1");
    expect(fetchFollowers).toHaveBeenCalledTimes(3);
  });

  it("shows a failure with its reason, and no zero", async () => {
    vi.mocked(fetchFollowers).mockRejectedValue(new Error("relay said no"));
    render(<FollowsView />);
    await settle();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't load your followers.");
    expect(alert.textContent).toContain("relay said no");
    expect(tab(/Followers/)).toBe("Followers");
  });

  it("keeps the followers this device already knows when nobody answered", async () => {
    vi.mocked(dbLoadFollowers).mockResolvedValue([A]);
    vi.mocked(fetchFollowers).mockImplementation(timingOut);
    render(<FollowsView />);
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(tab(/Followers/)).toBe("Followers1");
  });
});

describe("FollowsView: Following", () => {
  beforeEach(() => { ui.followsTab = "following"; });

  it("says the account follows nobody only when the list loaded", async () => {
    render(<FollowsView />);
    await settle(0);
    expect(screen.getByText("Not following anyone yet.")).toBeTruthy();
    expect(tab(/Following/)).toBe("Following0");
  });

  it("says the relays could not be reached when the list is unknown, with no zero, and asks for it again", async () => {
    user.followsStatus = "unknown";
    render(<FollowsView />);
    await settle(0);
    expect(screen.getByRole("alert").textContent).toContain("so the list of people you follow can't be loaded");
    expect(screen.queryByText("Not following anyone yet.")).toBeNull();
    expect(tab(/Following/)).toBe("Following");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchFollows).toHaveBeenCalledTimes(1);
  });

  it("says it is loading the list while it is", async () => {
    user.followsStatus = "loading";
    render(<FollowsView />);
    await settle(0);
    expect(screen.getByRole("status").textContent).toBe("Loading the people you follow…");
  });
});

// People left the sidebar for the account menu, which pushes the view stack.
describe("FollowsView: the way back", () => {
  it("shows Back only when there is somewhere to go back to", () => {
    ui.viewStack = [];
    const { unmount } = render(<FollowsView />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    unmount();
    const goBack = vi.fn();
    ui.viewStack = [{ view: "feed" }]; ui.goBack = goBack;
    render(<FollowsView />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(goBack).toHaveBeenCalledTimes(1);
    ui.viewStack = []; ui.goBack = () => {};
  });
});
