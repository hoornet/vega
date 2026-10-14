import NDK, { NDKEvent, NDKFilter, NDKKind, NDKRelay } from "@nostr-dev-kit/ndk";
import { getNDK, fetchFromRelay, isLocalRelayUrl, publishToNetwork } from "./core";
import { newerContactList, summarizeContactAnswers, type ContactListResult, type ContactListSnapshot, type RelayContactAnswer } from "../contacts";

// Reading and publishing a replaceable list the user owns (kind 3, 10000,
// 10003), each relay on its own. One fetch over several relays is cut short
// by NDK's early EOSE quorum, and a list held only by the slowest relay then
// reads as no list at all; see `fetchFromRelay` and the contact list section
// of CLAUDE.md. `fetchContactList` is this with kind 3.

export const LIST_TIMEOUT = 6000;

/**
 * The relays worth asking right now: every connected one, after giving the pool
 * a moment to finish connecting.
 *
 * Login asks for the contact list before the first socket is open, so "whoever
 * is connected this instant" would be nobody. This waits until at least one
 * remote relay is up, then a short settle period for the rest, so a relay that
 * is merely a little slower to connect is still asked. A relay that never
 * connects is left out: it cannot answer, and counting its silence would mean
 * one dead relay in someone's list stops them ever following anyone.
 */
export async function relaysToAsk(instance: NDK, maxWaitMs = 5000, settleMs = 1200): Promise<NDKRelay[]> {
  const started = Date.now();
  let firstRemoteUpAt: number | null = null;
  for (;;) {
    const all = Array.from(instance.pool?.relays?.values() ?? []);
    const up = all.filter((r) => r.connected);
    if (up.some((r) => !isLocalRelayUrl(r.url))) {
      firstRemoteUpAt ??= Date.now();
      if (up.length === all.length || Date.now() - firstRemoteUpAt >= settleMs) return up;
    }
    if (Date.now() - started >= maxWaitMs) return up;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}


export type ListResult = ContactListResult;

/**
 * Ask every connected relay for `pubkey`'s list of `kind`, and say what came
 * back: the newest list, proof of none, or "could not tell". `onFound` fires
 * as a list turns up (and again for a newer one); the promise settles when
 * every relay has answered or timed out, which is what a publish needs.
 */
export async function fetchReplaceableList(
  kind: number,
  pubkey: string,
  opts: { timeoutMs?: number; onFound?: (list: ContactListSnapshot) => void } = {},
): Promise<ListResult> {
  const instance = getNDK();
  const relays = await relaysToAsk(instance);
  if (relays.length === 0) return { status: "unknown" };

  const filter: NDKFilter = { kinds: [kind as NDKKind], authors: [pubkey] };
  let newest: ContactListSnapshot | null = null;

  const answers = await Promise.all(
    relays.map(async (relay): Promise<RelayContactAnswer> => {
      const { events, answered } = await fetchFromRelay(instance, relay, filter, opts.timeoutMs ?? LIST_TIMEOUT);
      const lists = events
        .filter((e) => e.kind === kind && e.pubkey === pubkey)
        .map((e): ContactListSnapshot => ({ tags: e.tags, content: e.content ?? "", createdAt: e.created_at ?? 0 }));
      for (const list of lists) {
        const next = newerContactList(newest, list);
        if (next !== newest) {
          newest = next;
          opts.onFound?.(list);
        }
      }
      return { lists, answered, local: isLocalRelayUrl(relay.url) };
    }),
  );

  return summarizeContactAnswers(answers);
}

/**
 * Publish a list the caller built from the newest known one (`withListChanges`),
 * tags and content complete. Never from a bare array of entries: that shape
 * is what made the wipe possible. False when there is no key to sign with:
 * nothing was published, and nothing failed.
 */
export async function publishReplaceableList(kind: number, tags: string[][], content: string): Promise<boolean> {
  const instance = getNDK();
  if (!instance.signer) return false;
  const event = new NDKEvent(instance);
  event.kind = kind as NDKKind;
  event.content = content;
  event.tags = tags;
  await publishToNetwork(event);
  return true;
}
