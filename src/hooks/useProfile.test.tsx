import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

const fetchProfile = vi.hoisted(() => vi.fn());
vi.mock("../lib/nostr", () => ({ fetchProfile: (pubkey: string) => fetchProfile(pubkey) }));
const db = vi.hoisted(() => ({ dbLoadProfile: vi.fn(), dbSaveProfile: vi.fn() }));
vi.mock("../lib/db", () => db);

import { useProfile, primeProfileCache, peekCachedProfile } from "./useProfile";

// The cache lives for the life of the module, so each test has its own account.
let n = 0;
const nextPubkey = () => (++n).toString(16).padStart(64, "0");
/** A fetch that is still out, and the ways to end it. */
function fetchStillOut() {
  let answer!: (profile: unknown) => void;
  let fail!: (err: unknown) => void;
  fetchProfile.mockReturnValue(new Promise((resolve, reject) => { answer = resolve; fail = reject; }));
  return { answer: (profile: unknown) => answer(profile), fail: () => fail(new Error("Failed to parse profile event")) };
}
const onThisComputer = (profile: unknown) => db.dbLoadProfile.mockResolvedValue(typeof profile === "string" ? profile : JSON.stringify(profile));
const writtenToDisk = () => db.dbSaveProfile.mock.calls.map(([, json]) => JSON.parse(json as string));

beforeEach(() => {
  vi.clearAllMocks();
  db.dbLoadProfile.mockResolvedValue(null);
});
afterEach(cleanup);

describe("useProfile", () => {
  it("shows what the relays hold, and keeps a copy on this computer", async () => {
    const pubkey = nextPubkey();
    fetchProfile.mockResolvedValue({ name: "ana", created_at: 100 });
    const { result } = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(result.current).toEqual({ name: "ana", created_at: 100 }));
    expect(db.dbSaveProfile).toHaveBeenCalledWith(pubkey, JSON.stringify({ name: "ana", created_at: 100 }));
  });

  it("is nothing for an account nobody holds a profile of", async () => {
    const pubkey = nextPubkey();
    fetchProfile.mockResolvedValue(null);
    const { result } = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(fetchProfile).toHaveBeenCalledWith(pubkey));
    await waitFor(async () => expect(await peekCachedProfile(pubkey)).toBeUndefined());
    expect(result.current).toBeNull();
    expect(db.dbSaveProfile).not.toHaveBeenCalled();
  });

  it("does not ask again for an account it has an answer for", async () => {
    const pubkey = nextPubkey();
    fetchProfile.mockResolvedValue({ name: "ana", created_at: 100 });
    const first = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(first.result.current).toEqual({ name: "ana", created_at: 100 }));
    const second = renderHook(() => useProfile(pubkey));
    expect(second.result.current).toEqual({ name: "ana", created_at: 100 });
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });
});

// The copy on this computer is shown at once, while the relays are asked.
describe("the copy on this computer", () => {
  it("is shown before any relay answers", async () => {
    const pubkey = nextPubkey();
    onThisComputer({ name: "ana, from disk", created_at: 100 });
    fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(result.current).toEqual({ name: "ana, from disk", created_at: 100 }));
  });

  it("gives way to a newer profile from the relays, which is written over it", async () => {
    const pubkey = nextPubkey();
    onThisComputer({ name: "ana, from disk", created_at: 100 });
    const { answer } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(result.current).toEqual({ name: "ana, from disk", created_at: 100 }));
    answer({ name: "ana, renamed", created_at: 200 });
    await waitFor(() => expect(result.current).toEqual({ name: "ana, renamed", created_at: 200 }));
    expect(writtenToDisk()).toEqual([{ name: "ana, renamed", created_at: 200 }]);
  });

  // The name on a card used to turn back into a key when a slow relay sent
  // nothing: the fetch's "nothing" replaced the copy that was on screen.
  it("stays on screen when the relays send nothing", async () => {
    const pubkey = nextPubkey();
    onThisComputer({ name: "ana, from disk", created_at: 100 });
    const { answer } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(result.current).toEqual({ name: "ana, from disk", created_at: 100 }));
    answer(null);
    await waitFor(async () => expect(await peekCachedProfile(pubkey)).toEqual({ name: "ana, from disk", created_at: 100 }));
    expect(result.current).toEqual({ name: "ana, from disk", created_at: 100 });
    // Nothing new to write, and a card mounted afterwards shows it without asking again.
    expect(db.dbSaveProfile).not.toHaveBeenCalled();
    fetchProfile.mockClear();
    expect(renderHook(() => useProfile(pubkey)).result.current).toEqual({ name: "ana, from disk", created_at: 100 });
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  // The relay that was heard had not caught up. Written over the copy, the
  // older profile would be what the next launch starts from.
  it("stays, and is not written over, when the relays send an older one", async () => {
    const pubkey = nextPubkey();
    onThisComputer({ name: "ana, renamed", created_at: 200 });
    const { answer } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(result.current).toEqual({ name: "ana, renamed", created_at: 200 }));
    answer({ name: "ana", created_at: 100 });
    await waitFor(async () => expect(await peekCachedProfile(pubkey)).toEqual({ name: "ana, renamed", created_at: 200 }));
    expect(result.current).toEqual({ name: "ana, renamed", created_at: 200 });
    expect(db.dbSaveProfile).not.toHaveBeenCalled();
  });

  it("is read once for all the cards waiting on one fetch", async () => {
    const pubkey = nextPubkey();
    onThisComputer({ name: "ana, from disk", created_at: 100 });
    fetchStillOut();
    const first = renderHook(() => useProfile(pubkey));
    const second = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(second.result.current).toEqual({ name: "ana, from disk", created_at: 100 }));
    expect(first.result.current).toEqual({ name: "ana, from disk", created_at: 100 });
    expect(db.dbLoadProfile).toHaveBeenCalledTimes(1);
  });

  it("is passed over when it cannot be read, or is not a profile", async () => {
    for (const copy of ["{not json", "null", "42", '"ana"']) {
      const pubkey = nextPubkey();
      onThisComputer(copy);
      fetchProfile.mockResolvedValue({ name: "ana", created_at: 100 });
      const { result } = renderHook(() => useProfile(pubkey));
      await waitFor(() => expect(result.current).toEqual({ name: "ana", created_at: 100 }));
      expect(await peekCachedProfile(nextPubkey())).toBeUndefined();
    }
  });
});

// The owner saves their profile, or a batch brings a newer one, while a
// fetch for it is still out. What the fetch brings is what was replaced.
describe("a profile that came in while a fetch for it was out", () => {
  it("is not replaced by the older one the fetch brings", async () => {
    const pubkey = nextPubkey();
    const { answer } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    primeProfileCache(pubkey, { name: "ana, renamed", created_at: 200 }, "published");
    answer({ name: "ana", created_at: 100 });
    await waitFor(() => expect(result.current).toEqual({ name: "ana, renamed", created_at: 200 }));
    expect(await peekCachedProfile(pubkey)).toEqual({ name: "ana, renamed", created_at: 200 });
    // The copy on this computer is the saved one too: the older was not written over it.
    expect(writtenToDisk()).toEqual([{ name: "ana, renamed", created_at: 200 }]);
  });

  it("is not blanked by a fetch that brings nothing", async () => {
    const pubkey = nextPubkey();
    const { answer } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    primeProfileCache(pubkey, { name: "ana", created_at: 200 }, "published");
    answer(null);
    await waitFor(() => expect(result.current).toEqual({ name: "ana", created_at: 200 }));
    expect(await peekCachedProfile(pubkey)).toEqual({ name: "ana", created_at: 200 });
  });

  it("is replaced by a newer one from the relays", async () => {
    const pubkey = nextPubkey();
    const { answer } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    primeProfileCache(pubkey, { name: "ana", created_at: 200 }, "published");
    answer({ name: "ana, from another device", created_at: 300 });
    await waitFor(() => expect(result.current).toEqual({ name: "ana, from another device", created_at: 300 }));
    expect(await peekCachedProfile(pubkey)).toEqual({ name: "ana, from another device", created_at: 300 });
  });

  it("is replaced by one from the relays of the same moment", async () => {
    const pubkey = nextPubkey();
    const { answer } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    primeProfileCache(pubkey, { name: "ana", created_at: 200 }, "published");
    answer({ name: "ana", about: "as the relays hold it", created_at: 200 });
    await waitFor(() => expect(result.current).toEqual({ name: "ana", about: "as the relays hold it", created_at: 200 }));
  });

  it("is replaced when either has no date to go by", async () => {
    const pubkey = nextPubkey();
    const { answer } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    primeProfileCache(pubkey, { name: "ana" }, "published");
    answer({ name: "ana, as fetched", created_at: 100 });
    await waitFor(() => expect(result.current).toEqual({ name: "ana, as fetched", created_at: 100 }));
  });

  it("is what a card mounted afterwards shows, without another fetch", async () => {
    const pubkey = nextPubkey();
    primeProfileCache(pubkey, { name: "ana", created_at: 200 });
    const { result } = renderHook(() => useProfile(pubkey));
    expect(result.current).toEqual({ name: "ana", created_at: 200 });
    expect(fetchProfile).not.toHaveBeenCalled();
  });
});

// "Nothing" from a fetch is far more often a slow relay, or a network that
// was off for a moment, than an account with no profile. It used to be
// cached as null for the whole session: every name fetched while the
// network was off stayed a key until the app was restarted.
describe("an account a fetch found nothing for", () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });
  /** Wait for the fetch now out to come back. */
  const fetched = () => waitFor(() => expect(fetchProfile).toHaveBeenCalled(), { timeout: 2000 });

  it("is not asked for again at once, and is after half a minute", async () => {
    const pubkey = nextPubkey();
    fetchProfile.mockResolvedValue(null);
    const first = renderHook(() => useProfile(pubkey));
    await fetched();
    await waitFor(() => expect(first.result.current).toBeNull());
    cleanup();
    fetchProfile.mockClear();
    renderHook(() => useProfile(pubkey));
    expect(fetchProfile).not.toHaveBeenCalled();
    cleanup();
    vi.advanceTimersByTime(30_000);
    fetchProfile.mockResolvedValue({ name: "ana", created_at: 100 });
    const later = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(later.result.current).toEqual({ name: "ana", created_at: 100 }));
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it("waits longer each time: half a minute, two minutes, then ten", async () => {
    const pubkey = nextPubkey();
    fetchProfile.mockResolvedValue(null);
    const askedAt: number[] = [];
    const ask = async () => { fetchProfile.mockClear(); renderHook(() => useProfile(pubkey)); if (vi.mocked(fetchProfile).mock.calls.length) { askedAt.push(Date.now()); await fetched(); } cleanup(); };
    const t0 = Date.now();
    await ask();
    for (const step of [29_000, 1_000, 119_000, 1_000, 599_000, 1_000, 599_000, 1_000]) { vi.advanceTimersByTime(step); await ask(); }
    expect(askedAt.map((t) => Math.round((t - t0) / 1000))).toEqual([0, 30, 150, 750, 1350]);
  });

  it("is forgotten once a batch brings the profile", async () => {
    const pubkey = nextPubkey();
    fetchProfile.mockResolvedValue(null);
    renderHook(() => useProfile(pubkey));
    await fetched();
    cleanup();
    primeProfileCache(pubkey, { name: "ana", created_at: 100 });
    fetchProfile.mockClear();
    const { result } = renderHook(() => useProfile(pubkey));
    expect(result.current).toEqual({ name: "ana", created_at: 100 });
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it("is not a miss when the copy on this computer is shown", async () => {
    const pubkey = nextPubkey();
    onThisComputer({ name: "ana, from disk", created_at: 100 });
    fetchProfile.mockResolvedValue(null);
    const { result } = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(result.current).toEqual({ name: "ana, from disk", created_at: 100 }));
    await fetched();
    cleanup();
    fetchProfile.mockClear();
    const again = renderHook(() => useProfile(pubkey));
    expect(again.result.current).toEqual({ name: "ana, from disk", created_at: 100 });
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it("is still unknown to callers that decide on it", async () => {
    const pubkey = nextPubkey();
    fetchProfile.mockResolvedValue(null);
    renderHook(() => useProfile(pubkey));
    await fetched();
    expect(await peekCachedProfile(pubkey)).toBeUndefined();
  });
});

// A profile handed to the cache by something else: a batch from the relays,
// or the owner's own save.
describe("primeProfileCache", () => {
  it("takes a profile a relay sent, and keeps a copy on this computer", async () => {
    const pubkey = nextPubkey();
    primeProfileCache(pubkey, { name: "ana", created_at: 100 });
    expect(await peekCachedProfile(pubkey)).toEqual({ name: "ana", created_at: 100 });
    expect(writtenToDisk()).toEqual([{ name: "ana", created_at: 100 }]);
  });

  it("does not let a relay's older profile replace a newer one", async () => {
    const pubkey = nextPubkey();
    primeProfileCache(pubkey, { name: "ana, renamed", created_at: 200 });
    db.dbSaveProfile.mockClear();
    primeProfileCache(pubkey, { name: "ana", created_at: 100 });
    expect(await peekCachedProfile(pubkey)).toEqual({ name: "ana, renamed", created_at: 200 });
    expect(db.dbSaveProfile).not.toHaveBeenCalled();
  });

  it("lets a relay's newer profile replace an older one", async () => {
    const pubkey = nextPubkey();
    primeProfileCache(pubkey, { name: "ana", created_at: 100 });
    primeProfileCache(pubkey, { name: "ana, renamed", created_at: 200 });
    expect(await peekCachedProfile(pubkey)).toEqual({ name: "ana, renamed", created_at: 200 });
  });

  // What the owner just published is the newest there is, whatever the dates say.
  it("takes what the owner published as it is", async () => {
    const pubkey = nextPubkey();
    primeProfileCache(pubkey, { name: "ana, from a clock that runs fast", created_at: 900 });
    primeProfileCache(pubkey, { name: "ana, saved here", created_at: 200 }, "published");
    expect(await peekCachedProfile(pubkey)).toEqual({ name: "ana, saved here", created_at: 200 });
    expect(writtenToDisk()).toContainEqual({ name: "ana, saved here", created_at: 200 });
  });

  it("ignores nothing", async () => {
    const pubkey = nextPubkey();
    primeProfileCache(pubkey, null);
    primeProfileCache(pubkey, undefined, "published");
    expect(await peekCachedProfile(pubkey)).toBeUndefined();
    expect(db.dbSaveProfile).not.toHaveBeenCalled();
  });
});

// A profile on the relays that cannot be read makes the fetch fail.
describe("a fetch that failed", () => {
  it("leaves the copy on this computer on screen", async () => {
    const pubkey = nextPubkey();
    onThisComputer({ name: "ana, from disk", created_at: 100 });
    const { fail } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(result.current).toEqual({ name: "ana, from disk", created_at: 100 }));
    fail();
    await waitFor(() => expect(fetchProfile).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toEqual({ name: "ana, from disk", created_at: 100 });
  });

  it("leaves a profile saved meanwhile on screen", async () => {
    const pubkey = nextPubkey();
    const { fail } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    primeProfileCache(pubkey, { name: "ana", created_at: 200 }, "published");
    fail();
    await waitFor(() => expect(result.current).toEqual({ name: "ana", created_at: 200 }));
  });

  it("is nothing when nothing is known, and is asked again by the next card", async () => {
    const pubkey = nextPubkey();
    const { fail } = fetchStillOut();
    const { result } = renderHook(() => useProfile(pubkey));
    fail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
    fetchProfile.mockClear();
    fetchProfile.mockResolvedValue({ name: "ana", created_at: 100 });
    const next = renderHook(() => useProfile(pubkey));
    await waitFor(() => expect(next.result.current).toEqual({ name: "ana", created_at: 100 }));
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });
});
