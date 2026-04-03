import type { PodcastEpisode, V4VRecipient } from "../../types/podcast";

const API_KEY = "VKWWTGY25NVCKYJWHSNY";
const API_SECRET = "ves3#2YKqSvp7ZdRSuRhSgdnCLtFP4tEbzFGxAtW";
const API_BASE = "https://api.podcastindex.org/api/1.0";

async function sha1(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function apiHeaders(): Promise<Record<string, string>> {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const hash = await sha1(API_KEY + API_SECRET + apiHeaderTime);
  return {
    "X-Auth-Key": API_KEY,
    "X-Auth-Date": apiHeaderTime,
    "Authorization": hash,
    "User-Agent": "Vega/1.0",
  };
}

function extractV4V(value: Record<string, unknown> | undefined): V4VRecipient[] {
  if (!value) return [];
  const destinations = value.destinations as Record<string, unknown>[] | undefined;
  if (!Array.isArray(destinations)) return [];
  return destinations
    .filter((d) => d.address)
    .map((d) => ({
      name: d.name as string | undefined,
      type: (d.type as string) ?? "wallet",
      address: d.address as string,
      split: Number(d.split) || 0,
      customKey: d.customKey as string | undefined,
      customValue: d.customValue as string | undefined,
    }));
}

/**
 * Enrich a Fountain-resolved episode with V4V recipients from Podcast Index.
 * Searches by show title, then matches the episode by title within that show.
 * Returns the original episode unchanged if lookup fails.
 */
export async function enrichWithV4V(episode: PodcastEpisode): Promise<PodcastEpisode> {
  if (episode.value && episode.value.length > 0) return episode;
  if (!episode.showTitle) return episode;

  try {
    const headers = await apiHeaders();

    // Search for the show by title
    const searchRes = await fetch(
      `${API_BASE}/search/byterm?q=${encodeURIComponent(episode.showTitle)}`,
      { headers },
    );
    if (!searchRes.ok) return episode;
    const searchData = await searchRes.json();

    const feeds = searchData.feeds as Record<string, unknown>[] | undefined;
    if (!feeds || feeds.length === 0) return episode;

    // Find the best matching feed
    const showLower = episode.showTitle.toLowerCase();
    const feed = feeds.find((f) => ((f.title as string) ?? "").toLowerCase() === showLower) || feeds[0];
    const feedId = feed.id as number;
    if (!feedId) return episode;

    // Get episodes from that feed
    const epRes = await fetch(`${API_BASE}/episodes/byfeedid?id=${feedId}&max=20`, { headers });
    if (!epRes.ok) return episode;
    const epData = await epRes.json();

    const items = epData.items as Record<string, unknown>[] | undefined;
    if (!items || items.length === 0) return episode;

    // Match by episode title (fuzzy: check if PI title contains our title or vice versa)
    const epLower = episode.title.toLowerCase();
    const match = items.find((item) => {
      const piTitle = ((item.title as string) ?? "").toLowerCase();
      return piTitle === epLower || piTitle.includes(epLower) || epLower.includes(piTitle);
    });

    // Use matched episode's value, or fall back to any episode's value (show-level V4V)
    const valueSource = match || items.find((item) => item.value);
    if (!valueSource) return episode;

    const value = extractV4V(valueSource.value as Record<string, unknown> | undefined);
    if (value.length === 0) return episode;

    return { ...episode, value };
  } catch {
    return episode;
  }
}
