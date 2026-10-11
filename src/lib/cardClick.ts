// Does a click inside a note card open that note's thread?
//
// The whole card is a click target, which is what makes its exceptions matter:
// every exception that was missing sent someone to the thread view when they
// meant something else. The rules live here, away from the component, so each
// one can be tested on its own.

import { isDrag, type Point } from "./pointer";

/** Things inside a card that take a click for themselves. */
const OWN_CLICK = "button, a, input, textarea, select, [role='dialog'], [role='menu'], [data-no-navigate]";

export interface CardClick {
  card: HTMLElement;
  target: EventTarget | null;
  /** Where the pointer went down, if that happened on this card. */
  press: Point | null;
  release: Point;
  /** The open thread is already about this note. */
  alreadyOpen: boolean;
}

export function opensThread({ card, target, press, release, alreadyOpen }: CardClick): boolean {
  if (!(target instanceof Element)) return false;
  // A dialog opened from this card is portaled to <body>, but React still
  // bubbles its clicks to the card. Clicking a label inside the zap dialog
  // must not open the thread behind it.
  if (!card.contains(target)) return false;
  // Anything interactive, anything floating, and the action area. The search
  // stops at the card: an ancestor *outside* it that happens to match (a card
  // shown inside a dialog) must not make every click on the card a no-op.
  const owner = target.closest(OWN_CLICK);
  if (owner && owner !== card && card.contains(owner)) return false;
  // Finishing a text selection is a drag, not a click on the note.
  if (isDrag(press, release)) return false;
  // Opening the thread that is already open only pushed a duplicate onto the
  // back stack, so Back appeared to do nothing once.
  if (alreadyOpen) return false;
  return true;
}
