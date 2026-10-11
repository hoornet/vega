import { useEffect } from "react";

/**
 * Close something floating when Escape is pressed, and stop there.
 *
 * Listens on `document`, which runs before the app-wide shortcut handler on
 * `window`, and stops the event so one press closes one thing and never also
 * navigates. The zap dialog, the reaction picker, the note menu and the emoji
 * picker each ignored Escape before this; the image lightbox already worked
 * this way and is the pattern copied here.
 */
export function useEscapeToClose(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, enabled]);
}
