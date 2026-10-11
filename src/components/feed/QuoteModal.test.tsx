import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

const publishQuote = vi.fn();
vi.mock("../../lib/nostr", () => ({ publishQuote: (...args: unknown[]) => publishQuote(...args) }));
vi.mock("../../stores/user", () => ({ useCanSign: () => true }));
vi.mock("../shared/LoginModal", () => ({ LoginModal: () => null }));

import { QuoteModal } from "./QuoteModal";

const note = { id: "n1", pubkey: "p1", content: "the note being quoted" } as unknown as NDKEvent;
const onClose = vi.fn();
const open = () => render(<QuoteModal event={note} authorName="Alice" onClose={onClose} />);
const dialog = () => screen.getByRole("dialog", { name: "Quote note" });
const field = () => screen.getByPlaceholderText("Add your comment…") as HTMLTextAreaElement;
const pressBackdrop = () => { fireEvent.pointerDown(dialog()); fireEvent.click(dialog()); };

beforeEach(() => { vi.clearAllMocks(); publishQuote.mockResolvedValue(undefined); });
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

  it("stays open and says why when publishing fails", async () => {
    publishQuote.mockRejectedValue(new Error("no relay accepted it"));
    open();
    fireEvent.change(field(), { target: { value: "worth a read" } });
    fireEvent.click(screen.getByRole("button", { name: /Quote & post/ }));
    await waitFor(() => expect(screen.getByText(/Failed to publish/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(field().value).toBe("worth a read");
  });
});
