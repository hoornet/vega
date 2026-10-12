import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";

vi.mock("../lib/nostr", () => ({ fetchReactions: vi.fn() }));
vi.mock("../stores/user", () => ({ useUserStore: { getState: () => ({ pubkey: "me" }) } }));
vi.mock("../stores/wot", () => {
  const wot = { enabled: false, wotSet: new Set<string>() };
  return { useWoTStore: <T,>(pick: (s: typeof wot) => T) => pick(wot) };
});

import { useReactions } from "./useReactions";
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
});
