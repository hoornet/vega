import { describe, it, expect } from "vitest";
import { escapeAction, shortcutBlocked } from "./escapeKey";

const base = { showDebugPanel: false, showHelp: false, dialogOpen: false, stackDepth: 0 };

describe("escapeAction", () => {
  it("closes the debug panel before anything else", () => {
    expect(escapeAction({ ...base, showDebugPanel: true, showHelp: true, stackDepth: 3 })).toBe("close-debug-panel");
  });

  it("closes Help without also going back", () => {
    expect(escapeAction({ ...base, showHelp: true, stackDepth: 3 })).toBe("close-help");
  });

  it("leaves the page alone while a dialog is open", () => {
    expect(escapeAction({ ...base, dialogOpen: true, stackDepth: 3 })).toBe("nothing");
  });

  it("goes back when there is somewhere to go back to", () => {
    expect(escapeAction({ ...base, stackDepth: 1 })).toBe("back");
  });

  it("does nothing on a top-level view", () => {
    expect(escapeAction(base)).toBe("nothing");
  });
});

describe("shortcutBlocked", () => {
  // With the zap dialog up and focus on a button, `n` switched to the feed
  // behind it, `/` to search, and `?` opened Help on top.
  it("blocks every app-wide shortcut while a dialog is open", () => {
    for (const key of ["n", "/", "?", "j", "k"]) expect(shortcutBlocked(key, true), key).toBe(true);
  });

  it("blocks nothing when no dialog is open", () => {
    for (const key of ["n", "/", "?", "j", "k", "Escape"]) expect(shortcutBlocked(key, false), key).toBe(false);
  });

  // Escape still reaches escapeAction, which answers "nothing" for an open dialog.
  it("lets Escape through to its own rule", () => {
    expect(shortcutBlocked("Escape", true)).toBe(false);
    expect(escapeAction({ showDebugPanel: false, showHelp: false, dialogOpen: true, stackDepth: 3 })).toBe("nothing");
  });
});

describe("escapeAction, when more than one thing is open", () => {
  // Help mounts from a lazy chunk. Until it has, this handler is what closes it.
  it("closes Help before it considers a dialog or going back", () => {
    expect(escapeAction({ showDebugPanel: false, showHelp: true, dialogOpen: true, stackDepth: 2 })).toBe("close-help");
  });

  it("closes the debug panel before anything else", () => {
    expect(escapeAction({ showDebugPanel: true, showHelp: true, dialogOpen: true, stackDepth: 2 })).toBe("close-debug-panel");
  });
});
