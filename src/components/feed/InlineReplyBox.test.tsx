import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("../../lib/nostr", () => ({ publishReply: vi.fn() }));
vi.mock("../../lib/upload", () => ({ uploadImage: vi.fn(), uploadBytes: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));
vi.mock("../shared/EmojiPicker", () => ({ EmojiPicker: () => null }));
vi.mock("../../hooks/useAutoResize", () => ({ useAutoResize: () => () => {} }));
vi.mock("../../hooks/useReplyCount", () => ({ useReplyCount: () => [0, () => {}] }));
vi.mock("../../stores/user", () => ({ useCanSign: () => true, useUserStore: (pick: (s: { follows: string[]; pubkey: null }) => unknown) => pick({ follows: [], pubkey: null }) }));

import { InlineReplyBox } from "./InlineReplyBox";
import { publishReply } from "../../lib/nostr";
import { hasUnsentText } from "../../lib/unsentText";
import { InHomeFeed } from "../../hooks/useUnsentText";

const NOTE = { id: "note", pubkey: "author", content: "hello", kind: 1, tags: [] } as unknown as NDKEvent;
const box = () => screen.getByPlaceholderText("Reply to Alice…") as HTMLTextAreaElement;

beforeEach(() => { vi.mocked(publishReply).mockReset(); });
afterEach(cleanup);

// A reply typed under a note on a profile or in a search went with the view when `vega --compose`
// showed the feed (Greptile on #185).
describe("InlineReplyBox: a reply being written", () => {
  it("holds vega --compose back until it is sent, cleared, or the box goes", async () => {
    vi.mocked(publishReply).mockResolvedValue({} as NDKEvent);
    const { unmount } = render(<InlineReplyBox event={NOTE} name="Alice" />);
    expect(hasUnsentText()).toBe(false);
    fireEvent.change(box(), { target: { value: "half a thought" } });
    expect(hasUnsentText()).toBe(true);
    fireEvent.change(box(), { target: { value: "   " } });
    expect(hasUnsentText()).toBe(false);
    fireEvent.change(box(), { target: { value: "my reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(box().value).toBe(""));
    expect(hasUnsentText()).toBe(false);
    fireEvent.change(box(), { target: { value: "another" } });
    expect(hasUnsentText()).toBe(true);
    unmount();
    expect(hasUnsentText()).toBe(false);
  });

  it("holds nothing under a note in the home feed, which the command shows and never unmounts", () => {
    render(<InHomeFeed.Provider value={true}><InlineReplyBox event={NOTE} name="Alice" /></InHomeFeed.Provider>);
    fireEvent.change(box(), { target: { value: "half a thought" } });
    expect(hasUnsentText()).toBe(false);
  });
});

describe("InlineReplyBox: a reply that did not go out", () => {
  // It used to read "Failed: Error: Not enough relays received the event (0 published, 1 required)".
  it("says why in plain language, and keeps what was written", async () => {
    vi.mocked(publishReply).mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    render(<InlineReplyBox event={NOTE} name="Alice" />);
    fireEvent.change(box(), { target: { value: "my reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const said = await screen.findByText(/none of your relays accepted it/);
    expect(said.textContent).toContain("Your reply is still here.");
    expect(said.textContent).not.toContain("Error:");
    expect(box().value).toBe("my reply");
  });

  it("clears the message when the next try works", async () => {
    vi.mocked(publishReply).mockRejectedValueOnce(new Error("boom")).mockResolvedValue({} as NDKEvent);
    render(<InlineReplyBox event={NOTE} name="Alice" />);
    fireEvent.change(box(), { target: { value: "my reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await screen.findByText(/Couldn't publish/);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(screen.queryByText(/Couldn't publish/)).toBeNull());
    expect(box().value).toBe("");
  });
});
