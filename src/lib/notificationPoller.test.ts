import { describe, it, expect, beforeEach, vi } from "vitest";

// The poller pulls in NDK and Tauri plugins at module load; none of that is
// needed to exercise the high-water bookkeeping.
vi.mock("./nostr", () => ({
  fetchMentions: vi.fn(), fetchZapsReceived: vi.fn(), fetchNewFollowers: vi.fn(),
  fetchNewDMs: vi.fn(), fetchProfile: vi.fn(), ensureConnected: vi.fn(),
}));
vi.mock("./notifications", () => ({
  notifyMention: vi.fn(), notifyZap: vi.fn(), notifyFollower: vi.fn(),
  notifyDM: vi.fn(), getNotificationSettings: () => ({ dms: true }),
}));
vi.mock("../stores/notifications", () => ({ useNotificationsStore: { getState: () => ({}) } }));
vi.mock("./db", () => ({ dbSaveNotifications: vi.fn(), dbNewestNotificationTs: vi.fn() }));

const { dmHighWater, setDmHighWater } = await import("./notificationPoller");

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const now = () => Math.floor(Date.now() / 1000);

describe("DM notification high-water mark", () => {
  beforeEach(() => localStorage.clear());

  // The one that matters: without this, upgrading to a build that notifies for
  // DMs would fire an OS notification for every message ever received.
  it("starts at now on a fresh account, so history is never announced", () => {
    const mark = dmHighWater(ALICE);
    expect(mark).toBeGreaterThanOrEqual(now() - 2);
    expect(mark).toBeLessThanOrEqual(now() + 2);
  });

  it("persists the first value instead of drifting forward each call", () => {
    const first = dmHighWater(ALICE);
    const second = dmHighWater(ALICE);
    expect(second).toBe(first);
  });

  it("keeps a separate mark per account", () => {
    setDmHighWater(ALICE, 1000);
    setDmHighWater(BOB, 2000);
    expect(dmHighWater(ALICE)).toBe(1000);
    expect(dmHighWater(BOB)).toBe(2000);
  });

  it("advances once messages have been notified", () => {
    setDmHighWater(ALICE, 1000);
    setDmHighWater(ALICE, 1500);
    expect(dmHighWater(ALICE)).toBe(1500);
  });

  it("falls back to now on a corrupted value rather than replaying everything", () => {
    localStorage.setItem(`wrystr_dm_notified_through:${ALICE}`, "not-a-number");
    const mark = dmHighWater(ALICE);
    expect(mark).toBeGreaterThanOrEqual(now() - 2);
  });
});
