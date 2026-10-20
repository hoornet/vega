import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("../../lib/nostr", () => ({ publishNote: vi.fn(), publishPoll: vi.fn() }));
vi.mock("../../lib/upload", () => ({ uploadImage: vi.fn(), uploadBytes: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));
vi.mock("../poll/PollCompose", () => ({ PollCompose: () => null }));
vi.mock("../shared/EmojiPicker", () => ({ EmojiPicker: () => null }));
vi.mock("../../hooks/useAutoResize", () => ({ useAutoResize: () => () => {} }));
vi.mock("../../stores/user", () => ({ useUserStore: () => ({ profile: null, npub: "npub1me" }), useCanSign: () => true }));
const feed = vi.hoisted(() => ({ notes: [] as unknown[] }));
vi.mock("../../stores/feed", () => ({ useFeedStore: { getState: () => feed, setState: (patch: { notes: unknown[] }) => { feed.notes = patch.notes; } } }));

import { ComposeBox } from "./ComposeBox";
import { publishNote } from "../../lib/nostr";
import { useToastStore } from "../../stores/toast";
import { useUIStore } from "../../stores/ui";

const POSTED = { id: "new-note", content: "hello nostr", kind: 1, pubkey: "me", tags: [] } as unknown as NDKEvent;
const toasts = () => useToastStore.getState().toasts;
const box = () => screen.getByPlaceholderText("What's on your mind?") as HTMLTextAreaElement;
const post = async (text = "hello nostr") => {
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Post" }));
  await waitFor(() => expect(vi.mocked(publishNote)).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Post" }).getAttribute("aria-busy")).not.toBe("true"));
};

beforeEach(() => {
  localStorage.clear();
  feed.notes = [];
  vi.mocked(publishNote).mockReset().mockResolvedValue(POSTED);
  useToastStore.setState({ toasts: [] });
  useUIStore.setState({ currentView: "feed", selectedNote: null, viewStack: [] });
});
afterEach(cleanup);

describe("ComposeBox: saying that a note was posted", () => {
  // Trending is ranked, not newest first. The box emptied and nothing else changed.
  it("says so, and offers to open the note, where the list on screen will not show it", async () => {
    render(<ComposeBox confirmPosted />);
    await post();
    expect(box().value).toBe("");
    expect(toasts().map((t) => [t.type, t.message, t.action?.label])).toEqual([["success", "Posted.", "View"]]);
    toasts()[0].action!.run();
    expect(useUIStore.getState().currentView).toBe("thread");
    expect(useUIStore.getState().selectedNote).toBe(POSTED);
  });

  // On Following and Global the note appears at the top of the list: that is the confirmation.
  it("says nothing where the note appears in the list", async () => {
    const onNoteInjected = vi.fn();
    render(<ComposeBox onNoteInjected={onNoteInjected} />);
    await post();
    expect(onNoteInjected).toHaveBeenCalledWith(POSTED);
    expect(toasts()).toEqual([]);
  });

  // A tab's own filters can hide the note: one that starts with "[", a muted
  // word, the script filter. The tab is asked about the note that was posted.
  it("asks about the note it posted, and says so when the answer is yes", async () => {
    const hidden = vi.fn(() => true);
    render(<ComposeBox confirmPosted={hidden} />);
    await post();
    expect(hidden).toHaveBeenCalledWith(POSTED);
    expect(toasts().map((t) => t.message)).toEqual(["Posted."]);
  });

  it("says nothing when the tab says the note will show", async () => {
    render(<ComposeBox confirmPosted={() => false} />);
    await post();
    expect(toasts()).toEqual([]);
  });

  it("does not say it was posted when it was not", async () => {
    vi.mocked(publishNote).mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    render(<ComposeBox confirmPosted />);
    await post("still here");
    expect(toasts()).toEqual([]);
    // In the box's own words, in plain language, with the text kept.
    expect(screen.getByText(/none of your relays accepted it/).textContent).toContain("Your note is still here.");
    expect(screen.queryByText(/Error:/)).toBeNull();
    expect(box().value).toBe("still here");
  });
});

describe("ComposeBox: asked for from an empty view", () => {
  it("takes focus when the request count goes up, and not on mount", () => {
    useUIStore.setState({ composeRequest: 3 });
    render(<ComposeBox />);
    expect(document.activeElement).not.toBe(box());
    act(() => useUIStore.getState().requestCompose());
    expect(document.activeElement).toBe(box());
    // Asked again later, after the user has gone elsewhere.
    act(() => box().blur());
    expect(document.activeElement).not.toBe(box());
    act(() => useUIStore.getState().requestCompose());
    expect(document.activeElement).toBe(box());
  });
});
