import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Render a dialog at `document.body` instead of where it was opened.
 *
 * Feed rows are positioned with a CSS transform (the virtual list), and a
 * transformed element becomes the containing block for `position: fixed`
 * descendants. A dialog mounted inside a row was therefore "fixed" to that
 * row: its backdrop dimmed one note, it was centred on that note, and it
 * scrolled away with the feed.
 *
 * The wrapper carries the text-size zoom, which lives on <main> and would
 * otherwise be lost on the way out.
 *
 * React events still bubble from a portal to its React ancestors. Components
 * that treat a click anywhere inside them as navigation (the note card) must
 * check that the click really landed inside their own DOM; see NoteCard.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  return createPortal(<div style={{ zoom: "var(--ui-zoom, 1)" }}>{children}</div>, document.body);
}
