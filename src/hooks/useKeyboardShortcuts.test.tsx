import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

const ui = {
  currentView: "feed",
  showHelp: false,
  showDebugPanel: false,
  viewStack: [] as unknown[],
  setView: vi.fn(),
  goBack: vi.fn(),
  toggleHelp: vi.fn(),
  toggleDebugPanel: vi.fn(),
};
const feed = { focusedNoteIndex: 0, setFocusedNoteIndex: vi.fn(), notes: [1, 2, 3] };
vi.mock("../stores/ui", () => ({ useUIStore: Object.assign(() => ui, { getState: () => ui }) }));
vi.mock("../stores/feed", () => ({ useFeedStore: () => feed }));

import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

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
