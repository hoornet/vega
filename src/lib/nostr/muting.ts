import { NDKEvent, NDKFilter, NDKKind } from "@nostr-dev-kit/ndk";
import { getNDK, fetchWithTimeout, SINGLE_TIMEOUT } from "./core";

export async function fetchMuteList(pubkey: string): Promise<string[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [10000 as NDKKind], authors: [pubkey], limit: 1 };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  if (events.size === 0) return [];
  const event = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  return event.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
}

/** Publishes the mute list. False when there is no key to sign with: nothing was published, and nothing failed. */
export async function publishMuteList(pubkeys: string[]): Promise<boolean> {
  const instance = getNDK();
  if (!instance.signer) return false;
  const event = new NDKEvent(instance);
  event.kind = 10000 as NDKKind;
  event.content = "";
  event.tags = pubkeys.map((pk) => ["p", pk]);
  await event.publish();
  return true;
}
