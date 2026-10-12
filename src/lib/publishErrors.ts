// Plain-language reason for a failed publish.
//
// NDK reports "Not enough relays received the event (0 published, 1 required)".
// That is accurate and unhelpful: the writer needs to know that nothing went
// out, that their work is still here, and what to check.

import { clipText, endSentence } from "./utils";

/** A relay's or a remote signer's own words can be any length. In a sentence of ours they get a limit. */
const MAX_DETAIL = 140;

/**
 * `kept` says what became of the work ("Your reply is still in the box.").
 * `verb` is what was being done, for where "publish" is the wrong word
 * (a message is sent).
 */
export function explainPublishError(err: unknown, kept: string, verb = "publish"): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/not enough relays/i.test(message)) {
    return `Couldn't ${verb}: none of your relays accepted it. ${kept} Check your relays and try again.`;
  }
  if (/not logged in|no signer/i.test(message)) {
    return `Couldn't ${verb}: you are not signed in with a key that can sign. ${kept}`;
  }
  const shown = clipText(message.trim(), MAX_DETAIL);
  return shown ? `Couldn't ${verb}: ${endSentence(shown)} ${kept}` : `Couldn't ${verb}. ${kept}`;
}
