import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NDKEvent } from "@nostr-dev-kit/ndk";


vi.mock("../lib/nostr", () => ({
  fetchMentions: vi.fn(),
  fetchZapsReceived: vi.fn(async () => []),
  fetchNewFollowers: vi.fn(async () => []),
}));
const db = vi.hoisted(() => ({ newestFollower: null as number | null }));
vi.mock("../lib/db", () => ({
  dbSaveNotifications: vi.fn(),
  dbLoadNotifications: vi.fn().mockResolvedValue([]),
  dbMarkNotificationRead: vi.fn(),
  dbNewestNotificationTs: vi.fn(async () => db.newestFollower),
}));

import { useNotificationsStore } from "./notifications";
import { fetchMentions, fetchZapsReceived, fetchNewFollowers } from "../lib/nostr";
import { dbSaveNotifications } from "../lib/db";
import { recordFetchOutcome } from "../lib/nostr/fetchTotals";

const ME = "me";
const mention = (id: string, created_at = 1000) => ({ id, created_at, kind: 1, pubkey: "someone", content: "hi", tags: [], rawEvent: () => ({ id }) }) as unknown as NDKEvent;
const answering = (events: NDKEvent[]) => async () => { recordFetchOutcome(true); return events; };
const timingOut = async () => { recordFetchOutcome(false); return [] as NDKEvent[]; };

/** Runs the fetch through its 3s retry after an empty answer. */
const fetchNotifications = async () => {
  const done = useNotificationsStore.getState().fetchNotifications(ME);
  await vi.advanceTimersByTimeAsync(3100);
  await done;
};

beforeEach(() => {
  vi.useFakeTimers();
    vi.mocked(fetchMentions).mockReset();
  useNotificationsStore.setState({ notifications: [], unreadCount: 0, loading: false, fetchOutcome: "pending", currentPubkey: ME, readIds: new Set() });
});
afterEach(() => { vi.useRealTimers(); });

describe("fetchNotifications: how the load ended", () => {
  it("starts as not asked: nothing is known until a fetch has ended", () => {
    expect(useNotificationsStore.getInitialState().fetchOutcome).toBe("pending");
  });

  // "No mentions yet." used to be the answer to a fetch nobody answered.
  it("is unreachable when nothing came back and nobody answered", async () => {
    vi.mocked(fetchMentions).mockImplementation(timingOut);
    await fetchNotifications();
    const s = useNotificationsStore.getState();
    expect(s.fetchOutcome).toBe("unreachable");
    expect(s.loading).toBe(false);
  });

  it("is answered when a relay answered with nothing", async () => {
    vi.mocked(fetchMentions).mockImplementation(answering([]));
    await fetchNotifications();
    expect(useNotificationsStore.getState().fetchOutcome).toBe("answered");
  });

  it("is answered when mentions came back", async () => {
    useNotificationsStore.setState({ fetchOutcome: "unreachable" });
    vi.mocked(fetchMentions).mockImplementation(answering([mention("a")]));
    await fetchNotifications();
    const s = useNotificationsStore.getState();
    expect(s.fetchOutcome).toBe("answered");
    expect(s.notifications.map((e) => e.id)).toEqual(["a"]);
  });

  // Your own notes mention you too, and are left out. A relay that sent only
  // those did answer.
  it("is answered when only your own events came back", async () => {
    vi.mocked(fetchMentions).mockImplementation(answering([{ ...mention("mine"), pubkey: ME } as unknown as NDKEvent]));
    await fetchNotifications();
    const s = useNotificationsStore.getState();
    expect(s.fetchOutcome).toBe("answered");
    expect(s.notifications).toEqual([]);
  });

  // "unreachable" is for nothing coming back. Mentions that came from the
  // built-in relay alone are still mentions to show.
  it("is answered when mentions came back, whatever the network did", async () => {
    vi.mocked(fetchMentions).mockImplementation(async () => { recordFetchOutcome(false); return [mention("a")]; });
    await fetchNotifications();
    const s = useNotificationsStore.getState();
    expect(s.fetchOutcome).toBe("answered");
    expect(s.notifications.map((e) => e.id)).toEqual(["a"]);
  });

  it("keeps what is on screen when nobody answered", async () => {
    const onScreen = [mention("old")];
    useNotificationsStore.setState({ notifications: onScreen });
    vi.mocked(fetchMentions).mockImplementation(timingOut);
    await fetchNotifications();
    const s = useNotificationsStore.getState();
    expect(s.fetchOutcome).toBe("unreachable");
    expect(s.notifications).toBe(onScreen);
  });

  it("is an error, with what is on screen kept and loading over, when the load throws", async () => {
    const onScreen = [mention("old")];
    useNotificationsStore.setState({ notifications: onScreen });
    vi.mocked(fetchMentions).mockRejectedValue(new Error("boom"));
    await fetchNotifications();
    const s = useNotificationsStore.getState();
    expect(s.fetchOutcome).toBe("error");
    expect(s.notifications).toBe(onScreen);
    expect(s.loading).toBe(false);
  });
});

describe("fetchNotifications: zaps and followers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchMentions).mockReset();
    vi.mocked(fetchZapsReceived).mockReset();
    vi.mocked(fetchNewFollowers).mockReset();
    vi.mocked(dbSaveNotifications).mockReset();
    db.newestFollower = null;
    useNotificationsStore.setState({ notifications: [], readIds: new Set(), unreadCount: 0, fetchOutcome: "pending", currentPubkey: null, newFollowerPubkeys: new Set(), newFollowersCount: 0 });
  });
  afterEach(() => vi.useRealTimers());

  const zap = (id: string) => ({ id, created_at: 1000, kind: 9735, pubkey: "ln", content: "", tags: [["p", ME]], rawEvent: () => ({ id }) }) as unknown as NDKEvent;
  const follower = (id: string, pubkey = "carol") => ({ id, created_at: 1000, kind: 3, pubkey, content: "", tags: [["p", ME]], rawEvent: () => ({ id }) }) as unknown as NDKEvent;

  it("asks for zaps within the same window as mentions, not of any age", async () => {
    vi.mocked(fetchMentions).mockImplementation(answering([mention("a")]));
    vi.mocked(fetchZapsReceived).mockImplementation(answering([]));
    vi.mocked(fetchNewFollowers).mockImplementation(answering([]));
    await fetchNotifications();
    const [, , since] = vi.mocked(fetchZapsReceived).mock.calls[0];
    expect(typeof since).toBe("number");
    expect(Math.floor(Date.now() / 1000) - (since as number)).toBeGreaterThanOrEqual(7 * 86400 - 5);
  });

  it("asks for mentions once more, on their own, when only they came back empty", async () => {
    vi.mocked(fetchMentions).mockImplementationOnce(answering([])).mockImplementation(answering([mention("late")]));
    vi.mocked(fetchZapsReceived).mockImplementation(answering([zap("z")]));
    vi.mocked(fetchNewFollowers).mockImplementation(answering([]));
    await fetchNotifications();
    expect(vi.mocked(fetchMentions)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchZapsReceived)).toHaveBeenCalledTimes(1);
    expect(useNotificationsStore.getState().notifications.map((e) => e.id).sort()).toEqual(["late", "z"]);
  });

  it("calls a follower new when their list is newer than the newest one known, whichever path found it", async () => {
    // Known: a follower list from t=1000 is held. Carol's list is from t=2000: new. Dave's is older: not.
    useNotificationsStore.setState({ notifications: [follower("f0", "erin")], currentPubkey: ME });
    vi.mocked(fetchMentions).mockImplementation(answering([]));
    vi.mocked(fetchZapsReceived).mockImplementation(answering([]));
    vi.mocked(fetchNewFollowers).mockImplementation(answering([{ ...follower("f1", "carol"), created_at: 2000 } as unknown as NDKEvent, { ...follower("f2", "dave"), created_at: 500 } as unknown as NDKEvent]));
    await fetchNotifications();
    expect([...useNotificationsStore.getState().newFollowerPubkeys]).toEqual(["carol"]);
  });

  it("calls nobody new on a first run, when nothing is known yet", async () => {
    db.newestFollower = null;
    vi.mocked(fetchMentions).mockImplementation(answering([]));
    vi.mocked(fetchZapsReceived).mockImplementation(answering([]));
    vi.mocked(fetchNewFollowers).mockImplementation(answering([follower("f1", "carol")]));
    await fetchNotifications();
    expect(useNotificationsStore.getState().newFollowerPubkeys.size).toBe(0);
    expect(useNotificationsStore.getState().notifications.map((e) => e.id)).toEqual(["f1"]);
  });

  it("does not save a follower already held under the new id their edited list carries", async () => {
    useNotificationsStore.setState({ notifications: [follower("f0", "carol")], currentPubkey: ME });
    vi.mocked(fetchMentions).mockImplementation(answering([]));
    vi.mocked(fetchZapsReceived).mockImplementation(answering([]));
    vi.mocked(fetchNewFollowers).mockImplementation(answering([{ ...follower("f1", "carol"), created_at: 3000 } as unknown as NDKEvent]));
    await fetchNotifications();
    expect(vi.mocked(dbSaveNotifications)).not.toHaveBeenCalled();
    expect(useNotificationsStore.getState().notifications.filter((e) => e.kind === 3)).toHaveLength(1);
  });

  it("drops a sweep's results when the account changed while it ran", async () => {
    let answer: (v: NDKEvent[]) => void = () => {};
    vi.mocked(fetchMentions).mockImplementation(() => new Promise((r) => { answer = r; }));
    vi.mocked(fetchZapsReceived).mockImplementation(answering([]));
    vi.mocked(fetchNewFollowers).mockImplementation(answering([]));
    const run = useNotificationsStore.getState().fetchNotifications(ME);
    // The sweep reads the follower mark first; the fetches start after that.
    await vi.advanceTimersByTimeAsync(0);
    useNotificationsStore.setState({ currentPubkey: "someone-else", notifications: [] });
    answer([mention("a")]);
    await run;
    expect(useNotificationsStore.getState().notifications).toEqual([]);
  });

  it("asks for mentions, zaps received and recent followers together, saves each under its type, and counts a zap as unread", async () => {
    vi.mocked(fetchMentions).mockImplementation(answering([mention("a")]));
    vi.mocked(fetchZapsReceived).mockImplementation(answering([zap("z")]));
    vi.mocked(fetchNewFollowers).mockImplementation(answering([follower("f")]));
    await fetchNotifications();
    const s = useNotificationsStore.getState();
    expect(s.notifications.map((e) => e.id).sort()).toEqual(["a", "f", "z"]);
    expect(s.unreadCount).toBe(2);
    expect(vi.mocked(dbSaveNotifications).mock.calls.map(([, , type]) => type).sort()).toEqual(["follower", "mention", "zap"]);
    expect(s.fetchOutcome).toBe("answered");
  });

  it("is a failed load only when a fetch threw and nothing else came back", async () => {
    vi.mocked(fetchMentions).mockRejectedValue(new Error("boom"));
    vi.mocked(fetchZapsReceived).mockImplementation(answering([zap("z")]));
    vi.mocked(fetchNewFollowers).mockImplementation(answering([]));
    await fetchNotifications();
    expect(useNotificationsStore.getState().fetchOutcome).toBe("answered");
    expect(useNotificationsStore.getState().notifications.map((e) => e.id)).toEqual(["z"]);
  });
});

describe("the store's other doors", () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: [], readIds: new Set(), unreadCount: 0, currentPubkey: ME, newFollowerPubkeys: new Set(), newFollowersCount: 0 });
  });

  it("addNotifications merges by id, keeps one list per follower, recounts, and ignores another account's rows", () => {
    const s = () => useNotificationsStore.getState();
    s().addNotifications([mention("a"), mention("a"), { ...mention("f1"), kind: 3, pubkey: "carol" } as unknown as NDKEvent], ME);
    s().addNotifications([{ ...mention("f2"), kind: 3, pubkey: "carol", created_at: 2000 } as unknown as NDKEvent], ME);
    expect(s().notifications.map((e) => e.id).sort()).toEqual(["a", "f2"]);
    expect(s().unreadCount).toBe(1);
    s().addNotifications([mention("b")], "someone-else");
    expect(s().notifications.map((e) => e.id).sort()).toEqual(["a", "f2"]);
  });

  it("markReadMany marks exactly those, and clearNewFollowers with names clears only them", () => {
    const s = () => useNotificationsStore.getState();
    useNotificationsStore.setState({ notifications: [mention("a"), mention("b"), mention("c")], unreadCount: 3, newFollowerPubkeys: new Set(["carol", "dave"]), newFollowersCount: 2 });
    s().markReadMany(["a", "b"]);
    expect(s().unreadCount).toBe(1);
    expect(s().isRead("a") && s().isRead("b") && !s().isRead("c")).toBe(true);
    s().clearNewFollowers(["carol"]);
    expect([...s().newFollowerPubkeys]).toEqual(["dave"]);
    expect(s().newFollowersCount).toBe(1);
    s().clearNewFollowers();
    expect(s().newFollowerPubkeys.size).toBe(0);
  });
});
