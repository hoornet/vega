import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef, useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Dialog } from "./Dialog";

afterEach(() => { cleanup(); document.body.innerHTML = ""; });

const dialog = () => screen.getByRole("dialog");
const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
/** A press and a release, each on the element given: what a real click or a dragged selection produces. */
function press(down: Element, up: Element = down) {
  fireEvent.pointerDown(down);
  fireEvent.click(up);
}

describe("Dialog", () => {
  it("is a modal dialog named by its title", () => {
    render(<Dialog title="Quote note" onClose={() => {}}><p>body</p></Dialog>);
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Quote note" })).toBe(dialog());
    expect(screen.getByRole("heading", { name: "Quote note" })).toBeTruthy();
  });

  // Inside a feed row a fixed backdrop only covered that row.
  it("is rendered at the body, not where it was opened", () => {
    const { container } = render(<div data-testid="row"><Dialog title="Zap" onClose={() => {}}>x</Dialog></div>);
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(document.body.querySelector("[role=dialog]")).toBe(dialog());
  });

  it("shows a status line under the title when given one", () => {
    const { rerender } = render(<Dialog title="Zap" status="No wallet connected" onClose={() => {}}>x</Dialog>);
    expect(screen.getByText("No wallet connected")).toBeTruthy();
    for (const nothing of [false, "", null, undefined] as const) {
      rerender(<Dialog title="Zap" status={nothing} onClose={() => {}}>x</Dialog>);
      expect(screen.queryByText("No wallet connected")).toBeNull();
      // no empty line left behind under the title
      expect(screen.getByRole("heading").parentElement!.children.length).toBe(1);
    }
  });

  it("has a close button that says what it does", () => {
    const onClose = vi.fn();
    render(<Dialog title="Login" onClose={onClose}>x</Dialog>);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("Escape", () => {
    it("closes it from anywhere, not only from a text field", () => {
      const onClose = vi.fn();
      render(<Dialog title="Quote note" onClose={onClose}><button>Post</button></Dialog>);
      screen.getByRole("button", { name: "Post" }).focus();
      escape();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // The app-wide handler is on window. If Escape reached it, it went back a view as well.
    it("does not reach the rest of the app", () => {
      const app = vi.fn();
      window.addEventListener("keydown", app);
      render(<Dialog title="Help" onClose={() => {}}>x</Dialog>);
      escape();
      window.removeEventListener("keydown", app);
      expect(app).not.toHaveBeenCalled();
    });

    // Sign-in opens over the zap dialog. One press must close one of them: the one on top.
    it("closes only the dialog on top", () => {
      const under = vi.fn();
      const over = vi.fn();
      function Two() {
        const [top, setTop] = useState(true);
        return (
          <>
            <Dialog title="Zap" onClose={under}>x</Dialog>
            {top && <Dialog title="Login" onClose={() => { over(); setTop(false); }}>y</Dialog>}
          </>
        );
      }
      render(<Two />);
      escape();
      expect(over).toHaveBeenCalledTimes(1);
      expect(under).not.toHaveBeenCalled();
      escape();
      expect(under).toHaveBeenCalledTimes(1);
    });

    it("stops listening once it is gone", () => {
      const onClose = vi.fn();
      const { unmount } = render(<Dialog title="Help" onClose={onClose}>x</Dialog>);
      unmount();
      escape();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("calls the newest onClose it was given", () => {
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = render(<Dialog title="Help" onClose={first}>x</Dialog>);
      rerender(<Dialog title="Help" onClose={second}>x</Dialog>);
      escape();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe("the backdrop", () => {
    it("closes it on a press and release", () => {
      const onClose = vi.fn();
      render(<Dialog title="Help" onClose={onClose}>x</Dialog>);
      press(dialog());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not close it for a click inside", () => {
      const onClose = vi.fn();
      render(<Dialog title="Help" onClose={onClose}><p>body</p></Dialog>);
      press(screen.getByText("body"));
      expect(onClose).not.toHaveBeenCalled();
    });

    // Selecting the text in a field and letting go outside the panel ends as a click on the backdrop.
    it("does not close it when a drag that began inside ends on it", () => {
      const onClose = vi.fn();
      render(<Dialog title="Quote note" onClose={onClose}><textarea defaultValue="half a thought" /></Dialog>);
      press(screen.getByRole("textbox"), dialog());
      expect(onClose).not.toHaveBeenCalled();
      // and the next real press on the backdrop still works
      press(dialog());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // A backdrop click threw away a half-written quote without a word.
    it("can be told to hold on to what was typed", () => {
      const onClose = vi.fn();
      render(<Dialog title="Quote note" closeOnBackdrop={false} onClose={onClose}>x</Dialog>);
      press(dialog());
      expect(onClose).not.toHaveBeenCalled();
      escape();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("focus", () => {
    it("goes to the first field when it opens", () => {
      render(<Dialog title="Login" onClose={() => {}}><button>Help</button><input aria-label="Key" /><button>Log in</button></Dialog>);
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Key" }));
    });

    it("leaves it on a field that asked for it", () => {
      render(<Dialog title="Login" onClose={() => {}}><input aria-label="First" /><input aria-label="Second" autoFocus /></Dialog>);
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Second" }));
    });

    // Not the close button and not the main action: a stray Enter there would act.
    it("goes to the panel when there is no field", () => {
      render(<Dialog title="Help" onClose={() => {}}><button>Send 1000 sats</button></Dialog>);
      const active = document.activeElement as HTMLElement;
      expect(dialog().contains(active)).toBe(true);
      expect(active.tagName).toBe("DIV");
      expect(active.getAttribute("tabindex")).toBe("-1");
    });

    it("returns to where it was when the dialog closes", () => {
      function Opener() {
        const [open, setOpen] = useState(false);
        return (<><button onClick={() => setOpen(true)}>Zap</button>{open && <Dialog title="Zap" onClose={() => setOpen(false)}><input aria-label="Amount" /></Dialog>}</>);
      }
      render(<Opener />);
      const trigger = screen.getByRole("button", { name: "Zap" });
      trigger.focus();
      fireEvent.click(trigger);
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Amount" }));
      escape();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    // Opened from a menu item, which is gone by the time the dialog closes.
    it("returns to the element it was told to, when given one", () => {
      const menuButton = createRef<HTMLButtonElement>();
      function Opener() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button ref={menuButton}>Repost or quote</button>
            {!open && <button onClick={() => setOpen(true)}>Quote…</button>}
            {open && <Dialog title="Quote note" returnFocus={menuButton} onClose={() => setOpen(false)}>x</Dialog>}
          </>
        );
      }
      render(<Opener />);
      const item = screen.getByRole("button", { name: "Quote…" });
      item.focus();
      fireEvent.click(item);
      escape();
      expect(document.activeElement).toBe(menuButton.current);
    });

    it("does nothing when the opener is gone and no other was named", () => {
      function Opener() {
        const [open, setOpen] = useState(false);
        return (<>{!open && <button onClick={() => setOpen(true)}>Quote…</button>}{open && <Dialog title="Quote note" onClose={() => setOpen(false)}>x</Dialog>}</>);
      }
      render(<Opener />);
      const item = screen.getByRole("button", { name: "Quote…" });
      item.focus();
      fireEvent.click(item);
      expect(() => escape()).not.toThrow();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // Tab used to walk out of the dialog into the page behind it.
    it("stays inside: Tab from the last control goes to the first, and back", () => {
      render(<Dialog title="Login" onClose={() => {}}><input aria-label="Key" /><button>Log in</button></Dialog>);
      const close = screen.getByRole("button", { name: "Close" });
      const last = screen.getByRole("button", { name: "Log in" });
      last.focus();
      fireEvent.keyDown(last, { key: "Tab" });
      expect(document.activeElement).toBe(close);
      fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    it("lets Tab move normally between controls in the middle", () => {
      render(<Dialog title="Login" onClose={() => {}}><input aria-label="Key" /><button>Log in</button></Dialog>);
      const field = screen.getByRole("textbox", { name: "Key" });
      field.focus();
      const notPrevented = fireEvent.keyDown(field, { key: "Tab" });
      expect(notPrevented).toBe(true);
    });

    it("moves Shift+Tab from the panel itself to the last control", () => {
      render(<Dialog title="Help" onClose={() => {}}><button>Done</button></Dialog>);
      const panel = document.activeElement as HTMLElement;
      fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
    });
  });

  it("is narrower when small, and scrolls inside rather than off the window", () => {
    const { rerender } = render(<Dialog title="Zap" size="sm" onClose={() => {}}>x</Dialog>);
    const panel = () => dialog().firstElementChild as HTMLElement;
    expect(` ${panel().className} `).toContain(" max-w-xs ");
    // A share of the backdrop, never of the viewport: inside the text-size zoom, 85vh was 121% of the window.
    expect(` ${panel().className} `).toContain(" max-h-full ");
    expect(panel().className).not.toMatch(/\d+v[hw]/);
    expect(` ${panel().className} `).toContain(" overflow-y-auto ");
    rerender(<Dialog title="Zap" onClose={() => {}}>x</Dialog>);
    expect(` ${panel().className} `).toContain(" max-w-md ");
  });
});
