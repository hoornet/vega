import { useEffect, useRef, useState, type RefObject } from "react";
import { pushLayer, trapElement } from "../lib/layers";

// What every modal surface does with the keyboard, in one place: the dialogs
// (see Dialog) and the image viewer.
//
//   - Escape closes it, if it is on top (see `lib/layers.ts`).
//   - Focus moves in when it opens, cannot Tab out while it is open, and goes
//     back to where it was when it closes.

const FIELD = "input:not([disabled]), textarea:not([disabled]), select:not([disabled])";

interface ModalOptions {
  /**
   * Where focus goes when it closes, if not to whatever had it when it opened.
   * For a dialog opened from a menu item: the item is gone by then, so name the
   * button that opened the menu.
   */
  returnFocus?: RefObject<HTMLElement | null>;
}

/** Put `container` on the element that holds everything focusable, and give that element `tabIndex={-1}`. */
export function useModal<T extends HTMLElement = HTMLDivElement>(onClose: () => void, { returnFocus }: ModalOptions = {}) {
  const container = useRef<T>(null);
  // Read during the first render. By the time an effect runs, a field inside
  // may already have taken focus, and the opener would be forgotten.
  const [opener] = useState<Element | null>(() => document.activeElement);
  const latest = useRef({ onClose, returnFocus });
  latest.current = { onClose, returnFocus };

  useEffect(() => {
    const remove = pushLayer({ onEscape: () => latest.current.onClose(), trap: () => container.current });

    const el = container.current;
    // A field with autoFocus already has it. Otherwise the first field, so
    // typing works at once, and failing that the container itself: never the
    // close button or the main action, where a stray Enter would act.
    if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>(FIELD) ?? el).focus();

    return () => {
      remove();
      const back = latest.current.returnFocus?.current ?? (opener instanceof HTMLElement ? opener : null);
      if (back?.isConnected) back.focus();
      // The opener is gone (signing in from inside the zap dialog removes the
      // "Sign in" button). If a modal is still open under this one, focus goes
      // to it, not to the page behind it.
      else trapElement()?.focus();
    };
    // Once per modal: the handlers read `latest`.
  }, []);

  return { container };
}
