import { describe, it, expect, vi, afterEach } from "vitest";
import { useState, createRef, type RefObject } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useModal } from "./useModal";

afterEach(() => { cleanup(); document.body.innerHTML = ""; });

function Modal({ name, onClose, returnFocus, children }: { name: string; onClose: () => void; returnFocus?: RefObject<HTMLElement | null>; children?: React.ReactNode }) {
  const { container } = useModal(onClose, { returnFocus });
  return <div ref={container} tabIndex={-1} role="dialog" aria-label={name}>{children}</div>;
}
const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

describe("useModal", () => {
  // The reason the opener is read during render: a field with autoFocus has
  // focus before any effect runs, and the opener would be forgotten.
  it("remembers the opener even when a field inside takes focus at once", () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (<><button onClick={() => setOpen(true)}>Login</button>{open && <Modal name="Login" onClose={() => setOpen(false)}><input aria-label="Key" autoFocus /></Modal>}</>);
    }
    render(<Opener />);
    const trigger = screen.getByRole("button", { name: "Login" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Key" }));
    escape();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes the one on top, then the one under it", () => {
    const closed: string[] = [];
    function Two() {
      const [zap, setZap] = useState(true);
      const [login, setLogin] = useState(true);
      return (<>{zap && <Modal name="Zap" onClose={() => { closed.push("zap"); setZap(false); }} />}{login && <Modal name="Login" onClose={() => { closed.push("login"); setLogin(false); }} />}</>);
    }
    render(<Two />);
    escape();
    escape();
    expect(closed).toEqual(["login", "zap"]);
  });

  // Signing in from inside the zap dialog: the lower dialog can also go first.
  it("still answers Escape after the modal under it has gone", () => {
    const closeOver = vi.fn();
    function Two({ under }: { under: boolean }) {
      return (<>{under && <Modal name="Under" onClose={() => {}} />}<Modal name="Over" onClose={closeOver} /></>);
    }
    const { rerender } = render(<Two under />);
    rerender(<Two under={false} />);
    escape();
    expect(closeOver).toHaveBeenCalledTimes(1);
  });

  // The "Sign in" button is gone once signed in. Focus must not land on the page behind the zap dialog.
  it("hands focus to the modal underneath when the opener is gone", () => {
    function Stack() {
      const [signedIn, setSignedIn] = useState(false);
      const [login, setLogin] = useState(false);
      return (
        <>
          <button>Settings</button>
          <Modal name="Zap" onClose={() => {}}>
            {!signedIn && <button onClick={() => setLogin(true)}>Sign in</button>}
          </Modal>
          {login && <Modal name="Login" onClose={() => setLogin(false)}><button onClick={() => { setSignedIn(true); setLogin(false); }}>Log in</button></Modal>}
        </>
      );
    }
    render(<Stack />);
    const signIn = screen.getByRole("button", { name: "Sign in" });
    signIn.focus();
    fireEvent.click(signIn);
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.queryByRole("dialog", { name: "Login" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Zap" }));
  });

  it("prefers the element it was told to return to", () => {
    const arrow = createRef<HTMLButtonElement>();
    function Menu() {
      const [open, setOpen] = useState(false);
      return (<><button ref={arrow}>Switch account</button>{!open && <button onClick={() => setOpen(true)}>Add account</button>}{open && <Modal name="Login" returnFocus={arrow} onClose={() => setOpen(false)} />}</>);
    }
    render(<Menu />);
    const item = screen.getByRole("button", { name: "Add account" });
    item.focus();
    fireEvent.click(item);
    escape();
    expect(document.activeElement).toBe(arrow.current);
  });

  it("keeps Tab inside even when focus has fallen to the page", () => {
    render(<><button>Settings</button><Modal name="Zap" onClose={() => {}}><button>Close</button><button>Try again</button></Modal></>);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("lets Tab go where it likes once it is closed", () => {
    const { unmount } = render(<Modal name="Zap" onClose={() => {}}><button>Close</button></Modal>);
    unmount();
    const notPrevented = fireEvent.keyDown(document.body, { key: "Tab" });
    expect(notPrevented).toBe(true);
  });
});
