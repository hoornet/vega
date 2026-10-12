import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import type { ThreadNode } from "../../lib/threadTree";

vi.mock("../../lib/nostr", () => ({ publishReply: vi.fn() }));
vi.mock("../../hooks/useProfile", () => ({ useProfile: () => ({ name: "Alice" }) }));
vi.mock("../../hooks/useAutoResize", () => ({ useAutoResize: () => () => {} }));
vi.mock("../shared/EmojiPicker", () => ({ EmojiPicker: () => null }));
vi.mock("../feed/NoteCard", () => ({
  NoteCard: ({ event, onReplyInThread }: { event: NDKEvent; onReplyInThread?: () => void }) => (
    <article>{event.content}<button onClick={onReplyInThread}>reply to this</button></article>
  ),
}));

import { ThreadNodeComponent } from "./ThreadNode";
import { publishReply } from "../../lib/nostr";
import { useToastStore } from "../../stores/toast";

const ROOT = { id: "root", content: "the note", created_at: 1000, kind: 1, pubkey: "author", tags: [] } as unknown as NDKEvent;
const REPLY = { id: "r1", content: "a reply", created_at: 1100, kind: 1, pubkey: "alice", tags: [["e", "root", "", "root"]] } as unknown as NDKEvent;
const node = { event: REPLY, children: [] } as unknown as ThreadNode;
const toasts = () => useToastStore.getState().toasts;
const onReplyPublished = vi.fn();
const box = () => screen.getByPlaceholderText("Write a reply…") as HTMLTextAreaElement;

const writeReply = async (text: string) => {
  render(<ThreadNodeComponent node={node} rootEvent={ROOT} onReplyPublished={onReplyPublished} mutedPubkeys={[]} contentMatchesMutedKeyword={() => false} />);
  fireEvent.click(screen.getByRole("button", { name: "reply to this" }));
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  await waitFor(() => expect(vi.mocked(publishReply)).toHaveBeenCalled());
};

beforeEach(() => {
  vi.mocked(publishReply).mockReset();
  onReplyPublished.mockClear();
  useToastStore.setState({ toasts: [] });
});
afterEach(cleanup);

describe("ThreadNode: replying to a reply", () => {
  // There was no catch: the button came back and nothing said the reply had not gone out.
  it("says so when the reply reached no relay, and keeps what was written", async () => {
    vi.mocked(publishReply).mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    await writeReply("my reply");
    await waitFor(() => expect(toasts()).toHaveLength(1));
    expect(toasts()[0].type).toBe("error");
    expect(toasts()[0].message).toContain("Your reply is still in the box.");
    expect(box().value).toBe("my reply");
    expect(onReplyPublished).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reply" }).getAttribute("aria-busy")).not.toBe("true");
  });

  it("hands the reply to the thread, and says nothing more, when it goes out", async () => {
    const mine = { id: "mine", content: "my reply", tags: [] } as unknown as NDKEvent;
    vi.mocked(publishReply).mockResolvedValue(mine);
    await writeReply("my reply");
    await waitFor(() => expect(onReplyPublished).toHaveBeenCalledWith(mine));
    expect(toasts()).toEqual([]);
    // To a reply, with the thread's root named as the root.
    expect(vi.mocked(publishReply)).toHaveBeenCalledWith("my reply", { id: "r1", pubkey: "alice" }, { id: "root", pubkey: "author" });
  });
});
