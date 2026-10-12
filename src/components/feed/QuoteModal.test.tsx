import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

const publishQuote = vi.fn();
vi.mock("../../lib/nostr", () => ({ publishQuote: (...args: unknown[]) => publishQuote(...args) }));
vi.mock("../../stores/user", () => ({ useCanSign: () => true }));
vi.mock("../shared/LoginModal", () => ({ LoginModal: () => null }));

import { QuoteModal } from "./QuoteModal";
import { useToastStore } from "../../stores/toast";
import { useUIStore } from "../../stores/ui";

const note = { id: "n1", pubkey: "p1", content: "the note being quoted" } as unknown as NDKEvent;
const onClose = vi.fn();
const open = () => render(<QuoteModal event={note} authorName="Alice" onClose={onClose} />);
const dialog = () => screen.getByRole("dialog", { name: "Quote note" });
const field = () => screen.getByPlaceholderText("Add your comment…") as HTMLTextAreaElement;
const pressBackdrop = () => { fireEvent.pointerDown(dialog()); fireEvent.click(dialog()); };

const POSTED = { id: "q1", pubkey: "me", content: "worth a read", kind: 1, tags: [] } as unknown as NDKEvent;
const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  vi.clearAllMocks();
  publishQuote.mockResolvedValue(POSTED);
  useToastStore.setState({ toasts: [] });
  useUIStore.setState({ currentView: "feed", selectedNote: null, viewStack: [] });
});
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

describe("QuoteModal", () => {
  it("opens with the text field ready to type in", () => {
    open();
    expect(document.activeElement).toBe(field());
  });

  // Escape used to work only while the text field had focus.
  it("closes on Escape from anywhere in it", () => {
    open();
    screen.getByRole("button", { name: "Close" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop press while nothing has been typed", () => {
    open();
    pressBackdrop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // A click on the backdrop threw away a half-written quote without a word.
  it("keeps a half-written quote when the backdrop is pressed", () => {
    open();
    fireEvent.change(field(), { target: { value: "this is worth reading because" } });
    pressBackdrop();
    expect(onClose).not.toHaveBeenCalled();
    expect(field().value).toBe("this is worth reading because");
  });

  it("does not count spaces as something typed", () => {
    open();
    fireEvent.change(field(), { target: { value: "   " } });
    pressBackdrop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("publishes on Ctrl+Enter and then closes", async () => {
    open();
    fireEvent.change(field(), { target: { value: "worth a read" } });
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(publishQuote).toHaveBeenCalledWith("worth a read", note);
  });

  // "Quote…" is a menu item, gone by the time this closes. The row names the button that opened the menu.
  it("returns focus to the element it was given", () => {
    const repost = createRef<HTMLButtonElement>();
    const { rerender } = render(<><button ref={repost}>Repost or quote</button><QuoteModal event={note} authorName="Alice" onClose={onClose} returnFocus={repost} /></>);
    expect(document.activeElement).toBe(field());
    rerender(<><button ref={repost}>Repost or quote</button></>);
    expect(document.activeElement).toBe(repost.current);
  });

  // It used to read "Failed to publish: Error: Not enough relays received the event (0 published, 1 required)".
  it("stays open and says why, in plain words, when publishing fails", async () => {
    publishQuote.mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    open();
    fireEvent.change(field(), { target: { value: "worth a read" } });
    fireEvent.click(screen.getByRole("button", { name: /Quote & post/ }));
    const said = await screen.findByText(/none of your relays accepted it/);
    expect(said.textContent).toContain("Your quote is still here.");
    expect(said.textContent).not.toContain("Error:");
    expect(onClose).not.toHaveBeenCalled();
    expect(field().value).toBe("worth a read");
    expect(toasts()).toEqual([]);
  });

  // The dialog closes and the feed looks as it did: nothing said the quote had gone out.
  it("says the quote was posted, and offers to open it", async () => {
    open();
    fireEvent.change(field(), { target: { value: "worth a read" } });
    fireEvent.click(screen.getByRole("button", { name: /Quote & post/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toasts().map((t) => [t.type, t.message, t.action?.label])).toEqual([["success", "Quote posted.", "View"]]);
    // Keyed by the note: a second quote is a second toast, and each View opens its own.
    expect(toasts()[0].key).toBe(`posted:${POSTED.id}`);
    toasts()[0].action!.run();
    expect(useUIStore.getState().currentView).toBe("thread");
    expect(useUIStore.getState().selectedNote).toBe(POSTED);
  });
});
