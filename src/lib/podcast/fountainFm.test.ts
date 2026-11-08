import { describe, it, expect, vi, beforeEach } from "vitest";

const http = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../proxy", () => ({ fetchWithProxy: http.fetch }));
vi.mock("./podcastIndexV4V", () => ({ enrichWithV4V: async <T,>(episode: T) => episode }));

import { resolveFountainEpisode } from "./fountainFm";

const page = (title: string) => `<html><head>
  <meta property="og:title" content="${title}">
  <meta property="og:audio" content="https://cdn.example/ep.mp3">
</head></html>`;

describe("resolveFountainEpisode", () => {
  beforeEach(() => {
    localStorage.clear();
    http.fetch.mockReset();
    http.fetch.mockImplementation(async () => ({ ok: true, text: async () => page("Show • Episode • Listen on Fountain") }));
  });

  it("reads a page on Fountain's host", async () => {
    const episode = await resolveFountainEpisode("https://fountain.fm/episode/abc");
    expect(http.fetch).toHaveBeenCalledWith("https://fountain.fm/episode/abc");
    expect(episode).toMatchObject({ title: "Episode", enclosureUrl: "https://cdn.example/ep.mp3" });
  });

  it("asks nothing of a host that only puts fountain.fm in its path", async () => {
    for (const url of ["https://evil.example/fountain.fm/episode/abc", "https://fountain.fm@evil.example/episode/abc"]) {
      expect(await resolveFountainEpisode(url)).toBeNull();
    }
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it("does not show what an older build cached for another host", async () => {
    const url = "https://evil.example/fountain.fm/episode/abc";
    localStorage.setItem("wrystr_fountain_cache", JSON.stringify({ [url]: { title: "Spoofed" } }));
    expect(await resolveFountainEpisode(url)).toBeNull();
  });
});
