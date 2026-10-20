// Telling a click from a drag.
//
// A note card opens its thread on click. Selecting some of its text is also a
// mousedown and a mouseup inside the card, so the browser reports a click when
// the selection ends, and the thread opened under the user's selection.
//
// The obvious test, "is there a selection?", is wrong: a selection outlives
// the gesture that made it. Everything outside note text is `user-select:
// none`, and clicking unselectable chrome does not clear a selection, so every
// card would ignore clicks until the user happened to click on text. Distance
// travelled belongs to the gesture itself and has no such memory.

export interface Point {
  x: number;
  y: number;
}

/** Pointer travel, in px, beyond which a press-and-release is a drag. */
export const DRAG_SLOP = 5;

export function isDrag(press: Point | null, release: Point, slop = DRAG_SLOP): boolean {
  if (!press) return false;
  return Math.hypot(release.x - press.x, release.y - press.y) > slop;
}

// Doing something after the pointer is released.
//
// A click is a mousedown and a mouseup on the same element. A layout change
// between the two moves what is under the pointer, and the mouseup lands
// elsewhere: no click. The compose box collapsed on blur, which the mousedown
// of a click below it caused, so the first click on the "start here" card or
// on the first note did nothing while the box had focus. Anything that
// changes layout in answer to a blur waits for the release.

let held = false;
const waiting: (() => void)[] = [];

function release(): void {
  held = false;
  const fns = waiting.splice(0);
  for (const f of fns) f();
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => { held = true; }, true);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  // A release that never arrives (a native drag or context menu took it, the
  // window lost focus mid-press) would otherwise hold every later blur until
  // the next click.
  window.addEventListener("blur", release);
  window.addEventListener("dragend", release, true);
  window.addEventListener("pointermove", (e) => { if (held && e.buttons === 0) release(); }, true);
}

/** Run `fn` now, or once the pointer button that is down has been released. */
export function afterPointerRelease(fn: () => void): void {
  if (held) waiting.push(fn);
  else fn();
}
