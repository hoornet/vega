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

  // Its place in the order is where it opened. A new onClose on a later
  // render must not lift it above something that opened after it.
  it("does not jump the queue when its handler changes", () => {
    const menuV1 = vi.fn();
    const menuV2 = vi.fn();
    const dialog = vi.fn();
    function Two({ handler }: { handler: () => void }) {
      return (<><Popover onClose={handler} /><Popover onClose={dialog} /></>);
    }
    const { rerender } = render(<Two handler={menuV1} />);
    rerender(<Two handler={menuV2} />);
    pressEscape();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(menuV1).not.toHaveBeenCalled();
    expect(menuV2).not.toHaveBeenCalled();
  });

  it("calls the newest handler it was given", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Popover onClose={first} />);
    rerender(<Popover onClose={second} />);
    pressEscape();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
