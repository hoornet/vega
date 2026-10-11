import { describe, it, expect } from "vitest";
import { detectScript, getEventLanguageTag, matchesScriptFilter } from "./language";

describe("detectScript", () => {
  it("detects Latin script", () => {
    expect(detectScript("Hello world")).toBe("Latin");
  });

  it("detects CJK script", () => {
    expect(detectScript("你好世界")).toBe("CJK");
  });

  it("detects Cyrillic script", () => {
    expect(detectScript("Привет мир")).toBe("Cyrillic");
  });

  it("detects Arabic script", () => {
    expect(detectScript("مرحبا بالعالم")).toBe("Arabic");
  });

  it("detects Korean script", () => {
    expect(detectScript("안녕하세요")).toBe("Korean");
  });

  it("returns dominant script for mixed content", () => {
    expect(detectScript("Hello 你好世界中文测试")).toBe("CJK");
  });

  it("strips URLs before detection", () => {
    expect(detectScript("https://example.com 你好世界")).toBe("CJK");
  });

  it("strips nostr mentions before detection", () => {
    expect(detectScript("nostr:npub1abc123 Привет")).toBe("Cyrillic");
  });

  it("strips hashtags before detection", () => {
    expect(detectScript("#bitcoin Hola mundo")).toBe("Latin");
  });

  it("returns Unknown for empty input", () => {
    expect(detectScript("")).toBe("Unknown");
  });

  it("returns Unknown for whitespace-only input", () => {
    expect(detectScript("   ")).toBe("Unknown");
  });

  it("returns Unknown for only URLs/mentions", () => {
    expect(detectScript("https://example.com nostr:npub1abc")).toBe("Unknown");
  });
});

describe("getEventLanguageTag", () => {
  it("finds ISO-639-1 language tag", () => {
    const tags = [
      ["t", "bitcoin"],
      ["l", "en", "ISO-639-1"],
    ];
    expect(getEventLanguageTag(tags)).toBe("en");
  });

  it("returns null when no language tag exists", () => {
    const tags = [["t", "nostr"], ["p", "abc123"]];
    expect(getEventLanguageTag(tags)).toBeNull();
  });

  it("ignores l tags without ISO-639-1 namespace", () => {
    const tags = [["l", "en", "some-other-namespace"]];
    expect(getEventLanguageTag(tags)).toBeNull();
  });

  it("returns null for empty tags", () => {
    expect(getEventLanguageTag([])).toBeNull();
  });
});

describe("matchesScriptFilter", () => {
  it("passes everything when no filter is set", () => {
    expect(matchesScriptFilter([], "Привет", null)).toBe(true);
  });

  it("lets a known NIP-32 language tag decide", () => {
    expect(matchesScriptFilter([["l", "en", "ISO-639-1"]], "Привет", "Latin")).toBe(true);
    expect(matchesScriptFilter([["l", "ru", "ISO-639-1"]], "Hello", "Latin")).toBe(false);
  });

  it("falls back to script detection for untagged text and for tags it does not map", () => {
    expect(matchesScriptFilter([], "Hello world", "Latin")).toBe(true);
    expect(matchesScriptFilter([], "Привет мир", "Latin")).toBe(false);
    expect(matchesScriptFilter([["l", "xx", "ISO-639-1"]], "Привет мир", "Latin")).toBe(false);
  });
});
