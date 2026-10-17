import { describe, it, expect } from "vitest";
import { articleTags, articleSlug } from "./articles";

const NOW = 1_700_000_000_000;

describe("the tags of a published article", () => {
  it("mint an address from the title and the time for a new article", () => {
    const tags = articleTags({ title: "Hello, World!", content: "x" }, NOW);
    expect(tags).toContainEqual(["d", "hello-world-1700000000000"]);
    expect(tags).toContainEqual(["published_at", "1700000000"]);
    expect(articleSlug("  Ünïcode & émojis 🎉 ", NOW)).toBe("n-code-mojis-1700000000000");
  });

  it("keep the address and the first published_at of an article being edited", () => {
    const tags = articleTags({ title: "New title", content: "x", dTag: "old-slug-1", publishedAt: 1_600_000_000 }, NOW);
    expect(tags).toContainEqual(["d", "old-slug-1"]);
    expect(tags).toContainEqual(["title", "New title"]);
    expect(tags).toContainEqual(["published_at", "1600000000"]);
  });

  it("carry summary, cover and tags only when given", () => {
    expect(articleTags({ title: "T", content: "x" }, NOW).map((t) => t[0])).toEqual(["d", "title", "published_at"]);
    const full = articleTags({ title: "T", content: "x", summary: "S", image: "https://i", tags: ["a", "b"] }, NOW);
    expect(full).toContainEqual(["summary", "S"]);
    expect(full).toContainEqual(["image", "https://i"]);
    expect(full.filter((t) => t[0] === "t").map((t) => t[1])).toEqual(["a", "b"]);
  });
});
