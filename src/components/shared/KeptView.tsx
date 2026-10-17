import { useLayoutEffect, useRef, type ReactNode, type UIEvent } from "react";

/**
 * Keeps a view mounted while it is hidden, and brings its scroll back when it
 * is shown again.
 *
 * Only the feed used to stay mounted. Every other view unmounted the moment a
 * note, a profile or an article opened from it, so Back found a blank search
 * page, the top of Latest, the Notes tab. Hidden with `display: none`, like
 * the feed, which also takes it out of the Tab order and away from screen
 * readers; effects keep running.
 *
 * Browsers do not promise to keep a scroll position across `display: none`.
 * Each scroll inside is recorded as it happens (scroll does not bubble, but it
 * does capture) and put back in a layout effect when the view is shown, before
 * anything is painted. Hiding the view is itself a scroll to 0 in Chromium's
 * eyes: the offset is dropped with the box and a scroll event follows, a frame
 * after the class changed. Measured on a search page scrolled to 700: "scroll
 * event 700", hide, "scroll event 0". Recorded, that 0 was what came back. So
 * nothing is recorded while hidden, by this component's word or by anyone
 * else's: a Suspense boundary hides its children with an inline display: none
 * while a lazy view's code loads, before the prop says so.
 *
 * Best effort: the offset is a pixel value, not the row. A list that changed
 * while hidden (new notifications at the top, a reload) comes back near the
 * old place, not on the old row.
 */
export function KeptView({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<Element, number>());

  useLayoutEffect(() => {
    if (hidden) {
      // Focus left inside a hidden view keeps taking the keyboard in some engines: typing edits a field
      // nobody can see, and Escape goes to that field instead of going back.
      const active = document.activeElement;
      if (active instanceof HTMLElement && wrapper.current?.contains(active)) active.blur();
      return;
    }
    for (const [el, top] of positions.current) {
      if (!el.isConnected) positions.current.delete(el);
      else if (top > 0 && el.scrollTop !== top) el.scrollTop = top;
    }
  }, [hidden]);

  const record = (e: UIEvent) => {
    if (hidden) return;
    const el = e.target;
    if (!(el instanceof Element) || notShown(el, wrapper.current)) return;
    positions.current.set(el, el.scrollTop);
  };

  return (
    <div ref={wrapper} className={hidden ? "hidden" : "contents"} onScrollCapture={record}>
      {children}
    </div>
  );
}

/** Whether something between the element and the wrapper is display: none. */
function notShown(el: Element, wrapper: HTMLElement | null): boolean {
  for (let node: Element | null = el; node && node !== wrapper; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return true;
  }
  return false;
}
