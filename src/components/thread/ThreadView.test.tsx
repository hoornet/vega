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
vi.mock("../../stores/user", () => ({ useCanSign: () => false }));
vi.mock("../../stores/mute", () => ({ useMuteStore: () => ({ mutedPubkeys: [] as string[], contentMatchesMutedKeyword: () => false }) }));
vi.mock("../../hooks/useAutoResize", () => ({ useAutoResize: () => () => {} }));
vi.mock("./AncestorChain", () => ({ AncestorChain: () => null }));
vi.mock("./ThreadNode", () => ({ ThreadNodeComponent: ({ node }: { node: ThreadNode }) => <article>{node.event.content}</article> }));
vi.mock("../feed/NoteCard", () => ({ NoteCard: ({ event }: { event: NDKEvent }) => <div data-testid="focused">{event.content}</div> }));
vi.mock("../shared/EmojiPicker", () => ({ EmojiPicker: () => null }));

import { ThreadView } from "./ThreadView";
import { useUIStore } from "../../stores/ui";
import { fetchThreadEvents } from "../../lib/nostr";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const ROOT = { id: "root", content: "the note", created_at: 1000, kind: 1, pubkey: "author", tags: [] } as unknown as NDKEvent;
const reply = (id: string) => ({ id, content: `reply ${id}`, created_at: 1100, kind: 1, pubkey: "someone", tags: [["e", "root", "", "root"]] }) as unknown as NDKEvent;
const answering = (events: NDKEvent[]) => async () => { recordFetchOutcome(true); return events; };
const timingOut = async () => { recordFetchOutcome(false); return [] as NDKEvent[]; };
const settled = () => waitFor(() => expect(screen.queryByRole("status")).toBeNull());
const EMPTY = "No replies yet.";

beforeEach(() => {
  vi.mocked(fetchThreadEvents).mockReset();
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
