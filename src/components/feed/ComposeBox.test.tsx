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

// `vega --compose` on a cold start: the request comes before the box exists, which mounts only
// once the session is restored. A plain request from before the box is still not for it (above).
describe("ComposeBox: asked for from outside Vega", () => {
  it("takes a request that came before it mounted, once", () => {
    useUIStore.setState({ composeRequest: 0, composePendingUntil: 0 });
    useUIStore.getState().requestComposeWhenReady(60_000);
    const { unmount } = render(<ComposeBox />);
    expect(document.activeElement).toBe(box());
    act(() => box().blur());
    unmount();
    // A box mounted again later does not take the same request a second time.
    render(<ComposeBox />);
    expect(document.activeElement).not.toBe(box());
  });

  it("drops a waiting request when a dialog opened meanwhile", () => {
    useUIStore.setState({ composeRequest: 0, composePendingUntil: 0 });
    useUIStore.getState().requestComposeWhenReady(60_000);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    try {
      render(<ComposeBox />);
      expect(document.activeElement).not.toBe(box());
      expect(useUIStore.getState().composePendingUntil).toBe(0);
    } finally {
      dialog.remove();
    }
  });

  it("lets a request go once it has waited too long", () => {
    useUIStore.setState({ composeRequest: 5, composePendingUntil: Date.now() - 1 });
    render(<ComposeBox />);
    expect(document.activeElement).not.toBe(box());
    expect(useUIStore.getState().composePendingUntil).toBe(0);
  });

  it("is taken by a box already on screen, and not again by one mounted after", () => {
    useUIStore.setState({ composeRequest: 0, composePendingUntil: 0 });
    const first = render(<ComposeBox />);
    act(() => useUIStore.getState().requestComposeWhenReady(60_000));
    expect(useUIStore.getState().composePendingUntil).toBe(0);
    first.unmount();
    render(<ComposeBox />);
    expect(document.activeElement).not.toBe(box());
  });
});

// The mousedown of a click below the box blurred it; it collapsed; the mouseup
// landed two lines further up, on something else.
describe("ComposeBox: collapsing", () => {
  it("waits for the pointer to be released, and collapses at once on a keyboard blur", () => {
    render(<ComposeBox />);
    fireEvent.focus(box());
    expect(box().rows).toBe(3);
    window.dispatchEvent(new Event("pointerdown"));
    fireEvent.blur(box());
    expect(box().rows).toBe(3);
    act(() => { window.dispatchEvent(new Event("pointerup")); });
    expect(box().rows).toBe(1);
    fireEvent.focus(box());
    expect(box().rows).toBe(3);
    fireEvent.blur(box());
    expect(box().rows).toBe(1);
  });

  it("stays expanded when the click put focus back inside it", () => {
    render(<ComposeBox />);
    fireEvent.focus(box());
    window.dispatchEvent(new Event("pointerdown"));
    fireEvent.blur(box());
    box().focus();
    act(() => { window.dispatchEvent(new Event("pointerup")); });
    expect(box().rows).toBe(3);
  });
});

describe("ComposeBox: the first-run card", () => {
  it("has said hello once a note is posted, for an account with a card", async () => {
    const { useFirstRunStore } = await import("../../stores/firstRun");
    useFirstRunStore.setState({ accounts: ["me"], hello: [] });
    render(<ComposeBox />);
    await post();
    expect(useFirstRunStore.getState().hello).toEqual(["me"]);
  });
});
