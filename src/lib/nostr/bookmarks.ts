import { NDKEvent, NDKFilter, NDKKind } from "@nostr-dev-kit/ndk";
import { getNDK, fetchWithTimeout, SINGLE_TIMEOUT } from "./core";

export async function fetchBookmarkList(pubkey: string): Promise<string[]> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [10003 as NDKKind], authors: [pubkey], limit: 1 };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  if (events.size === 0) return [];
  const event = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  return event.tags.filter((t) => t[0] === "e" && t[1]).map((t) => t[1]);
}

export async function publishBookmarkList(eventIds: string[]): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) return;
  const event = new NDKEvent(instance);
  event.kind = 10003 as NDKKind;
  event.content = "";
  event.tags = eventIds.map((id) => ["e", id]);
  await event.publish();
}

export async function fetchBookmarkListFull(pubkey: string): Promise<{ eventIds: string[]; articleAddrs: string[] }> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [10003 as NDKKind], authors: [pubkey], limit: 1 };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  if (events.size === 0) return { eventIds: [], articleAddrs: [] };
  const event = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  const eventIds = event.tags.filter((t) => t[0] === "e" && t[1]).map((t) => t[1]);
  const articleAddrs = event.tags.filter((t) => t[0] === "a" && t[1]).map((t) => t[1]);
  return { eventIds, articleAddrs };
}

/** Publishes the bookmark list. False when there is no key to sign with: nothing was published, and nothing failed. */
export async function publishBookmarkListFull(eventIds: string[], articleAddrs: string[]): Promise<boolean> {
  const instance = getNDK();
  if (!instance.signer) return false;
  const event = new NDKEvent(instance);
  event.kind = 10003 as NDKKind;
  event.content = "";
  event.tags = [
    ...eventIds.map((id) => ["e", id]),
    ...articleAddrs.map((addr) => ["a", addr]),
  ];
  await event.publish();
  return true;
}
