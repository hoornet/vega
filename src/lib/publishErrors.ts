// Plain-language reason for a failed publish.
//
// NDK reports "Not enough relays received the event (0 published, 1 required)".
// That is accurate and unhelpful: the writer needs to know that nothing went
// out, that their work is still here, and what to check.

export function explainPublishError(err: unknown, kept: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/not enough relays/i.test(message)) {
    return `Couldn't publish: none of your relays accepted it. ${kept} Check your relays and try again.`;
  }
  if (/not logged in|no signer/i.test(message)) {
    return `Couldn't publish: you are not signed in with a key that can sign. ${kept}`;
  }
  return `Couldn't publish${message ? `: ${message.replace(/\.$/, "")}` : ""}. ${kept}`;
}
