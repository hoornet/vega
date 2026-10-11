import { describe, it, expect } from "vitest";
import { escapeAction } from "./escapeKey";

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
