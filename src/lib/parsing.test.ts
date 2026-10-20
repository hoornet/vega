import { describe, it, expect } from "vitest";
import { parseContent } from "./parsing";
import { nip19 } from "@nostr-dev-kit/ndk";

describe("parseContent", () => {
  it("returns plain text as a single text segment", () => {
    const result = parseContent("Hello world");
    expect(result).toEqual([{ type: "text", value: "Hello world" }]);
  });

  it("parses URLs as link segments with shortened display", () => {
    const result = parseContent("Check https://example.com/path out");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "text", value: "Check " });
    expect(result[1].type).toBe("link");
    expect(result[1].value).toBe("https://example.com/path");
    expect(result[1].display).toBe("example.com/path");
    expect(result[2]).toEqual({ type: "text", value: " out" });
  });

  it("parses image URLs", () => {
    const result = parseContent("Look https://example.com/photo.jpg");
    expect(result[1]).toEqual({ type: "image", value: "https://example.com/photo.jpg" });
  });

  it("parses image URLs with query params", () => {
    const result = parseContent("https://example.com/photo.png?w=800");
    expect(result[0].type).toBe("image");
  });

  it("parses various image extensions", () => {
    for (const ext of ["jpg", "jpeg", "png", "gif", "webp", "svg"]) {
      const result = parseContent(`https://example.com/img.${ext}`);
      expect(result[0].type).toBe("image");
    }
  });

  it("parses video URLs", () => {
    const result = parseContent("https://example.com/video.mp4");
    expect(result[0]).toEqual({ type: "video", value: "https://example.com/video.mp4" });
  });

  it("parses various video extensions", () => {
    for (const ext of ["mp4", "webm", "mov"]) {
      const result = parseContent(`https://example.com/vid.${ext}`);
      expect(result[0].type).toBe("video");
    }
  });

  it("parses audio URLs", () => {
    const result = parseContent("https://example.com/song.mp3");
    expect(result[0]).toEqual({ type: "audio", value: "https://example.com/song.mp3" });
  });

  it("parses various audio extensions", () => {
    for (const ext of ["mp3", "wav", "flac", "aac"]) {
      const result = parseContent(`https://example.com/audio.${ext}`);
      expect(result[0].type).toBe("audio");
    }
  });

  it("parses YouTube watch URLs", () => {
    const result = parseContent("https://youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result[0].type).toBe("youtube");
    expect(result[0].mediaId).toBe("dQw4w9WgXcQ");
  });

  it("parses YouTube shorts URLs", () => {
    const result = parseContent("https://youtube.com/shorts/dQw4w9WgXcQ");
    expect(result[0].type).toBe("youtube");
    expect(result[0].mediaId).toBe("dQw4w9WgXcQ");
  });

  it("parses youtu.be short URLs", () => {
    const result = parseContent("https://youtu.be/dQw4w9WgXcQ");
    expect(result[0].type).toBe("youtube");
    expect(result[0].mediaId).toBe("dQw4w9WgXcQ");
  });

  it("parses Spotify track URLs", () => {
    const result = parseContent("https://open.spotify.com/track/abc123");
    expect(result[0].type).toBe("spotify");
    expect(result[0].mediaType).toBe("track");
    expect(result[0].mediaId).toBe("abc123");
  });

  it("parses Spotify album URLs", () => {
    const result = parseContent("https://open.spotify.com/album/xyz789");
    expect(result[0].type).toBe("spotify");
    expect(result[0].mediaType).toBe("album");
  });

  it("parses Spotify playlist URLs", () => {
    const result = parseContent("https://open.spotify.com/playlist/pl123");
    expect(result[0].type).toBe("spotify");
    expect(result[0].mediaType).toBe("playlist");
  });

  it("parses Vimeo URLs", () => {
    const result = parseContent("https://vimeo.com/123456789");
    expect(result[0].type).toBe("vimeo");
    expect(result[0].mediaId).toBe("123456789");
  });

  it("parses Tidal track URLs", () => {
    const result = parseContent("https://tidal.com/track/12345");
    expect(result[0].type).toBe("tidal");
    expect(result[0].mediaType).toBe("track");
    expect(result[0].mediaId).toBe("12345");
  });

  it("parses Tidal browse URLs", () => {
    const result = parseContent("https://tidal.com/browse/album/67890");
    expect(result[0].type).toBe("tidal");
    expect(result[0].mediaType).toBe("album");
    expect(result[0].mediaId).toBe("67890");
  });

  it("parses nostr:npub mentions", () => {
    // Use a valid npub (bech32-encoded)
    const npub = "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsd2pfy7";
    const result = parseContent(`Hello nostr:${npub}`);
    const mention = result.find((s) => s.type === "mention");
    expect(mention).toBeDefined();
    expect(mention!.value).toBe(npub);
  });

  // An account is called one thing everywhere, in a mention too.
  it("shows a mentioned account by its shortened public address until its name is known", () => {
    const npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
    const mention = parseContent(`Hello nostr:${npub}`).find((s) => s.type === "mention")!;
    expect(mention.mentionPubkey).toBe("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d");
    expect(mention.display).toBe("npub180c…h6w6");
  });

  it("shows an nprofile mention as the same account's address, not as the start of the nprofile", () => {
    const nprofile = nip19.nprofileEncode({ pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d", relays: ["wss://relay.example.com"] });
    const mention = parseContent(`Hello nostr:${nprofile}`).find((s) => s.type === "mention")!;
    expect(mention.mentionPubkey).toBe("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d");
    expect(mention.display).toBe("npub180c…h6w6");
  });

  it("parses hashtags", () => {
    const result = parseContent("Hello #bitcoin world");
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({ type: "hashtag", value: "bitcoin", display: "#bitcoin" });
  });

  it("does not parse single-char hashtags", () => {
    const result = parseContent("Hello #a world");
    // #a has only 1 char after #, should not match (regex requires 2+)
    expect(result.find((s) => s.type === "hashtag")).toBeUndefined();
  });

  it("handles mixed content with multiple types", () => {
    const content = "Check https://example.com and #nostr";
    const result = parseContent(content);
    const types = result.map((s) => s.type);
    expect(types).toContain("text");
    expect(types).toContain("link");
    expect(types).toContain("hashtag");
  });

  it("cleans trailing punctuation from URLs", () => {
    const result = parseContent("See https://example.com/page.");
    const link = result.find((s) => s.type === "link");
    expect(link!.value).toBe("https://example.com/page");
  });

  it("cleans trailing parenthesis from URLs", () => {
    const result = parseContent("(https://example.com/page)");
    const link = result.find((s) => s.type === "link");
    expect(link!.value).toBe("https://example.com/page");
  });

  it("shortens long display URLs", () => {
    const longPath = "/a".repeat(30);
    const result = parseContent(`https://example.com${longPath}`);
    const link = result.find((s) => s.type === "link");
    expect(link!.display!.length).toBeLessThanOrEqual(50);
  });

  it("returns empty for empty input", () => {
    const result = parseContent("");
    expect(result).toEqual([]);
  });
});
