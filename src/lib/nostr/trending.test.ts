import { describe, it, expect, vi } from "vitest";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("./core", () => ({ getNDK: () => ({}), fetchWithTimeout: vi.fn(), FEED_TIMEOUT: 1 }));

import { looksLikeHashtag, fetchTrendingHashtags } from "./trending";
import { fetchWithTimeout } from "./core";

describe("looksLikeHashtag", () => {
  it("takes a word in any script, with digits and underscores", () => {
    for (const tag of ["bitcoin", "nostr_dev", "web3", "ビットコイン", "biткоин", "a1", "भारत", "हिंदी", "தமிழ்", "สวัสดี", "cafe\u0301", "a", "z".repeat(24), "deadbeefcaf"]) expect(looksLikeHashtag(tag)).toBe(true);
  });

  it("drops what a bot writes after the hash", () => {
    for (const tag of ["tlgblue-dm-45dda58cca595080acebc0b5", "45dda58cca595080acebc0b5", "", "a".repeat(25), "two words", "x-y", "deadbeefcafe", "id0123456789ab"]) expect(looksLikeHashtag(tag)).toBe(false);
  });
});

describe("fetchTrendingHashtags", () => {
  it("counts only what looks like a hashtag, so a bot's identifier cannot lead", async () => {
    const tagged = (tags: string[]) => ({ tags: tags.map((t) => ["t", t]) }) as unknown as NDKEvent;
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Set([
      tagged(["Bitcoin", "tlgblue-dm-45dda58cca595080acebc0b5"]),
      tagged(["bitcoin", "tlgblue-dm-45dda58cca595080acebc0b5", "art"]),
      tagged(["tlgblue-dm-45dda58cca595080acebc0b5", "art"]),
    ]));
    expect(await fetchTrendingHashtags()).toEqual([{ tag: "bitcoin", count: 2 }, { tag: "art", count: 2 }]);
  });
});
