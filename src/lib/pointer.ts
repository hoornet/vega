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
