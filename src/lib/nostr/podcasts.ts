import { NDKEvent, NDKFilter, NDKKind } from "@nostr-dev-kit/ndk";
import { getNDK, fetchFromRelay, builtInRelayTest, publishToNetwork } from "./core";
import { relaysToAsk } from "./social";
import type { PodcastShow } from "../../types/podcast";

const KIND_BOOKMARK_SET = 30003 as NDKKind;
const D_TAG = "podcasts";

type StoredMeta = {
  title?: string;
  author?: string;
  artworkUrl?: string;
  description?: string;
  podcastIndexId?: number;
};

/** What the network holds for an account's podcast list: a list, proof of no list, or "could not tell". */
export type PodcastListResult =
  | { status: "found"; shows: PodcastShow[]; createdAt: number }
  | { status: "none" }
  | { status: "unknown" };

/** How long a relay gets to answer before its silence counts. */
const PODCAST_LIST_TIMEOUT = 6000;

/**
 * `pubkey`'s podcast list as the network holds it, and said honestly: a list,
 * proof that there is none, or "could not tell". What is published next is
 * worked out from this, so a wrong "none" or a stale list costs the user
 * their subscriptions on every device.
 *
 * Each of the user's relays is asked on its own (`fetchFromRelay`). One fetch
 * over several relays is cut short by NDK once most have answered, and a list
 * held only by the slowest then reads as no list: the contact list was wiped
 * that way (see `fetchContactList`).
 *
 * The built-in relay is not asked. It holds this device's own last publish,
 * and answers at once with the network gone. Taken for "the relays' list", a
 * change was published on top of it, and what another device had done since
 * was undone (reproduced with real NDK). It is asked only when it is the one
 * relay the user has.
 *
 * Nothing came back and not every relay answered: "unknown", never "none".
 */
export async function fetchPodcastList(pubkey: string): Promise<PodcastListResult> {
  const instance = getNDK();
  const isBuiltIn = builtInRelayTest();
  const up = await relaysToAsk(instance);
  const onlyTheBuiltIn = Array.from(instance.pool?.relays?.values() ?? []).every((relay) => isBuiltIn(relay.url));
  const relays = onlyTheBuiltIn ? up : up.filter((relay) => !isBuiltIn(relay.url));
  if (relays.length === 0) return { status: "unknown" };

  const filter: NDKFilter = {
    kinds: [KIND_BOOKMARK_SET],
    authors: [pubkey],
    "#d": [D_TAG],
    limit: 1,
  };
  const answers = await Promise.all(relays.map((relay) => fetchFromRelay(instance, relay, filter, PODCAST_LIST_TIMEOUT)));
  const lists = answers
    .flatMap((answer) => answer.events)
    .filter((e) => e.kind === KIND_BOOKMARK_SET && e.pubkey === pubkey && e.tags.some((t) => t[0] === "d" && t[1] === D_TAG));
  if (lists.length === 0) return answers.every((answer) => answer.answered) ? { status: "none" } : { status: "unknown" };
  const event = lists.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];

  const feedUrls = event.tags
    .filter((t) => t[0] === "r" && t[1])
    .map((t) => t[1]);

  let metadata: Record<string, StoredMeta> = {};
  if (event.content) {
    try {
      const parsed = JSON.parse(event.content);
      if (parsed && typeof parsed === "object") metadata = parsed;
    } catch { /* ignore malformed metadata */ }
  }

  const shows = feedUrls.map<PodcastShow>((feedUrl) => {
    const meta = metadata[feedUrl] ?? {};
    return {
      feedUrl,
      title: meta.title ?? "",
      author: meta.author ?? "",
      artworkUrl: meta.artworkUrl ?? "",
      description: meta.description ?? "",
      podcastIndexId: meta.podcastIndexId,
    };
  });

  return { status: "found", shows, createdAt: event.created_at ?? 0 };
}

/**
 * Publish `pubkey`'s list. False when nothing went out: there was no key to
 * sign with, or the key there is belongs to someone else. The list is signed
 * by whatever key NDK holds, and that has not always been the key of the
 * account on screen.
 */
export async function publishPodcastList(shows: PodcastShow[], pubkey: string): Promise<boolean> {
  const instance = getNDK();
  // One reading of the key: the one that is checked is the one that signs.
  const signer = instance.signer;
  if (!signer || (await signer.user()).pubkey !== pubkey) return false;

  const metadata: Record<string, StoredMeta> = {};
  for (const s of shows) {
    metadata[s.feedUrl] = {
      title: s.title,
      author: s.author,
      artworkUrl: s.artworkUrl,
      description: s.description,
      podcastIndexId: s.podcastIndexId,
    };
  }

  const event = new NDKEvent(instance);
  event.kind = KIND_BOOKMARK_SET;
  event.content = JSON.stringify(metadata);
  event.tags = [
    ["d", D_TAG],
    ...shows.map((s) => ["r", s.feedUrl]),
  ];
  await event.sign(signer);
  await publishToNetwork(event);
  return true;
}
