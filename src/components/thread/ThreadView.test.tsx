import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import type { ThreadNode } from "../../lib/threadTree";

vi.mock("../../lib/nostr", () => ({
  fetchNoteById: vi.fn().mockResolvedValue(null),
  fetchThreadEvents: vi.fn(),
  fetchAncestors: vi.fn().mockResolvedValue([]),
  publishReply: vi.fn(),
  ensureConnected: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../lib/feedDiagnostics", () => ({ logDiag: vi.fn() }));
const account = vi.hoisted(() => ({ canSign: false }));
vi.mock("../../stores/user", () => ({ useCanSign: () => account.canSign }));
vi.mock("../../stores/mute", () => ({ useMuteStore: () => ({ mutedPubkeys: [] as string[], contentMatchesMutedKeyword: () => false }) }));
vi.mock("../../hooks/useAutoResize", () => ({ useAutoResize: () => () => {} }));
vi.mock("./AncestorChain", () => ({ AncestorChain: () => null }));
vi.mock("./ThreadNode", () => ({ ThreadNodeComponent: ({ node }: { node: ThreadNode }) => <article>{node.event.content}</article> }));
vi.mock("../feed/NoteCard", () => ({
  NoteCard: ({ event, onReplyInThread }: { event: NDKEvent; onReplyInThread?: () => void }) => (
    <div><div data-testid="focused">{event.content}</div><button onClick={onReplyInThread}>reply to this</button></div>
  ),
}));
vi.mock("../shared/EmojiPicker", () => ({ EmojiPicker: () => null }));

import { ThreadView } from "./ThreadView";
import { useUIStore } from "../../stores/ui";
import { fetchThreadEvents, publishReply } from "../../lib/nostr";
import { useToastStore } from "../../stores/toast";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const ROOT = { id: "root", content: "the note", created_at: 1000, kind: 1, pubkey: "author", tags: [] } as unknown as NDKEvent;
const reply = (id: string) => ({ id, content: `reply ${id}`, created_at: 1100, kind: 1, pubkey: "someone", tags: [["e", "root", "", "root"]] }) as unknown as NDKEvent;
const answering = (events: NDKEvent[]) => async () => { recordFetchOutcome(true); return events; };
const timingOut = async () => { recordFetchOutcome(false); return [] as NDKEvent[]; };
const settled = () => waitFor(() => expect(screen.queryByRole("status")).toBeNull());
const EMPTY = "No replies yet.";

beforeEach(() => {
  account.canSign = false;
  vi.mocked(fetchThreadEvents).mockReset();
  vi.mocked(publishReply).mockReset();
  useToastStore.setState({ toasts: [] });
  useUIStore.setState({ selectedNote: ROOT });
});
afterEach(cleanup);

describe("ThreadView: the replies under a note", () => {
  it("shows the note at once and says the replies are loading", async () => {
    vi.mocked(fetchThreadEvents).mockImplementation(answering([reply("a")]));
    render(<ThreadView />);
    expect(screen.getByTestId("focused").textContent).toBe("the note");
    expect(screen.getByRole("status").textContent).toBe("Loading replies…");
    expect(screen.queryByText(EMPTY)).toBeNull();
    await settled();
    expect(screen.getByRole("article").textContent).toBe("reply a");
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("says there are none when a relay answered with none", async () => {
    vi.mocked(fetchThreadEvents).mockImplementation(answering([]));
    render(<ThreadView />);
    await settled();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The whole point: "No replies yet." was a guess.
  it("says the relays could not be reached when nobody answered, keeps the note, and asks again on Try again", async () => {
    vi.mocked(fetchThreadEvents).mockImplementationOnce(timingOut).mockImplementation(answering([reply("a")]));
    render(<ThreadView />);
    await settled();
    expect(screen.getByRole("alert").textContent).toContain("so replies can't be loaded");
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByTestId("focused").textContent).toBe("the note");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await settled();
    expect(screen.getByRole("article").textContent).toBe("reply a");
  });

  it("does not carry one thread's verdict over to the next", async () => {
    vi.mocked(fetchThreadEvents).mockImplementationOnce(timingOut).mockImplementation(answering([]));
    render(<ThreadView />);
    await settled();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await settled();
    expect(screen.getByText(EMPTY)).toBeTruthy();
  });
});

describe("ThreadView: replying to the note", () => {
  const toasts = () => useToastStore.getState().toasts;
  const writeReply = async (text: string) => {
    account.canSign = true;
    vi.mocked(fetchThreadEvents).mockImplementation(answering([]));
    render(<ThreadView />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "reply to this" }));
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(vi.mocked(publishReply)).toHaveBeenCalled());
  };

  // There was no catch: the button came back and nothing said the reply had not gone out.
  it("says so when the reply reached no relay, and keeps what was written", async () => {
    vi.mocked(publishReply).mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    await writeReply("my reply");
    await waitFor(() => expect(toasts()).toHaveLength(1));
    expect(toasts()[0].type).toBe("error");
    expect(toasts()[0].message).toContain("none of your relays accepted it");
    expect(toasts()[0].message).toContain("Your reply is still in the box.");
    expect((screen.getByPlaceholderText("Write a reply…") as HTMLTextAreaElement).value).toBe("my reply");
    expect(screen.getByRole("button", { name: "Reply" }).getAttribute("aria-busy")).not.toBe("true");
  });

  // The reply appears in the thread: that is the confirmation.
  it("says nothing more when the reply goes out", async () => {
    vi.mocked(publishReply).mockResolvedValue(reply("mine"));
    await writeReply("my reply");
    expect(await screen.findByText("reply mine")).toBeTruthy();
    expect(toasts()).toEqual([]);
  });

  // The list of replies was asked for before the reply existed, so it does
  // not have it, and it replaces what is on screen. The reply went out,
  // showed, and vanished, and a second press sent it again.
  it("keeps a reply sent while the replies were still loading", async () => {
    account.canSign = true;
    let arrive: (events: NDKEvent[]) => void = () => {};
    vi.mocked(fetchThreadEvents).mockImplementation(() => new Promise((resolve) => { arrive = (events) => { recordFetchOutcome(true); resolve(events); }; }));
    vi.mocked(publishReply).mockResolvedValue(reply("mine"));
    render(<ThreadView />);
    fireEvent.click(await screen.findByRole("button", { name: "reply to this" }));
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "my reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("reply mine")).toBeTruthy();

    arrive([reply("theirs")]);
    expect(await screen.findByText("reply theirs")).toBeTruthy();
    expect(screen.getByText("reply mine")).toBeTruthy();
  });

  it("does not show it twice when the replies that arrive do have it", async () => {
    account.canSign = true;
    let arrive: (events: NDKEvent[]) => void = () => {};
    vi.mocked(fetchThreadEvents).mockImplementation(() => new Promise((resolve) => { arrive = (events) => { recordFetchOutcome(true); resolve(events); }; }));
    vi.mocked(publishReply).mockResolvedValue(reply("mine"));
    render(<ThreadView />);
    fireEvent.click(await screen.findByRole("button", { name: "reply to this" }));
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "my reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await screen.findByText("reply mine");
    arrive([reply("mine"), reply("theirs")]);
    await screen.findByText("reply theirs");
    expect(screen.getAllByText("reply mine")).toHaveLength(1);
  });

  // The other order: the list arrives while the reply is still on its way.
  // The thread was rebuilt from the tree of the moment Reply was pressed,
  // and every reply that had arrived since was taken off the screen.
  it("keeps the replies that arrived while a reply was on its way", async () => {
    account.canSign = true;
    let arrive: (events: NDKEvent[]) => void = () => {};
    vi.mocked(fetchThreadEvents).mockImplementation(() => new Promise((resolve) => { arrive = (events) => { recordFetchOutcome(true); resolve(events); }; }));
    let goOut: (event: NDKEvent) => void = () => {};
    vi.mocked(publishReply).mockImplementation(() => new Promise((resolve) => { goOut = resolve; }));
    render(<ThreadView />);
    fireEvent.click(await screen.findByRole("button", { name: "reply to this" }));
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "my reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    arrive([reply("theirs-1"), reply("theirs-2")]);
    await screen.findByText("reply theirs-2");
    goOut(reply("mine"));
    expect(await screen.findByText("reply mine")).toBeTruthy();
    expect(screen.getByText("reply theirs-1")).toBeTruthy();
    expect(screen.getByText("reply theirs-2")).toBeTruthy();
  });

  // Reply pressed, and another note opened before it went out. It is not that note's reply.
  it("does not put a reply under another note that was opened while it was on its way", async () => {
    account.canSign = true;
    vi.mocked(fetchThreadEvents).mockImplementation(answering([]));
    let goOut: (event: NDKEvent) => void = () => {};
    vi.mocked(publishReply).mockImplementation(() => new Promise((resolve) => { goOut = resolve; }));
    render(<ThreadView />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "reply to this" }));
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "my reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    const OTHER = { ...ROOT, id: "other-root", content: "another note" } as unknown as NDKEvent;
    let arrive: (events: NDKEvent[]) => void = () => {};
    vi.mocked(fetchThreadEvents).mockImplementation(() => new Promise((resolve) => { arrive = (events) => { recordFetchOutcome(true); resolve(events); }; }));
    useUIStore.setState({ selectedNote: OTHER });
    await screen.findByText("another note");
    goOut(reply("mine"));
    arrive([reply("theirs-other")]);
    await screen.findByText("reply theirs-other");
    expect(screen.queryByText("reply mine")).toBeNull();
  });

  // The replies of one note are not another's.
  it("does not carry a reply over to the next note opened", async () => {
    vi.mocked(publishReply).mockResolvedValue(reply("mine"));
    await writeReply("my reply");
    await screen.findByText("reply mine");
    const OTHER = { ...ROOT, id: "other-root", content: "another note" } as unknown as NDKEvent;
    vi.mocked(fetchThreadEvents).mockImplementation(answering([]));
    useUIStore.setState({ selectedNote: OTHER });
    await screen.findByText("another note");
    await settled();
    expect(screen.queryByText("reply mine")).toBeNull();
  });
});

// The guard sat above the hooks and called goBack during render: with the
// note taken away under the view (the stack cleared by sidebar navigation
// while a thread was still mounted), React rendered fewer hooks than before
// and the error boundary replaced the whole app.
describe("ThreadView: with no note to show", () => {
  it("goes back, from an effect, without rendering fewer hooks than before", async () => {
    vi.mocked(fetchThreadEvents).mockResolvedValue([]);
    const { rerender } = render(<ThreadView />);
    expect(await screen.findByText(ROOT.content)).toBeTruthy();
    useUIStore.setState({ viewStack: [{ view: "feed", selectedNote: null, selectedPubkey: null }] as never, currentView: "thread" });
    expect(() => { act(() => { useUIStore.setState({ selectedNote: null }); }); rerender(<ThreadView />); }).not.toThrow();
    expect(useUIStore.getState().currentView).toBe("feed");
    expect(screen.queryByText(ROOT.content)).toBeNull();
  });
});
