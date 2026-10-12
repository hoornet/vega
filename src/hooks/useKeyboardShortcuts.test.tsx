import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act, screen } from "@testing-library/react";

const ui = {
  currentView: "feed",
  showHelp: false,
  showDebugPanel: false,
  viewStack: [] as unknown[],
  setView: vi.fn(),
  goBack: vi.fn(),
  toggleHelp: vi.fn(),
  toggleDebugPanel: vi.fn(),
  requestCompose: vi.fn(),
};
const feed = { focusedNoteIndex: 0, setFocusedNoteIndex: vi.fn(), notes: [1, 2, 3] };
vi.mock("../stores/ui", () => ({ useUIStore: Object.assign(() => ui, { getState: () => ui }) }));
vi.mock("../stores/feed", () => ({ useFeedStore: () => feed }));

import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { ToastContainer } from "../components/shared/ToastContainer";
import { useToastStore } from "../stores/toast";

function App() { useKeyboardShortcuts(); return <button>somewhere</button>; }
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
function float(html: string) { const el = document.createElement("div"); el.innerHTML = html; document.body.appendChild(el); return el; }

beforeEach(() => { vi.clearAllMocks(); ui.viewStack = []; ui.showHelp = false; ui.showDebugPanel = false; });
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

describe("app-wide shortcuts", () => {
  it("run when nothing is in the way", () => {
    render(<App />);
    press("/");
    expect(ui.setView).toHaveBeenCalledWith("search");
    press("?");
    expect(ui.toggleHelp).toHaveBeenCalledTimes(1);
    press("j");
    expect(feed.setFocusedNoteIndex).toHaveBeenCalledWith(1);
  });

  // With the zap dialog up and focus on a button, `/` switched to search
  // behind it and `?` put Help on top of it.
  it("do nothing while a dialog is open", () => {
    render(<App />);
    float(`<div role="dialog" aria-modal="true"><button>Zap</button></div>`);
    for (const key of ["n", "/", "?", "j", "k"]) press(key);
    expect(ui.setView).not.toHaveBeenCalled();
    expect(ui.toggleHelp).not.toHaveBeenCalled();
    expect(feed.setFocusedNoteIndex).not.toHaveBeenCalled();
  });

  // The question before an account's key is deleted is not a dialog element, but it is a question.
  it("do nothing while a confirmation is open", () => {
    render(<App />);
    float(`<div role="alertdialog"><button>Cancel</button></div>`);
    press("n");
    press("?");
    expect(ui.setView).not.toHaveBeenCalled();
    expect(ui.toggleHelp).not.toHaveBeenCalled();
  });

  it("run again once it is gone", () => {
    render(<App />);
    const dialog = float(`<div role="dialog" aria-modal="true"></div>`);
    press("/");
    dialog.remove();
    press("/");
    expect(ui.setView).toHaveBeenCalledTimes(1);
  });

  it("n asks for the compose box the one way there is", () => {
    render(<App />);
    press("n");
    expect(ui.requestCompose).toHaveBeenCalledTimes(1);
    expect(ui.setView).not.toHaveBeenCalled();
  });

  it("leave typing alone", () => {
    render(<><App /><input aria-label="field" /></>);
    const field = document.querySelector("input")!;
    field.focus();
    press("/");
    press("n");
    expect(ui.setView).not.toHaveBeenCalled();
  });

  describe("Escape", () => {
    it("goes back when there is somewhere to go back to", () => {
      ui.viewStack = [{}];
      render(<App />);
      press("Escape");
      expect(ui.goBack).toHaveBeenCalledTimes(1);
    });

    it("does nothing from a top-level view", () => {
      render(<App />);
      press("Escape");
      expect(ui.goBack).not.toHaveBeenCalled();
    });

    // A dialog normally takes Escape before this handler sees it. If one ever
    // reaches here with a dialog open, it still must not navigate.
    it("never goes back behind a dialog", () => {
      ui.viewStack = [{}];
      render(<App />);
      float(`<div role="dialog" aria-modal="true"></div>`);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(ui.goBack).not.toHaveBeenCalled();
    });
  });
});

describe("F6: the newest message in the corner", () => {
  // Its "Undo" is behind every control on the page in Tab order, with a few seconds to get there.
  const stack = (toasts: string) => float(`<div data-toast-stack>${toasts}</div>`);
  const toast = (id: string, buttons: string) => `<div data-toast="${id}">${buttons}</div>`;

  it("moves focus to the newest toast's action", () => {
    render(<App />);
    stack(toast("old", `<button>Dismiss old</button>`) + toast("new", `<button>Undo</button><button>Dismiss</button>`));
    press("F6");
    expect(document.activeElement?.textContent).toBe("Undo");
  });

  it("goes to Dismiss when the newest toast has no action", () => {
    render(<App />);
    stack(toast("old", `<button>Undo</button><button>Dismiss old</button>`) + toast("new", `<button>Dismiss new</button>`));
    press("F6");
    expect(document.activeElement?.textContent).toBe("Dismiss new");
  });

  it("works from a text field", () => {
    render(<App />);
    stack(toast("new", `<button>Undo</button>`));
    const field = float(`<textarea></textarea>`).querySelector("textarea") as HTMLTextAreaElement;
    field.focus();
    press("F6");
    expect(document.activeElement?.textContent).toBe("Undo");
  });

  // A failure raised while a dialog is open: Tab is kept inside the dialog, so this is the way to it.
  it("works with a dialog open", () => {
    render(<App />);
    float(`<div role="dialog" aria-modal="true"><button>in the dialog</button></div>`);
    stack(toast("new", `<button>Try again</button>`));
    press("F6");
    expect(document.activeElement?.textContent).toBe("Try again");
  });

  it("does nothing, and leaves focus alone, when there is no toast", () => {
    render(<App />);
    const somewhere = document.querySelector("button") as HTMLButtonElement;
    somewhere.focus();
    press("F6");
    expect(document.activeElement).toBe(somewhere);
    expect(ui.setView).not.toHaveBeenCalled();
  });
});

// The tests above stand in for the stack with markup of their own. This one
// is the real thing: if the container's markup and the shortcut's selector
// drift apart, F6 does nothing and nothing else would say so.
describe("F6 and the real stack of toasts", () => {
  const add = (...args: Parameters<ReturnType<typeof useToastStore.getState>["addToast"]>) => act(() => useToastStore.getState().addToast(...args));
  beforeEach(() => { act(() => useToastStore.setState({ toasts: [] })); });

  it("goes to the action of the toast raised last, although that one is drawn on top", () => {
    render(<><App /><ToastContainer /></>);
    add("Couldn't repost.", "error", { key: "repost:a", action: { label: "Try again", run: () => {} } });
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    press("F6");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Undo" }));
  });

  it("goes to Dismiss when the newest has no action", () => {
    render(<><App /><ToastContainer /></>);
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    add("Link copied.", "success");
    press("F6");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Dismiss");
    expect(document.activeElement?.closest("[data-toast]")?.textContent).toContain("Link copied.");
  });

  // Reached with F6, the toast is held like any other with focus in it, and
  // Escape puts it away and gives focus back to where F6 was pressed.
  it("holds the toast it went to, and Escape there gives focus back without going anywhere", () => {
    vi.useFakeTimers();
    render(<><App /><ToastContainer /></>);
    const somewhere = screen.getByRole("button", { name: "somewhere" });
    act(() => { somewhere.focus(); });
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    press("F6");
    act(() => { vi.advanceTimersByTime(60000); });
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    press("Escape");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(document.activeElement).toBe(somewhere);
    expect(ui.goBack).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does nothing when the stack is there and empty", () => {
    render(<><App /><ToastContainer /></>);
    const somewhere = screen.getByRole("button", { name: "somewhere" });
    act(() => { somewhere.focus(); });
    press("F6");
    expect(document.activeElement).toBe(somewhere);
  });
});
