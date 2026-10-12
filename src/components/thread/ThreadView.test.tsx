import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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
});
