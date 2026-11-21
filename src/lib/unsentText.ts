/**
 * Text typed in a view that would be lost if the view were left: a message, a reply, a comment,
 * profile changes. Those views are not kept mounted (`KEPT_VIEWS` in the ui store), and their
 * boxes hold the text in component state, so it goes when the view does.
 *
 * A request from outside Vega to open the compose box (`vega --compose`) shows the feed, and a
 * `nostr:` link opens a profile, a note or an article; either would leave the view. Both come
 * from another window, where nobody can see what is open here, so they wait while anything is
 * held (`launchCommands.ts`). The boxes say what they hold through `useUnsentText` (`src/hooks/`).
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

/** What is held, and what to do with it, for each kind of text. */
const HELD: Record<UnsentKind, [string, string]> = {
  message: ["Your message isn't sent yet", "Send or clear it first."],
  reply: ["Your reply isn't sent yet", "Send or clear it first."],
  comment: ["Your comment isn't sent yet", "Send or clear it first."],
  profile: ["Your profile changes aren't saved yet", "Save or cancel them first."],
};

/**
 * Why something from outside was not opened (`what`: "a new note" for `vega --compose`, "the link"
 * for a `nostr:` link), for the text held most recently; null when nothing is held.
 */
export function unsentTextNotice(what = "a new note"): string | null {
  let last: UnsentKind | null = null;
  for (const kind of held.values()) last = kind;
  if (!last) return null;
  const [state, step] = HELD[last];
  return `${state}, so Vega didn't open ${what}. ${step}`;
}
