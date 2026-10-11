import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmojiPicker } from "./EmojiPicker";

// The picker is mounted inside the note card (inline reply box), so the
// parent's onClick stands in for the card: a click reaching it opens a thread.
function renderPicker() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const onCardClick = vi.fn();
  render(
    <div onClick={onCardClick}>
      <button>elsewhere in the card</button>
      <div className="relative">
        <EmojiPicker onSelect={onSelect} onClose={onClose} />
      </div>
    </div>,
  );
  return { onSelect, onClose, onCardClick };
}

describe("EmojiPicker", () => {
  it("inserts the chosen emoji and closes", () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.click(screen.getByText("🔥"));
    expect(onSelect).toHaveBeenCalledWith("🔥");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open while switching groups", () => {
    const { onClose } = renderPicker();
    fireEvent.click(screen.getByText("Objects"));
    expect(screen.getByText("☕")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  // It used to rely on a `fixed inset-0` backdrop, which a transformed feed
  // row shrinks to the row itself: clicks anywhere else never closed it.
  it("closes on a click anywhere outside it, with no backdrop element to hit", () => {
    const { onClose } = renderPicker();
    expect(document.querySelector(".fixed")).toBeNull();
    fireEvent.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not pass the closing click on to the card behind it", () => {
    const { onClose, onCardClick } = renderPicker();
    fireEvent.click(screen.getByText("elsewhere in the card"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = renderPicker();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
