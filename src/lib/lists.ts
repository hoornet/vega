// Pure rules for a NIP-51 list the user owns: the mute list (kind 10000) and
// the bookmark list (kind 10003). They are replaceable events, like the
// contact list, and were open to the same accident (see `contacts.ts`): a
// list built from what this device held, published whole over a longer one
// elsewhere, with `content` (where other clients keep the private items)
// written empty every time. The rules:
//
//   1. A change is recorded as *which* entry was added or removed here, and
//      applied to the newest list the relays hold at the time it goes out.
//      Everything else in that list, tags of other kinds and the content,
//      survives.
//   2. Nothing is published while the relays' list is not known. "They have
//      none" and "they did not all answer" are different results.
//
// Nothing here touches the network.

import type { ContactListSnapshot } from "./contacts";

/** The parts of a list event that matter for editing it; the shape the contact list uses. */
export type ListSnapshot = ContactListSnapshot;

/** The entries of one tag kind, in list order, without duplicates. */
export function tagValues(tags: string[][], name: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (t[0] !== name || !t[1] || seen.has(t[1])) continue;
    seen.add(t[1]);
    out.push(t[1]);
  }
  return out;
}

/** This device's say on a list, per tag kind: entries it added, entries it removed, not yet on the relays. */
export type ListChanges = Record<string, { add: string[]; remove: string[] }>;

export function noChanges(): ListChanges {
  return {};
}

export function hasChanges(changes: ListChanges): boolean {
  return Object.values(changes).some((c) => c.add.length > 0 || c.remove.length > 0);
}

/** `changes` with one entry added or removed here; the opposite record for the same entry is dropped. */
export function recordChange(changes: ListChanges, tag: string, change: { add: string } | { remove: string }): ListChanges {
  const prev = changes[tag] ?? { add: [], remove: [] };
  const next = "add" in change
    ? { add: prev.add.includes(change.add) ? prev.add : [...prev.add, change.add], remove: prev.remove.filter((v) => v !== change.add) }
    : { add: prev.add.filter((v) => v !== change.remove), remove: prev.remove.includes(change.remove) ? prev.remove : [...prev.remove, change.remove] };
  return { ...changes, [tag]: next };
}

/**
 * The tags for the next list: `base` with this device's changes applied.
 * Removed entries go, added ones come at the end, and every other tag is
 * carried over untouched and in order.
 */
export function withListChanges(base: string[][], changes: ListChanges): string[][] {
  let tags = base.map((t) => [...t]);
  for (const [name, { add, remove }] of Object.entries(changes)) {
    const gone = new Set(remove);
    tags = tags.filter((t) => !(t[0] === name && gone.has(t[1])));
    const have = new Set(tagValues(tags, name));
    for (const v of add) if (!have.has(v)) { tags.push([name, v]); have.add(v); }
  }
  return tags;
}

/** A stored record of changes, read strictly: anything odd is no record. */
export function parseStoredChanges(raw: string | null): ListChanges {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const out: ListChanges = {};
    for (const [name, c] of Object.entries(v as Record<string, unknown>)) {
      if (typeof c !== "object" || c === null) continue;
      const { add, remove } = c as Record<string, unknown>;
      const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
      out[name] = { add: strings(add), remove: strings(remove) };
    }
    return out;
  } catch {
    return {};
  }
}
