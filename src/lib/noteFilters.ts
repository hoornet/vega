/**
 * Content that is not a note for a person to read: a relay's or a bot's
 * payload posted as kind 1. The feed hides these; so does anything that picks
 * people from the feed's notes.
 */
export function looksLikePayload(content: string): boolean {
  const c = content.trim();
  if (!c || c.startsWith("{") || c.startsWith("[")) return true;
  // A base64 blob, or a relay protocol message.
  if (c.length > 500 && /^[A-Za-z0-9+/=]{50,}$/.test(c.slice(0, 100))) return true;
  if (c.startsWith("nlogpost:") || c.startsWith("T1772")) return true;
  return false;
}
