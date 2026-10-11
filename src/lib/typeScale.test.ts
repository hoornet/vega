import { describe, it, expect } from "vitest";

// The type scale (`text-micro` ... `text-display`, defined in index.css)
// replaced 726 hard-coded text sizes in October 2026. What is left are icon
// sizes: a lone glyph, an emoji, the initial inside an avatar placeholder.
// Those go away as glyphs are replaced by icons.
//
// This test is a ratchet. A file may lose hard-coded sizes, never gain them,
// and a file that has none may not start. New text takes a step of the scale.

const sources = import.meta.glob(["../**/*.tsx", "../**/*.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// A size written as a class: `text-[11px]`, `text-[.8rem]`, `text-[110%]`,
// `text-[length:13px]`, `text-sm`, `text-2xl`, with any variant prefix.
// Colours in brackets (`text-[#1DB954]`, `text-[var(--x)]`) are not sizes.
const HARD_CODED = /(?<![\w:-])(?:[a-z0-9\-[\]/&>_.*]+:)*text-(?:\[(?!#|var\(|color:)[^\]]*\d[^\]]*\]|xs|sm|base|lg|\d?xl)(?![\w-])/g;

// What it cannot see: a size set in a stylesheet or an inline style, and a
// swap inside one file (a glyph size removed, a text size added) that leaves
// the count unchanged. It catches the common case, not every case.

// file -> the most hard-coded sizes it may contain. Lower a number when you
// remove some; never raise one.
const ALLOWED: Record<string, number> = {
  "components/article/ArticleCard.tsx": 1,
  "components/article/ArticleEditor.tsx": 1,
  "components/article/ArticleView.tsx": 1,
  "components/dm/DMView.tsx": 2,
  "components/feed/ComposeBox.tsx": 5,
  "components/feed/FountainCard.tsx": 2,
  "components/feed/InlineReplyBox.tsx": 3,
  "components/feed/MediaCards.tsx": 2,
  "components/feed/NoteActions.tsx": 3,
  "components/feed/NoteCard.tsx": 1,
  "components/feed/QuoteModal.tsx": 2,
  "components/feed/TextSegments.tsx": 1,
  "components/follows/FollowsView.tsx": 1,
  "components/onboarding/OnboardingFlow.tsx": 1,
  "components/podcast/PodcastCard.tsx": 1,
  "components/podcast/PodcastPlayerBar.tsx": 3,
  "components/poll/PollCompose.tsx": 1,
  "components/poll/PollWidget.tsx": 1,
  "components/profile/ProfileMediaGallery.tsx": 2,
  "components/profile/ProfileView.tsx": 2,
  "components/search/SearchView.tsx": 3,
  "components/shared/EmojiPicker.tsx": 1,
  "components/shared/HelpModal.tsx": 1,
  "components/shared/ImageLightbox.tsx": 3,
  "components/shared/LoginModal.tsx": 1,
  "components/shared/RelaysView.tsx": 1,
  "components/shared/SettingsView.tsx": 1,
  "components/sidebar/AccountSwitcher.tsx": 6,
  "components/sidebar/Sidebar.tsx": 3,
  "components/thread/AncestorChain.tsx": 2,
  "components/thread/ThreadNode.tsx": 1,
  "components/thread/ThreadView.tsx": 1,
  "components/v4v/V4VSettings.tsx": 2,
  "components/zap/ZapHistoryView.tsx": 1,
  "components/zap/ZapModal.tsx": 3,
};

function count(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const [path, text] of Object.entries(sources)) {
    if (path.includes(".test.")) continue;
    const n = text.match(HARD_CODED)?.length ?? 0;
    if (n > 0) found[path.replace(/^\.\.\//, "")] = n;
  }
  return found;
}

describe("the type scale", () => {
  it("finds the source files", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it("gains no hard-coded text sizes", () => {
    const over = Object.entries(count())
      .filter(([file, n]) => n > (ALLOWED[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} hard-coded sizes, ${ALLOWED[file] ?? 0} allowed`);
    expect(over, "use text-micro, text-caption, text-ui, text-body, text-title, text-heading or text-display").toEqual([]);
  });

  // Keeps the list honest: when sizes are removed, the ceiling comes down with them.
  it("has no ceiling higher than what is there", () => {
    const found = count();
    const slack = Object.entries(ALLOWED)
      .filter(([file, n]) => (found[file] ?? 0) < n)
      .map(([file, n]) => `${file}: allows ${n}, has ${found[file] ?? 0}`);
    expect(slack, "lower these numbers in ALLOWED").toEqual([]);
  });
});
