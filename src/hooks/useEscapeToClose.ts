import { useEffect, useRef } from "react";
import { pushLayer } from "../lib/layers";

/**
 * Close something floating when Escape is pressed, and stop there.
 *
 * The press goes to whatever opened last (see `lib/layers.ts`) and is stopped
 * before the app-wide shortcut handler on `window` sees it, so one press
 * closes one thing and never also navigates. The zap dialog, the reaction
 * picker, the note menu and the emoji picker each ignored Escape before this.
 *
 * The layer is added when `enabled` becomes true and stays where it is until
 * it becomes false: a new `onClose` on a later render must not move this
 * above something that opened after it.
 */
export function useEscapeToClose(onClose: () => void, enabled = true): void {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    return pushLayer({ onEscape: () => latest.current() });
  }, [enabled]);
}
