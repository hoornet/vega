import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NDKEvent } from "@nostr-dev-kit/ndk";


vi.mock("../lib/nostr", () => ({
  fetchMentions: vi.fn(),
}));
vi.mock("../lib/db", () => ({
  dbSaveNotifications: vi.fn(),
  dbLoadNotifications: vi.fn().mockResolvedValue([]),
  dbMarkNotificationRead: vi.fn(),
}));

import { useNotificationsStore } from "./notifications";
import { fetchMentions } from "../lib/nostr";
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
