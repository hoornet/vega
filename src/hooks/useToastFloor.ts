import { useEffect, useRef, type RefObject } from "react";

/** The custom property the toast stack adds to its distance from the bottom of the window. */
export const TOAST_FLOOR = "--toast-floor";

/**
 * Keep the toast stack off a bar pinned to the bottom of a view.
 *
 * Toasts are drawn in the bottom right corner of the window. So is the Send
 * button in Messages, and a relay's sign-in warning, raised by opening
 * Messages, sat on it for twelve seconds, or for as long as the pointer
 * rested there, because a pointer over a toast holds it.
 *
 * Put the returned ref on the bar. Its height is published as `--toast-floor`
 * and the stack starts above it. The height changes (the message box grows as
 * it is typed in), so it is watched, and the property is taken away when the
 * bar unmounts.
 *
 * The number is the bar's layout height, not a measured rectangle: the bar
 * and the stack are under the same text-size zoom, so layout units on one
 * side are layout units on the other, whatever the engine says a rectangle
 * is. One bar at a time. The podcast player bar has its own rule in the
 * stack's classes, because it never changes height; it is under the same zoom.
 */
export function useToastFloor<T extends HTMLElement>(): RefObject<T | null> {
  const bar = useRef<T | null>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(TOAST_FLOOR, `${el.offsetHeight}px`);
    publish();
    // Not in every test environment; where it is missing the first reading stands.
    const watcher = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    watcher?.observe(el);
    return () => {
      watcher?.disconnect();
      root.style.removeProperty(TOAST_FLOOR);
    };
  }, []);
  return bar;
}
