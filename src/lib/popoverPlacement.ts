// Where a small popover opens relative to its trigger.
//
// The popovers under a note (repost menu, reaction picker, More) are absolutely
// positioned next to their trigger, inside a scrolling list. Opening upward
// keeps them off the note below, but the first note in a list has no room above
// and the menu was cut off by the top of the scroll area, with half its items
// unreachable. So the side is chosen from the room that is actually there.

export type Side = "up" | "down";

export interface Room {
  /** Free layout px between the scroll area's top edge and the trigger's top. */
  above: number;
  /** Free layout px between the trigger's bottom and the scroll area's bottom. */
  below: number;
  /** Free layout px from the trigger's left edge to the scroll area's right edge. */
  right: number;
}

/**
 * Measure the room around a trigger, in layout px.
 *
 * The scroll area is the nearest `.overflow-y-auto` ancestor, else the window.
 * Text size is a CSS zoom on the window's root box, and engines disagree on whether
 * `getBoundingClientRect` reports zoomed or unzoomed boxes, so the factor is
 * measured from the trigger itself (rendered height over layout height)
 * instead of assumed. Only differences between rects are used, never a rect
 * against a pointer position, for the same reason.
 */
export function measureRoom(trigger: HTMLElement): Room {
  const rect = trigger.getBoundingClientRect();
  const scroller = trigger.closest(".overflow-y-auto");
  const bounds = scroller
    ? scroller.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight, right: window.innerWidth };
  const scale = trigger.offsetHeight > 0 && rect.height > 0 ? rect.height / trigger.offsetHeight : 1;
  return {
    above: (rect.top - bounds.top) / scale,
    below: (bounds.bottom - rect.bottom) / scale,
    right: (bounds.right - rect.left) / scale,
  };
}

/** Upward when it fits, downward when only that fits, otherwise the roomier side. */
export function pickSide(room: Pick<Room, "above" | "below">, need: number): Side {
  if (room.above >= need) return "up";
  if (room.below >= need) return "down";
  return room.above >= room.below ? "up" : "down";
}
