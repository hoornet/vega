/**
 * Text typed in a view that would be lost if the view were left: a message, a reply, a comment,
 * profile changes. Those views are not kept mounted (`KEPT_VIEWS` in the ui store), and their
 * boxes hold the text in component state, so it goes when the view does.
 *
 * A request from outside Vega to open the compose box (`vega --compose`) shows the feed, which
 * would leave the view. It comes from another window, where nobody can see what is open here,
 * so it waits while anything is held (`launchCommands.ts`). The boxes say what they hold through
 * `useUnsentText` (`src/hooks/`).
 *
 * The `n` shortcut and the sidebar still leave such a view as they always have: both are pressed
 * inside the window, in front of the text.
 */

export type UnsentKind = "message" | "reply" | "comment" | "profile";

const held = new Map<symbol, UnsentKind>();

/** Says that a box holds unsent text; returns the function that lets go of it. */
export function holdUnsentText(kind: UnsentKind): () => void {
  const token = Symbol(kind);
  held.set(token, kind);
  return () => { held.delete(token); };
}

export function hasUnsentText(): boolean {
  return held.size > 0;
}

const NOTICE: Record<UnsentKind, string> = {
  message: "Your message isn't sent yet, so Vega didn't open a new note. Send or clear it first.",
  reply: "Your reply isn't sent yet, so Vega didn't open a new note. Send or clear it first.",
  comment: "Your comment isn't sent yet, so Vega didn't open a new note. Send or clear it first.",
  profile: "Your profile changes aren't saved yet, so Vega didn't open a new note. Save or cancel them first.",
};

/** Why a new note was not opened, for the text held most recently; null when nothing is held. */
export function unsentTextNotice(): string | null {
  let last: UnsentKind | null = null;
  for (const kind of held.values()) last = kind;
  return last ? NOTICE[last] : null;
}
