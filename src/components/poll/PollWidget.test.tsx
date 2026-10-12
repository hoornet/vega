import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act, within } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("../../lib/nostr", () => ({ publishPollResponse: vi.fn(), fetchPollResponses: vi.fn() }));
vi.mock("../../stores/user", () => {
  const user = { pubkey: "me" };
  return { useCanSign: () => true, useUserStore: Object.assign(<T,>(pick: (s: typeof user) => T) => pick(user), { getState: () => user }) };
});

import { PollWidget } from "./PollWidget";
import { publishPollResponse, fetchPollResponses } from "../../lib/nostr";
import type { PollVotes } from "../../lib/nostr";
import { useToastStore } from "../../stores/toast";
import { setCurrentAccount } from "../../lib/currentAccount";

let serial = 0;
/** A fresh poll each time: the votes are cached per poll id. */
const poll = () => ({ id: `poll-${++serial}`, pubkey: "author", kind: 1068, content: "Tabs or spaces?", tags: [["option", "0", "Tabs"], ["option", "1", "Spaces"]] }) as unknown as NDKEvent;
const toasts = () => useToastStore.getState().toasts;
const option = (name: string, inside: HTMLElement = document.body) => within(inside).getByRole("button", { name: new RegExp(name) });
const NO_RELAYS = new Error("Not enough relays received the event (0 published, 1 required)");
const NOBODY: PollVotes = { votes: new Map(), myVote: null, total: 0 };
const ready = () => waitFor(() => expect(screen.getByText(/\d+ votes?$/)).toBeTruthy());
/** A publish that settles when told to. */
function heldPublish() {
  let finish: () => void = () => {};
  let fail: (err: Error) => void = () => {};
  vi.mocked(publishPollResponse).mockImplementation(() => new Promise<never>((resolve, reject) => {
    finish = () => resolve(undefined as never);
    fail = reject;
  }));
  return { finish: () => finish(), fail: (err: Error) => fail(err) };
}

beforeEach(() => {
  vi.mocked(fetchPollResponses).mockReset().mockResolvedValue(NOBODY);
  vi.mocked(publishPollResponse).mockReset().mockResolvedValue(undefined as never);
  useToastStore.setState({ toasts: [] });
  setCurrentAccount("me");
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("PollWidget: voting", () => {
  it("counts the vote once it has gone out", async () => {
    const event = poll();
    render(<PollWidget event={event} />);
    await ready();
    fireEvent.click(option("Tabs"));
    await waitFor(() => expect(option("Tabs").hasAttribute("disabled")).toBe(true)); // results are showing
    expect(publishPollResponse).toHaveBeenCalledWith(event.id, "author", 0);
    expect(screen.getByTitle("Your vote")).toBeTruthy();
    expect(screen.getByText("1 vote")).toBeTruthy();
    expect(toasts()).toEqual([]);
  });

  // The vote used to be shown as cast at once and stayed that way when no
  // relay took it. The poll then showed results, so it could not be tried again.
  it("does not show a vote that no relay took, says so, and can be tried again", async () => {
    vi.mocked(publishPollResponse).mockRejectedValueOnce(NO_RELAYS);
    render(<PollWidget event={poll()} />);
    await ready();
    fireEvent.click(option("Spaces"));
    await waitFor(() => expect(toasts()).toHaveLength(1));
    expect(toasts()[0].type).toBe("error");
    expect(toasts()[0].message).toBe("Couldn't send your vote: none of your relays accepted it. Your vote was not counted. Check your relays and try again.");
    expect(screen.queryByTitle("Your vote")).toBeNull();
    expect(option("Spaces").hasAttribute("disabled")).toBe(false);
    expect(option("Spaces").hasAttribute("aria-disabled")).toBe(false);

    fireEvent.click(option("Spaces"));
    await waitFor(() => expect(screen.getByTitle("Your vote")).toBeTruthy());
    expect(publishPollResponse).toHaveBeenCalledTimes(2);
  });

  it("sends one vote for two quick presses", async () => {
    const sent = heldPublish();
    render(<PollWidget event={poll()} />);
    await ready();
    fireEvent.click(option("Tabs"));
    fireEvent.click(option("Spaces"));
    expect(publishPollResponse).toHaveBeenCalledTimes(1);
    sent.finish();
    await waitFor(() => expect(screen.getByTitle("Your vote")).toBeTruthy());
  });

  // Nothing showed between the press and the result, for as long as a
  // remote signer took to answer.
  it("says on the chosen option that the vote is on its way, and holds the others back", async () => {
    const sent = heldPublish();
    render(<PollWidget event={poll()} />);
    await ready();
    fireEvent.click(option("Tabs"));
    expect(option("Tabs").getAttribute("aria-busy")).toBe("true");
    expect(option("Tabs").textContent).toContain("Sending…");
    expect(option("Tabs").className).not.toContain("opacity-50");
    expect(option("Spaces").getAttribute("aria-busy")).toBeNull();
    expect(option("Spaces").getAttribute("aria-disabled")).toBe("true");
    expect(option("Spaces").className).toContain("opacity-50");
    expect(option("Spaces").textContent).not.toContain("Sending…");
    // Not `disabled`: that would drop keyboard focus to the page.
    expect(option("Tabs").hasAttribute("disabled")).toBe(false);
    expect(option("Spaces").hasAttribute("disabled")).toBe(false);

    sent.finish();
    await waitFor(() => expect(screen.getByTitle("Your vote")).toBeTruthy());
    expect(screen.queryByText("Sending…")).toBeNull();
    expect(option("Spaces").className).not.toContain("opacity-50");
  });
});

// A feed row and the same note open in a thread, or a row that scrolled out
// of the virtual list and back, are different components showing one poll.
describe("PollWidget: one poll shown twice", () => {
  it("shows a vote on its way, and then the vote, in both", async () => {
    const sent = heldPublish();
    const event = poll();
    render(<><div data-testid="feed"><PollWidget event={event} /></div><div data-testid="thread"><PollWidget event={event} /></div></>);
    const feed = screen.getByTestId("feed");
    const thread = screen.getByTestId("thread");
    await waitFor(() => expect(within(thread).getByText("0 votes")).toBeTruthy());
    fireEvent.click(option("Tabs", feed));
    expect(option("Tabs", thread).getAttribute("aria-busy")).toBe("true");
    fireEvent.click(option("Spaces", thread));
    expect(publishPollResponse).toHaveBeenCalledTimes(1);

    sent.finish();
    await waitFor(() => expect(within(thread).getByTitle("Your vote")).toBeTruthy());
    expect(within(feed).getByTitle("Your vote")).toBeTruthy();
    expect(within(thread).getByText("1 vote")).toBeTruthy();
  });

  it("does not send a second vote from a row that scrolled out and back while the first was on its way", async () => {
    const sent = heldPublish();
    const event = poll();
    const first = render(<PollWidget event={event} />);
    await ready();
    fireEvent.click(option("Tabs"));
    first.unmount();

    render(<PollWidget event={event} />);
    expect(option("Tabs").getAttribute("aria-busy")).toBe("true");
    fireEvent.click(option("Spaces"));
    expect(publishPollResponse).toHaveBeenCalledTimes(1);

    // The row that sent it is gone. The one there now must still learn of it.
    sent.finish();
    await waitFor(() => expect(screen.getByTitle("Your vote")).toBeTruthy());
    expect(option("Tabs").textContent).toContain("100%");
  });

  it("shows a vote cast while the row was away, when the row comes back", async () => {
    const sent = heldPublish();
    const event = poll();
    const first = render(<PollWidget event={event} />);
    await ready();
    fireEvent.click(option("Spaces"));
    first.unmount();
    await act(async () => { sent.finish(); });
    render(<PollWidget event={event} />);
    expect(screen.getByTitle("Your vote")).toBeTruthy();
  });
});

describe("PollWidget: the tally and the vote", () => {
  // The tally was asked for before the vote went out and does not have it.
  // It used to replace what was shown, and the poll offered the vote again.
  it("keeps a vote cast before the tally arrived, and adds it to the tally", async () => {
    let tally: (votes: PollVotes) => void = () => {};
    vi.mocked(fetchPollResponses).mockReturnValue(new Promise((resolve) => { tally = resolve; }));
    render(<PollWidget event={poll()} />);
    expect(screen.getByText("loading votes…")).toBeTruthy();
    fireEvent.click(option("Tabs"));
    await waitFor(() => expect(screen.getByTitle("Your vote")).toBeTruthy());

    await act(async () => { tally({ votes: new Map([[0, 1], [1, 2]]), myVote: null, total: 3 }); });
    expect(screen.getByTitle("Your vote")).toBeTruthy();
    expect(screen.getByText("4 votes")).toBeTruthy();
    expect(option("Tabs").textContent).toContain("50%");
    expect(option("Tabs").hasAttribute("disabled")).toBe(true);
  });

  it("does not count the vote twice when the tally already has it", async () => {
    let tally: (votes: PollVotes) => void = () => {};
    vi.mocked(fetchPollResponses).mockReturnValue(new Promise((resolve) => { tally = resolve; }));
    render(<PollWidget event={poll()} />);
    fireEvent.click(option("Tabs"));
    await waitFor(() => expect(screen.getByTitle("Your vote")).toBeTruthy());
    await act(async () => { tally({ votes: new Map([[0, 2], [1, 2]]), myVote: 0, total: 4 }); });
    expect(screen.getByText("4 votes")).toBeTruthy();
  });

  // An older vote of ours from another device is in the tally. The one just
  // cast here is newer: the tally must not put the old one back.
  it("keeps the vote just cast over an older one of ours in the tally", async () => {
    let tally: (votes: PollVotes) => void = () => {};
    vi.mocked(fetchPollResponses).mockReturnValue(new Promise((resolve) => { tally = resolve; }));
    render(<PollWidget event={poll()} />);
    fireEvent.click(option("Tabs"));
    await waitFor(() => expect(screen.getByTitle("Your vote")).toBeTruthy());
    await act(async () => { tally({ votes: new Map([[1, 3]]), myVote: 1, total: 3 }); });
    expect(option("Tabs").querySelector('[title="Your vote"]')).toBeTruthy();
    expect(option("Spaces").querySelector('[title="Your vote"]')).toBeNull();
    expect(screen.getByText("3 votes")).toBeTruthy(); // moved, not added
  });

  it("shows the tally as it came when there was no vote", async () => {
    vi.mocked(fetchPollResponses).mockResolvedValue({ votes: new Map([[1, 3]]), myVote: null, total: 3 });
    render(<PollWidget event={poll()} />);
    await waitFor(() => expect(screen.getByText("3 votes")).toBeTruthy());
    expect(screen.queryByTitle("Your vote")).toBeNull();
    expect(option("Spaces").hasAttribute("disabled")).toBe(false);
  });

  // The row that asked for the tally is gone by the time it arrives. The
  // result used to be dropped, and the poll asked for again by every later row.
  it("keeps a tally that arrives after the row that asked for it has gone", async () => {
    let tally: (votes: PollVotes) => void = () => {};
    vi.mocked(fetchPollResponses).mockReturnValue(new Promise((resolve) => { tally = resolve; }));
    const event = poll();
    const first = render(<PollWidget event={event} />);
    first.unmount();
    await act(async () => { tally({ votes: new Map([[1, 3]]), myVote: null, total: 3 }); });
    render(<PollWidget event={event} />);
    expect(screen.getByText("3 votes")).toBeTruthy();
    expect(fetchPollResponses).toHaveBeenCalledTimes(1);
  });
});

describe("PollWidget: a signer that does not answer", () => {
  const start = async () => {
    const sent = heldPublish();
    render(<PollWidget event={poll()} />);
    await ready();
    vi.useFakeTimers();
    fireEvent.click(option("Tabs"));
    return sent;
  };

  // A remote signer nobody approves. The poll stayed dead for good.
  it("gives up after twenty seconds, says so, and can be voted on again", async () => {
    await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(19999); });
    expect(option("Tabs").getAttribute("aria-busy")).toBe("true");
    expect(toasts()).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(toasts().map((t) => [t.type, t.message])).toEqual([["error", "Couldn't send your vote: no answer after 20 seconds. Your vote was not counted."]]);
    expect(option("Tabs").getAttribute("aria-busy")).toBeNull();
    expect(option("Spaces").getAttribute("aria-disabled")).toBeNull();

    vi.mocked(publishPollResponse).mockReset().mockResolvedValue(undefined as never);
    fireEvent.click(option("Spaces"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTitle("Your vote")).toBeTruthy();
    expect(option("Spaces").textContent).toContain("100%");
  });

  // Approved late: the relays have the vote, so the poll must not go on offering it.
  it("shows the vote after all when it goes out late", async () => {
    const sent = await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(screen.queryByTitle("Your vote")).toBeNull();
    await act(async () => { sent.finish(); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTitle("Your vote")).toBeTruthy();
    expect(option("Tabs").textContent).toContain("100%");
  });

  it("does not replace a vote counted meanwhile with the late one", async () => {
    const sent = await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    vi.mocked(publishPollResponse).mockResolvedValue(undefined as never);
    fireEvent.click(option("Spaces"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(option("Spaces").textContent).toContain("100%");
    await act(async () => { sent.finish(); await vi.advanceTimersByTimeAsync(0); });
    expect(option("Spaces").textContent).toContain("100%");
    expect(screen.getByText("1 vote")).toBeTruthy();
  });

  // The other order: the first vote is given up on, a second is cast, and
  // the first goes out before the second does. The relays count the one
  // cast last, so that is the one to end up showing.
  it("ends on the vote cast last when the one given up on goes out first", async () => {
    const first = await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    const second = heldPublish();
    fireEvent.click(option("Spaces"));
    await act(async () => { first.finish(); await vi.advanceTimersByTimeAsync(0); });
    expect(option("Tabs").textContent).toContain("100%"); // it went out: shown for now
    await act(async () => { second.finish(); await vi.advanceTimersByTimeAsync(0); });
    expect(option("Spaces").textContent).toContain("100%");
    expect(option("Tabs").textContent).toContain("0%");
    expect(screen.getByText("1 vote")).toBeTruthy();
  });

  it("says nothing more when the late vote fails too", async () => {
    const sent = await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    await act(async () => { sent.fail(NO_RELAYS); await vi.advanceTimersByTimeAsync(0); });
    expect(toasts()).toHaveLength(1);
    expect(screen.queryByTitle("Your vote")).toBeNull();
  });

  it("leaves no clock running once a vote has gone out", async () => {
    const sent = await start();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { sent.finish(); await vi.advanceTimersByTimeAsync(0); });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("PollWidget: whose vote", () => {
  // The signature is the account's that pressed. Shown under the next
  // account it would be a vote that account never cast.
  it("does not show the vote as the next account's when the account changes on the way", async () => {
    const sent = heldPublish();
    render(<PollWidget event={poll()} />);
    await ready();
    fireEvent.click(option("Tabs"));
    setCurrentAccount("someone-else");
    await act(async () => { sent.finish(); });
    expect(screen.queryByTitle("Your vote")).toBeNull();
    expect(option("Tabs").getAttribute("aria-busy")).toBeNull();
  });

  // "Your vote was not counted." of a vote the account now signed in never cast.
  it("does not tell the next account that the vote failed", async () => {
    const sent = heldPublish();
    render(<PollWidget event={poll()} />);
    await ready();
    fireEvent.click(option("Tabs"));
    setCurrentAccount("someone-else");
    await act(async () => { sent.fail(NO_RELAYS); });
    expect(toasts()).toEqual([]);
    expect(option("Tabs").getAttribute("aria-busy")).toBeNull();
  });
});

describe("PollWidget: a note that is not a poll yet", () => {
  // A hook below the early return threw "rendered more hooks" the first time
  // the same card went from a note with no options to one with some.
  it("draws nothing without options, and the poll once it has some, without crashing", async () => {
    const empty = { id: "poll-late", pubkey: "author", kind: 1068, content: "?", tags: [] } as unknown as NDKEvent;
    const view = render(<PollWidget event={empty} />);
    expect(view.container.textContent).toBe("");
    const filled = { ...empty, tags: [["option", "0", "Tabs"], ["option", "1", "Spaces"]] } as unknown as NDKEvent;
    view.rerender(<PollWidget event={filled} />);
    expect(option("Tabs")).toBeTruthy();
    view.rerender(<PollWidget event={empty} />);
    expect(view.container.textContent).toBe("");
  });
});
