import { fetch } from "@tauri-apps/plugin-http";
import type { PodcastEpisode } from "../../types/podcast";
import { enrichWithV4V } from "./podcastIndexV4V";

export const FOUNTAIN_REGEX = /fountain\.fm\/(episode|show)\/([a-zA-Z0-9-]+)/;

const CACHE_KEY = "wrystr_fountain_cache";

function loadCache(): Record<string, PodcastEpisode> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, PodcastEpisode>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

export async function resolveFountainEpisode(url: string): Promise<PodcastEpisode | null> {
  const cache = loadCache();
  if (cache[url]) return cache[url];

  try {
    // Fetch the Fountain.fm page and extract og: meta tags
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();

    const getMetaContent = (property: string): string => {
      const regex = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i");
      const altRegex = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i");
      const match = html.match(regex) || html.match(altRegex);
      return match?.[1] ?? "";
    };

    const title = getMetaContent("og:title");
    const description = getMetaContent("og:description");
    const artwork = getMetaContent("og:image");

    // Prefer og:audio meta tag (Fountain.fm provides this), then fall back to any audio URL
    const ogAudioMatch = html.match(/<meta[^>]+property=["']og:audio["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:audio["']/i);
    const audioMatch = ogAudioMatch
      || html.match(/<meta[^>]+content=["'](https?:\/\/[^"']+\.(mp3|m4a|ogg|opus)[^"']*?)["']/i)
      || html.match(/["'](https?:\/\/[^"'\s]+\.(mp3|m4a|ogg|opus)[^"'\s]*?)["']/i);
    const enclosureUrl = audioMatch?.[1] ?? "";

    if (!title) return null;

    // OG title format: "Show • Episode • Listen on Fountain" — extract parts
    const titleParts = title.split(" • ").filter((p) => p !== "Listen on Fountain");
    const showTitle = titleParts.length > 1 ? titleParts[0] : "";
    const episodeTitle = titleParts.length > 1 ? titleParts.slice(1).join(" • ") : title;

    const episode: PodcastEpisode = {
      guid: `fountain:${url}`,
      title: episodeTitle,
      enclosureUrl,
      pubDate: 0,
      duration: 0,
      description,
      artworkUrl: artwork || undefined,
      showTitle,
      showArtworkUrl: artwork,
    };

    // Try to enrich with V4V data from Podcast Index (non-blocking)
    const enriched = await enrichWithV4V(episode);

    cache[url] = enriched;
    saveCache(cache);
    return enriched;
  } catch {
    return null;
  }
}
