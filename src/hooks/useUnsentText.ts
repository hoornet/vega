import { useEffect } from "react";
import { holdUnsentText, type UnsentKind } from "../lib/unsentText";

/**
 * For a box whose text would be lost if its view were left (`src/lib/unsentText.ts`). Pass the
 * text, or for a form whether anything in it has changed. Text that is only spaces is not held.
 */
export function useUnsentText(text: string | boolean, kind: UnsentKind): void {
  const holds = typeof text === "string" ? text.trim() !== "" : text;
  useEffect(() => (holds ? holdUnsentText(kind) : undefined), [holds, kind]);
}
