import { describe, it, expect } from "vitest";
import { articleText, isRssBridge, shouldShowArticle, type ArticleFilterOptions, type ArticleLike } from "./articleFilters";

// Fixtures are shaped after real events from the Latest tab on 2026-10-11.
const gallerySpam: ArticleLike = {
  pubkey: "6cfb8dec".padEnd(64, "0"),
  tags: [["d", "gallery-cf7d7617"], ["title", "ที่พักราชบุรี 8 คน"], ["published_at", "1791714804"]],
  content:
    "[![View Full Gallery](https://i.postimg.cc/x/cta.png)](https://sea.example/ydt?q=x)\n[View Full Gallery](https://sea.example/ydt?q=x)\n\n---\n\n> Curated gallery | 19 images",
};

const rssRepost: ArticleLike = {
  pubkey: "bbcrussian".padEnd(64, "1"),
  tags: [["d", "bbc-1"], ["title", "Авиаудар по Краматорску унес десятки жизней"]],
  content: "Короткий пересказ новости со ссылкой на источник.",
};
const rssProfile = {
  name: "BBC Russian (RSS Feed)",
  nip05: "bbc.com_russian_rss@rss.nostr.twinkle.lol",
};

const genuine: ArticleLike = {
  pubkey: "segmara".padEnd(64, "2"),
  tags: [["d", "stripe-ipo"], ["title", "When Will Stripe IPO?"], ["summary", "Track verified Stripe IPO signals."]],
  content: "Stripe's 2026 bid for PayPal collapsed, and it separately agreed to acquire OpenRouter.",
};
const genuineProfile = { name: "segmara", displayName: "Segmara", nip05: "segmara@example.com" };

function opts(over: Partial<ArticleFilterOptions> = {}): ArticleFilterOptions {
  return {
    tab: "latest",
    mutedPubkeys: new Set(),
    contentMatchesMutedKeyword: () => false,
    languageFilter: null,
    hideRssBridges: true,
    profile: genuineProfile,
    ...over,
  };
}

describe("isRssBridge", () => {
  it("recognises a bridge by its NIP-05 domain", () => {
    expect(isRssBridge({ name: "24 Канал", nip05: "24tv.ua_rss_all.xml@rss.nostr.twinkle.lol" })).toBe(true);
    expect(isRssBridge({ nip05: "x@sub.rss.nostr.twinkle.lol" })).toBe(true);
  });

  it("recognises a bridge by the '(RSS Feed)' naming convention", () => {
    expect(isRssBridge({ name: "Meduza.io (RSS Feed)" })).toBe(true);
    expect(isRssBridge({ displayName: "ASTRA ( rss feed )" })).toBe(true);
  });

  it("does not flag ordinary profiles or missing ones", () => {
    expect(isRssBridge(genuineProfile)).toBe(false);
    expect(isRssBridge({ name: "RSS enthusiast", nip05: "me@twinkle.lol" })).toBe(false);
    expect(isRssBridge(null)).toBe(false);
    expect(isRssBridge(undefined)).toBe(false);
  });
});

describe("articleText", () => {
  it("joins title, summary and body so keyword mutes see all three", () => {
    expect(articleText(genuine)).toBe(
      "When Will Stripe IPO?\nTrack verified Stripe IPO signals.\n" + genuine.content,
    );
  });
});

describe("shouldShowArticle on Latest", () => {
  it("shows a genuine article from an author with a profile", () => {
    expect(shouldShowArticle(genuine, opts())).toBe(true);
  });

  it("hides the gallery spam because its key has no profile", () => {
    expect(shouldShowArticle(gallerySpam, opts({ profile: null }))).toBe(false);
  });

  it("holds an article back while its author's profile is still unknown", () => {
    expect(shouldShowArticle(genuine, opts({ profile: undefined }))).toBe(false);
  });

  it("hides RSS reposts when asked and shows them when not", () => {
    expect(shouldShowArticle(rssRepost, opts({ profile: rssProfile }))).toBe(false);
    expect(shouldShowArticle(rssRepost, opts({ profile: rssProfile, hideRssBridges: false }))).toBe(true);
  });

  it("honours the mute list", () => {
    expect(shouldShowArticle(genuine, opts({ mutedPubkeys: new Set([genuine.pubkey]) }))).toBe(false);
  });

  it("applies keyword mutes to the title, not just the body", () => {
    const matcher = (text: string) => /\bstripe\b/i.test(text);
    expect(shouldShowArticle(genuine, opts({ contentMatchesMutedKeyword: matcher }))).toBe(false);
    const bodyOnly: ArticleLike = { ...genuine, tags: [["d", "x"], ["title", "Untitled"]], content: "plain body" };
    expect(shouldShowArticle(bodyOnly, opts({ contentMatchesMutedKeyword: matcher }))).toBe(true);
  });

  it("applies the feed's language filter", () => {
    expect(shouldShowArticle(rssRepost, opts({ profile: genuineProfile, languageFilter: "Latin" }))).toBe(false);
    expect(shouldShowArticle(genuine, opts({ languageFilter: "Latin" }))).toBe(true);
    expect(shouldShowArticle(genuine, opts({ languageFilter: "Cyrillic" }))).toBe(false);
  });

  it("applies the Web of Trust set only once it has been built", () => {
    expect(shouldShowArticle(genuine, opts({ wotSet: new Set() }))).toBe(true);
    expect(shouldShowArticle(genuine, opts({ wotSet: new Set(["someone else"]) }))).toBe(false);
    expect(shouldShowArticle(genuine, opts({ wotSet: new Set([genuine.pubkey]) }))).toBe(true);
  });
});

describe("shouldShowArticle on Following", () => {
  it("never applies the profile, RSS or WoT rules to people you follow", () => {
    const following = opts({ tab: "following", profile: undefined, wotSet: new Set(["someone else"]) });
    expect(shouldShowArticle(gallerySpam, { ...following, profile: null })).toBe(true);
    expect(shouldShowArticle(rssRepost, { ...following, profile: rssProfile })).toBe(true);
    expect(shouldShowArticle(genuine, following)).toBe(true);
  });

  it("still applies mutes, keywords and the language filter", () => {
    expect(shouldShowArticle(genuine, opts({ tab: "following", mutedPubkeys: new Set([genuine.pubkey]) }))).toBe(false);
    expect(shouldShowArticle(genuine, opts({ tab: "following", contentMatchesMutedKeyword: () => true }))).toBe(false);
    expect(shouldShowArticle(rssRepost, opts({ tab: "following", languageFilter: "Latin" }))).toBe(false);
  });
});
