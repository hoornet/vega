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

/**
 * What counts as "a dialog is open" for the two rules in this file: a modal
 * dialog, the image viewer, and a confirmation such as the one before an
 * account's key is deleted. With that question on screen and focus on Cancel,
 * `n` used to change the view behind it.
 */
export const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="alertdialog"]';

/**
 * Whether an app-wide shortcut must be ignored because a dialog is open.
 *
 * With the zap dialog up and focus on a button, `n` used to switch to the feed
 * behind it, `/` to search, and `?` opened Help on top. A dialog owns the
 * keyboard until it is closed. Escape is the one key still looked at, so that
 * `escapeAction` can decide it does nothing.
 */
export function shortcutBlocked(key: string, dialogOpen: boolean): boolean {
  return dialogOpen && key !== "Escape";
}
