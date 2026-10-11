// Pure rules for the NIP-02 contact list (kind 3).
//
// Why this exists: until v0.15.9 a Follow click published a brand-new kind 3
// built from whatever the app happened to have in memory. If the list had not
// loaded — and with NDK's early end-of-stored-events quorum it often had not,
// see `fetchContactList` in nostr/social.ts — that meant replacing a list of
// 131 people with a list of one. The rules here are what make that impossible:
//
//   1. "The relays have no list for you" and "the relays did not all answer"
//      are different results. Only the first allows starting a new list.
//   2. A change is applied to the newest list we know, tag by tag, so relay
//      hints, petnames, non-`p` tags and the legacy relay JSON in `content`
//      survive a follow or unfollow.
//
// Nothing here touches NDK or the network, so every rule is unit-tested.

/** The parts of a kind 3 event that matter for editing it. */
export interface ContactListSnapshot {
  tags: string[][];
  content: string;
  createdAt: number;
}

export type ContactListResult =
  /** The newest contact list any relay returned. */
  | { status: "found"; list: ContactListSnapshot }
  /** Every relay we asked answered, and none has a contact list for this key. */
  | { status: "none" }
  /** At least one relay never answered and none returned a list: we cannot say. */
  | { status: "unknown" };

/** What one relay did with our request for the contact list. */
export interface RelayContactAnswer {
  lists: ContactListSnapshot[];
  /** True if the relay finished its answer (EOSE) before the timeout. */
  answered: boolean;
  /** The embedded relay: its copy counts, its silence proves nothing. */
  local: boolean;
}

/** Followed pubkeys in list order, without duplicates. */
export function contactPubkeys(tags: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (t[0] !== "p" || !t[1] || seen.has(t[1])) continue;
    seen.add(t[1]);
    out.push(t[1]);
  }
  return out;
}

/** The later of two snapshots; either may be missing. */
export function newerContactList(
  a: ContactListSnapshot | null,
  b: ContactListSnapshot | null,
): ContactListSnapshot | null {
  if (!a) return b;
  if (!b) return a;
  return b.createdAt > a.createdAt ? b : a;
}

/**
 * Turn per-relay answers into one verdict.
 *
 * A list from anywhere, the embedded relay included, is a list. Absence is only
 * believed when every *remote* relay finished answering: the embedded relay
 * answers instantly even with the network gone, so it cannot vouch that the
 * user has no list, and neither can a set of relays where one stayed silent.
 */
export function summarizeContactAnswers(answers: RelayContactAnswer[]): ContactListResult {
  let newest: ContactListSnapshot | null = null;
  for (const a of answers) for (const l of a.lists) newest = newerContactList(newest, l);
  if (newest) return { status: "found", list: newest };

  const remote = answers.filter((a) => !a.local);
  if (remote.length > 0 && remote.every((a) => a.answered)) return { status: "none" };
  return { status: "unknown" };
}

/**
 * The tags for the next contact list: `base` with one person added or removed.
 * Everything else is carried over untouched and in order.
 */
export function nextContactTags(
  base: string[][],
  change: { add: string } | { remove: string },
): string[][] {
  if ("add" in change) {
    if (base.some((t) => t[0] === "p" && t[1] === change.add)) return base.map((t) => [...t]);
    return [...base.map((t) => [...t]), ["p", change.add]];
  }
  return base.filter((t) => !(t[0] === "p" && t[1] === change.remove)).map((t) => [...t]);
}

/**
 * Read a contact list this device saved earlier. Anything that is not exactly
 * the expected shape is ignored: a corrupt cache must degrade to "no cache",
 * never to an empty list that could be published.
 */
export function parseStoredContactList(raw: string | null): ContactListSnapshot | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { tags, content, createdAt } = v as Record<string, unknown>;
    if (!Array.isArray(tags) || typeof content !== "string" || typeof createdAt !== "number") return null;
    if (!tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))) return null;
    return { tags: tags as string[][], content, createdAt };
  } catch {
    return null;
  }
}

