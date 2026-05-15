import { NDKEvent, NDKFilter, NDKKind } from "@nostr-dev-kit/ndk";
import { getNDK, fetchWithTimeout, SINGLE_TIMEOUT } from "./core";
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

export async function fetchPodcastList(pubkey: string): Promise<{
  shows: PodcastShow[];
  createdAt: number;
} | null> {
  const instance = getNDK();
  const filter: NDKFilter = {
    kinds: [KIND_BOOKMARK_SET],
    authors: [pubkey],
    "#d": [D_TAG],
    limit: 1,
  };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);
  if (events.size === 0) return null;
  const event = Array.from(events).sort(
    (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
  )[0];

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

  return { shows, createdAt: event.created_at ?? 0 };
}

export async function publishPodcastList(shows: PodcastShow[]): Promise<void> {
  const instance = getNDK();
  if (!instance.signer) return;

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
  await event.publish();
}
