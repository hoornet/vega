// What the Escape key should do, decided in one place.
//
// It used to call goBack() unconditionally. That closed the Help modal *and*
// changed the view underneath it, navigated away while a dialog was open, and
// from a top-level screen such as Settings jumped to wherever the back stack
// last pointed, because sidebar navigation never cleared that stack.

export type EscapeAction = "close-debug-panel" | "close-help" | "back" | "nothing";

export function escapeAction(state: {
  showDebugPanel: boolean;
  showHelp: boolean;
  /** A modal dialog is on screen; it owns Escape, the page behind it does not. */
  dialogOpen: boolean;
  /** How many views there are to go back to. */
  stackDepth: number;
}): EscapeAction {
  if (state.showDebugPanel) return "close-debug-panel";
  if (state.showHelp) return "close-help";
  if (state.dialogOpen) return "nothing";
  return state.stackDepth > 0 ? "back" : "nothing";
}
