import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { usePopoverDismiss, type DismissReason } from "./usePopoverDismiss";

interface Spies {
  onClose: (reason: DismissReason) => void;
  onOutside: () => void;
  onInside: () => void;
  onDialog: () => void;
  onToast: () => void;
}

function Harness({ open, hidden, onClose, onOutside, onInside, onDialog, onToast }: Spies & { open: boolean; hidden?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  usePopoverDismiss(ref, open, onClose);
  return (
    <div>
      {/* Stands in for the note card under the popover. */}
      <button onClick={onOutside}>outside</button>
      <a href="https://example.com/">a link elsewhere</a>
      {/* The feed is hidden like this, not unmounted, when the view changes. */}
      <div style={hidden ? { display: "none" } : undefined}>
        <div ref={ref}>
          <button onClick={onInside}>inside</button>
        </div>
      </div>
      {/* Stands in for Help, opened with a shortcut while the popover is open. */}
      <div role="dialog">
        <button onClick={onDialog}>in the dialog</button>
      </div>
      {/* Stands in for the stack of toasts. */}
      <div data-toast-stack>
        <div data-toast="t1"><button onClick={onToast}>Undo</button></div>
      </div>
    </div>
  );
}

function setup(props: { open?: boolean; hidden?: boolean } = {}) {
  const spies = { onClose: vi.fn(), onOutside: vi.fn(), onInside: vi.fn(), onDialog: vi.fn(), onToast: vi.fn() };
  render(<Harness open={props.open ?? true} hidden={props.hidden} {...spies} />);
  return spies;
}

describe("usePopoverDismiss", () => {
  it("closes on a click outside, and that click does nothing else", () => {
    const s = setup();
    fireEvent.click(screen.getByText("outside"));
    expect(s.onClose).toHaveBeenCalledTimes(1);
    expect(s.onClose).toHaveBeenCalledWith("outside");
    // Before this, the dismissing click also opened the thread underneath.
    expect(s.onOutside).not.toHaveBeenCalled();
  });

  // App.tsx opens external links from a capture listener on `document` that is
  // registered at startup, long before any popover. A dismiss listener on
  // `document` ran after it: the menu closed and the browser opened.
  it("swallows the click ahead of capture listeners that were on document first", () => {
    const openLink = vi.fn();
    document.addEventListener("click", openLink, true);
    try {
      const s = setup();
      fireEvent.click(screen.getByText("a link elsewhere"));
      expect(s.onClose).toHaveBeenCalledTimes(1);
      expect(openLink).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", openLink, true);
    }
  });

  it("cancels the default action of the dismissing click", () => {
    setup();
    const notCancelled = fireEvent.click(screen.getByText("a link elsewhere"));
    expect(notCancelled).toBe(false);
  });

  it("leaves clicks inside alone", () => {
    const s = setup();
    fireEvent.click(screen.getByText("inside"));
    expect(s.onInside).toHaveBeenCalledTimes(1);
    expect(s.onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and says so", () => {
    const s = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(s.onClose).toHaveBeenCalledTimes(1);
    expect(s.onClose).toHaveBeenCalledWith("escape");
  });

  it("does not interfere while closed", () => {
    const s = setup({ open: false });
    fireEvent.click(screen.getByText("outside"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(s.onOutside).toHaveBeenCalledTimes(1);
    expect(s.onClose).not.toHaveBeenCalled();
  });

  // With a menu open, `?` opens Help. The first click in Help, including its
  // close button, used to be eaten by the menu underneath.
  it("closes without eating a click in a dialog opened over it", () => {
    const s = setup();
    fireEvent.click(screen.getByText("in the dialog"));
    expect(s.onClose).toHaveBeenCalledTimes(1);
    expect(s.onDialog).toHaveBeenCalledTimes(1);
  });

  // With the compose box's emoji picker open, `/` switches to Search. The feed
  // is hidden, not unmounted, so the picker's listener was still armed.
  it("closes without eating a click once its own view is hidden", () => {
    const s = setup({ hidden: true });
    fireEvent.click(screen.getByText("outside"));
    expect(s.onClose).toHaveBeenCalledTimes(1);
    expect(s.onOutside).toHaveBeenCalledTimes(1);
  });

  // A toast raised while a menu is open ("Muted …" as the menu closes is the
  // usual order, but a failure can arrive at any time). Its "Undo" took two
  // presses: the first only closed the menu.
  it("closes on a click on a toast, and lets that click through", () => {
    const s = setup();
    fireEvent.click(screen.getByText("Undo"));
    expect(s.onClose).toHaveBeenCalledWith("outside");
    expect(s.onToast).toHaveBeenCalledTimes(1);
  });
});
