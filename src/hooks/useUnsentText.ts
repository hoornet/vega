import { createContext, useContext, useEffect } from "react";
import { holdUnsentText, type UnsentKind } from "../lib/unsentText";

/**
 * Set by the home feed (`Feed.tsx`). A box in the feed holds nothing: the feed is the view `vega --compose`
 * shows, and it is hidden, never unmounted, while another view is open, so what is written there stays.
 * Held, a reply typed in the feed once would also block the command from every other view, where nobody
 * can see it.
 */
export const InHomeFeed = createContext(false);

/**
 * For a box whose text would be lost if its view were left (`src/lib/unsentText.ts`). Pass the
 * text, or for a form whether anything in it has changed. Text that is only spaces is not held.
 */
export function useUnsentText(text: string | boolean, kind: UnsentKind): void {
  const inHomeFeed = useContext(InHomeFeed);
  const holds = !inHomeFeed && (typeof text === "string" ? text.trim() !== "" : text);
  useEffect(() => (holds ? holdUnsentText(kind) : undefined), [holds, kind]);
}
