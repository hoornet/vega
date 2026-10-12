// Everything that floats over the page, in the order it opened: menus,
// popovers, tooltips, dialogs, the image viewer. Escape and Tab are decided
// here, for all of them, by one listener.
//
// Why one list. Each floating thing used to add its own keydown listener to
// `document`. Listeners on one node run in the order they were added, and the
// first to act stops the rest, so Escape closed whatever had opened *first*:
// with a note's menu open and Help opened over it from the keyboard, Escape
// closed the menu underneath and left Help up. Dialogs then got a list of
// their own, which fixed two dialogs and nothing else.
//
//   - Escape goes to the newest layer, and no further. One press closes one
//     thing and never also navigates.
//   - Tab stays inside the newest modal layer, wherever focus is. A trap that
//     listens on the dialog itself does nothing once focus has fallen to
//     <body>, which happens whenever the focused control unmounts.

export interface Layer {
  /** Called when Escape is pressed while this is the newest layer. */
  onEscape: () => void;
  /** Present on a modal layer: the element Tab must not leave. A popover leaves Tab alone. */
  trap?: () => HTMLElement | null;
}

const layers: Layer[] = [];
let listening = false;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** The places Tab stops inside `el`, in order. */
export function tabStops(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => {
    // A roving tab stop (a tab that is not the selected one) is focusable but Tab skips it.
    if (node.tabIndex < 0) return false;
    // Not laid out: `display: none` on it or an ancestor. Where the engine cannot say, assume visible.
    return typeof node.checkVisibility === "function" ? node.checkVisibility() : true;
  });
}

/** The element Tab is confined to right now, if a modal layer is open. */
export function trapElement(): HTMLElement | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const el = layers[i].trap?.();
    if (el) return el;
  }
  return null;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    const top = layers[layers.length - 1];
    // Escape also cancels an input method's conversion. That press is not ours.
    if (!top || e.isComposing || e.keyCode === 229) return;
    e.stopImmediatePropagation();
    top.onEscape();
    return;
  }
  if (e.key !== "Tab") return;
  const el = trapElement();
  if (!el) return;
  const stops = tabStops(el);
  if (stops.length === 0) { e.preventDefault(); el.focus(); return; }
  const first = stops[0];
  const last = stops[stops.length - 1];
  const active = document.activeElement;
  const inside = active instanceof Node && el.contains(active);
  const leaving = e.shiftKey ? active === first || active === el : active === last;
  if (!inside || leaving) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

/** Add a layer on top. Returns the function that takes it away again. */
export function pushLayer(layer: Layer): () => void {
  layers.push(layer);
  if (!listening) {
    // `document`, bubble phase: before the app-wide shortcut handler on `window`.
    document.addEventListener("keydown", onKeyDown);
    listening = true;
  }
  return () => {
    const at = layers.indexOf(layer);
    if (at !== -1) layers.splice(at, 1);
  };
}
