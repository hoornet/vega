import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("../../lib/nostr", () => ({
  fetchHashtagFeed: vi.fn(),
}));
vi.mock("../../stores/ui", () => ({ useUIStore: () => ({ pendingHashtag: "bitcoin", goBack: vi.fn() }) }));
vi.mock("./NoteCard", () => ({ NoteCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));

import { HashtagFeed } from "./HashtagFeed";
import { fetchHashtagFeed } from "../../lib/nostr";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const note = (id: string, content: string) => ({ id, content, created_at: 1000, kind: 1, pubkey: "pk", tags: [] }) as unknown as NDKEvent;
const answering = (events: NDKEvent[]) => async () => { recordFetchOutcome(true); return events; };
const timingOut = async () => { recordFetchOutcome(false); return [] as NDKEvent[]; };

/** Lets the load run, including the three-second pause before it asks a second time. */
const settle = async (ms = 3100) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchHashtagFeed).mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("HashtagFeed", () => {
  it("shows the notes and how many there are", async () => {
    vi.mocked(fetchHashtagFeed).mockImplementation(answering([note("a", "first"), note("b", "second")]));
    render(<HashtagFeed />);
    expect(screen.getByRole("status").textContent).toBe("Loading notes for #bitcoin…");
    await settle(0);
    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.getByText("2 notes")).toBeTruthy();
    expect(fetchHashtagFeed).toHaveBeenCalledTimes(1);
  });

  // Relays are often slow on the first ask, so an empty answer is asked for once more.
  it("asks a second time, three seconds after an empty answer, and shows what that finds", async () => {
    vi.mocked(fetchHashtagFeed).mockImplementationOnce(answering([])).mockImplementation(answering([note("a", "late")]));
    render(<HashtagFeed />);
    await settle(2900);
    expect(fetchHashtagFeed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeTruthy(); // still loading: not "No notes found" yet
    expect(screen.queryByText(/No notes found/)).toBeNull();
    await settle(200);
    expect(fetchHashtagFeed).toHaveBeenCalledTimes(2);
    expect(screen.getByText("late")).toBeTruthy();
  });

  it("says there are none when a relay answered with none, twice", async () => {
    vi.mocked(fetchHashtagFeed).mockImplementation(answering([]));
    render(<HashtagFeed />);
    await settle();
    expect(screen.getByText("No notes found for #bitcoin.")).toBeTruthy();
    expect(screen.getByText("0 notes")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // This used to read "No notes found for #bitcoin" under a header saying "0 notes".
  it("says the relays could not be reached when nobody answered, with no count", async () => {
    vi.mocked(fetchHashtagFeed).mockImplementation(timingOut);
    render(<HashtagFeed />);
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("so notes for #bitcoin can't be loaded");
    expect(screen.queryByText(/No notes found/)).toBeNull();
    expect(screen.queryByText("0 notes")).toBeNull();
  });

  it("shows a failure, not an empty list", async () => {
    vi.mocked(fetchHashtagFeed).mockRejectedValue(new Error("relay said no"));
    render(<HashtagFeed />);
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("relay said no");
    expect(screen.queryByText(/No notes found/)).toBeNull();
  });

  it("asks again on Try again", async () => {
    vi.mocked(fetchHashtagFeed).mockImplementationOnce(timingOut).mockImplementationOnce(timingOut).mockImplementation(answering([note("a", "first")]));
    render(<HashtagFeed />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();
    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
