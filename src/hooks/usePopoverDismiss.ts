import { useCallback, useEffect, type RefObject } from "react";
import { useEscapeToClose } from "./useEscapeToClose";

export type DismissReason = "escape" | "outside";

/**
 * Close a popover or menu on Escape or on a click outside it, and swallow that
 * outside click so it does nothing else.
 *
 * `ref` wraps the trigger *and* the floating part, so pressing the trigger
 * again is "inside" and toggles normally.
 *
 * Why not a transparent full-screen backdrop, as these popovers used before:
 * inside a feed row a `position: fixed` backdrop only covers that row (the row
 * is transformed; see BodyPortal), so a click anywhere else never reached it.
 * And where it did work, the click that closed the picker carried on to the
 * note card underneath and opened the thread.
 *
 * The listener is on `window` in the capture phase. `document` is not early
 * enough: App.tsx has its own capture listener there that opens external
 * links, it was registered first, and `stopPropagation` does not stop other
 * listeners on the same node. On `document`, clicking away onto a link closed
 * the menu *and* opened the browser.
 *
 * Three cases close without swallowing, because the click belongs to
 * something that appeared after the popover opened: the popover's view was
 * hidden (the feed is hidden, not unmounted, when a shortcut changes view), a
 * dialog was opened over it from the keyboard, or the click is on a toast,
 * whose "Undo" would otherwise take two presses.
 */
export function usePopoverDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: (reason: DismissReason) => void,
): void {
  const onEscape = useCallback(() => onClose("escape"), [onClose]);
  useEscapeToClose(onEscape, open);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const el = ref.current;
      const target = e.target instanceof Element ? e.target : null;
      if (el && target && el.contains(target)) return;
      const dialog = target?.closest("[role='dialog']");
      const overlaid = !!dialog && !(el && dialog.contains(el));
      const onToast = !!target?.closest("[data-toast-stack]");
      if (!el || overlaid || onToast || isHidden(el)) {
        onClose("outside");
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      onClose("outside");
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [ref, open, onClose]);
}

/** True when the element or an ancestor is `display: none`. */
function isHidden(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return true;
  }
  return false;
}
