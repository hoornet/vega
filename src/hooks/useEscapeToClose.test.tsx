import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useEscapeToClose } from "./useEscapeToClose";

function Popover({ onClose, enabled }: { onClose: () => void; enabled?: boolean }) {
  useEscapeToClose(onClose, enabled);
  return null;
}

const pressEscape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

describe("useEscapeToClose", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Popover onClose={onClose} />);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The app-wide shortcut handler listens on window. If the event reached it,
  // one Escape would close the popover and also navigate back.
  it("stops the event before the app-wide handler on window sees it", () => {
    const appHandler = vi.fn();
    window.addEventListener("keydown", appHandler);
    render(<Popover onClose={vi.fn()} />);
    pressEscape();
    window.removeEventListener("keydown", appHandler);
    expect(appHandler).not.toHaveBeenCalled();
  });

  it("ignores other keys and lets them through", () => {
    const onClose = vi.fn();
    const appHandler = vi.fn();
    window.addEventListener("keydown", appHandler);
    render(<Popover onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    window.removeEventListener("keydown", appHandler);
    expect(onClose).not.toHaveBeenCalled();
    expect(appHandler).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled, and stops listening when unmounted", () => {
    const onClose = vi.fn();
    const closed = render(<Popover onClose={onClose} enabled={false} />);
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    closed.unmount();

    const open = render(<Popover onClose={onClose} />);
    open.unmount();
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });
});
