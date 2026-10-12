import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";

vi.mock("../lib/nostr", () => ({ fetchReactions: vi.fn() }));
vi.mock("../stores/user", () => ({ useUserStore: { getState: () => ({ pubkey: "me" }) } }));
vi.mock("../stores/wot", () => {
  const wot = { enabled: false, wotSet: new Set<string>() };
  return { useWoTStore: <T,>(pick: (s: typeof wot) => T) => pick(wot) };
});

import { useReactions, seedReactionsCache } from "./useReactions";
import { fetchReactions } from "../lib/nostr";

/** A feed row: it shows the reactions and hands out the function that records one. */
let record: (emoji: string) => void = () => {};
function Row({ id }: { id: string }) {
  const [data, addReaction] = useReactions(id);
  record = addReaction;
  return <p data-testid="row">{data ? [...data.groups].map(([emoji, n]) => `${emoji}${n}`).join(" ") + (data.myReactions.size ? " mine:" + [...data.myReactions].join("") : "") : "loading"}</p>;
}
const row = () => screen.getByTestId("row").textContent;
const none = () => ({ groups: new Map<string, number>(), myReactions: new Set<string>(), total: 0 });

beforeEach(() => { vi.mocked(fetchReactions).mockReset().mockResolvedValue(none()); });
afterEach(cleanup);

describe("useReactions: recording a reaction", () => {
  it("shows it at once on the row that made it", async () => {
    render(<Row id="note-a" />);
    await waitFor(() => expect(row()).not.toBe("loading"));
    act(() => record("🔥"));
    expect(row()).toBe("🔥1 mine:🔥");
  });

  // The row scrolled out of the virtual list while the reaction was on its
  // way. It was recorded inside a state updater, which React never runs for
  // an unmounted row: the row that scrolled back showed no pill, and the
  // same reaction could be sent again.
  it("is kept for a row that had scrolled away by the time it went out", async () => {
    const first = render(<Row id="note-b" />);
    await waitFor(() => expect(row()).not.toBe("loading"));
    const recordOnTheOldRow = record;
    first.unmount();
    recordOnTheOldRow("🔥");
    render(<Row id="note-b" />);
    expect(row()).toBe("🔥1 mine:🔥");
    expect(fetchReactions).toHaveBeenCalledTimes(1); // from what was recorded, not from the relays again
  });

  it("adds to what others already gave", async () => {
    vi.mocked(fetchReactions).mockResolvedValue({ groups: new Map([["🔥", 2]]), myReactions: new Set(), total: 2 });
    render(<Row id="note-c" />);
    await waitFor(() => expect(row()).toBe("🔥2"));
    act(() => record("🔥"));
    expect(row()).toBe("🔥3 mine:🔥");
  });

  // The tally was asked for before the reaction went out and does not have
  // it. Put in place of what was shown, the pill went, and the same reaction
  // was offered again.
  it("keeps a reaction given while the tally was still on its way, and adds it to the tally", async () => {
    let arrive: (tally: ReturnType<typeof none>) => void = () => {};
    vi.mocked(fetchReactions).mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    render(<Row id="note-d" />);
    expect(row()).toBe("loading");
    act(() => record("🔥"));
    expect(row()).toBe("🔥1 mine:🔥");
    await act(async () => { arrive({ groups: new Map([["🔥", 2], ["😂", 1]]), myReactions: new Set(), total: 3 }); });
    expect(row()).toBe("🔥3 😂1 mine:🔥");
  });

  it("does not count it twice when the tally already has it", async () => {
    let arrive: (tally: ReturnType<typeof none>) => void = () => {};
    vi.mocked(fetchReactions).mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    render(<Row id="note-e" />);
    act(() => record("🔥"));
    await act(async () => { arrive({ groups: new Map([["🔥", 3]]), myReactions: new Set(["🔥"]), total: 3 }); });
    expect(row()).toBe("🔥3 mine:🔥");
  });

  // The row scrolled away before the tally arrived. The tally was dropped,
  // the record held the user's own reaction and nothing else, and nothing
  // asked again: 🔥1 for the rest of the session where the relays had more.
  it("keeps the tally for a row that scrolled away before it arrived", async () => {
    let arrive: (tally: ReturnType<typeof none>) => void = () => {};
    vi.mocked(fetchReactions).mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    const first = render(<Row id="note-f" />);
    act(() => record("🔥"));
    first.unmount();
    await act(async () => { arrive({ groups: new Map([["🔥", 1], ["😂", 5]]), myReactions: new Set(), total: 6 }); });
    render(<Row id="note-f" />);
    expect(row()).toBe("🔥2 😂5 mine:🔥");
  });
});

// Trending fills the record for many notes at once, from a batch that is
// fetched without saying who is asking and so never knows the user's own.
describe("useReactions: filled in from a batch", () => {
  it("shows what the batch brought", () => {
    seedReactionsCache("note-g", new Map([["🔥", 2]]), new Set());
    render(<Row id="note-g" />);
    expect(row()).toBe("🔥2");
    expect(fetchReactions).not.toHaveBeenCalled();
  });

  it("keeps the user's own reaction, which the batch cannot know", async () => {
    render(<Row id="note-h" />);
    await waitFor(() => expect(row()).not.toBe("loading"));
    act(() => record("🔥"));
    cleanup();
    seedReactionsCache("note-h", new Map([["🔥", 3], ["😂", 1]]), new Set());
    render(<Row id="note-h" />);
    // The batch's count has it already: marked as the user's, not counted again.
    expect(row()).toBe("🔥3 😂1 mine:🔥");
  });

  it("counts the user's own reaction when the batch has not heard of it yet", async () => {
    render(<Row id="note-i" />);
    await waitFor(() => expect(row()).not.toBe("loading"));
    act(() => record("🔥"));
    cleanup();
    seedReactionsCache("note-i", new Map([["😂", 1]]), new Set());
    render(<Row id="note-i" />);
    expect(row()).toBe("😂1 🔥1 mine:🔥");
  });
});
