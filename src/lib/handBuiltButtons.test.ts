import { describe, it, expect } from "vitest";

// `Button` (components/shared/Button.tsx) replaced about ninety buttons that
// were each drawn by hand, in October 2026. What is left with a box of its own
// is not a button in that sense: a chip (a hashtag, a reaction, an interest),
// a segment of a choice, a row that is tinted when selected, a row that is a
// card, the dot that removes an attachment.
//
// This test is a ratchet. A file may lose hand-drawn boxes, never gain them,
// and a file that has none may not start. An action with a label is a `Button`.

const sources = import.meta.glob("../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** The opening tags of every `<button>` in a source file, braces and strings skipped over. */
export function buttonTags(src: string): string[] {
  const tags: string[] = [];
  const open = /<button(?=[\s/>])/g;
  for (let m = open.exec(src); m; m = open.exec(src)) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = "";
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push(src.slice(m.index, i + 1));
  }
  return tags;
}

/** Every class token written anywhere in a tag, all branches of a conditional included. */
function classTokens(tag: string): Set<string> {
  const tokens = new Set<string>();
  const literal = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`]*)`/g;
  for (let m = literal.exec(tag); m; m = literal.exec(tag)) {
    // Inside a template, `${on ? "border" : ""}` holds classes too: keep what is quoted there.
    const body = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{|\}/g, " ");
    for (const t of body.split(/\s+/)) {
      const token = t.replace(/^["']+|["']+$/g, "");
      if (token) tokens.add(token);
    }
  }
  return tokens;
}

const UNPREFIXED_FILL = /^bg-(?!transparent$)[a-z]/;
const OUTLINE = /^(border(-\d+)?|ring(-\d+)?)$/;
const SOLID = /^bg-(accent|zap|danger|success|warning)(\/\d+)?$/;

/**
 * Drawn as a button by hand. Any of:
 *  - the button radius together with a fill, an outline or a ring, at rest.
 *    This is the shape a copy of the shared look would have (`bg-text/8 ...
 *    rounded-sm`), and the old one (`border ... rounded-sm`);
 *  - a solid or tinted fill in a token colour, whatever the radius;
 *  - a full outline with padding, whatever the radius.
 * Variant-prefixed classes (`hover:bg-...`) do not count: a row that only
 * lights up under the pointer is not a box.
 */
export function isHandDrawn(tag: string): boolean {
  const t = [...classTokens(tag)];
  const fill = t.some((c) => UNPREFIXED_FILL.test(c));
  const outline = t.some((c) => OUTLINE.test(c));
  const buttonRadius = t.includes("rounded-sm") || t.includes("rounded-md") || t.includes("rounded");
  const padded = t.some((c) => /^p[xy]?-(\d|\[)/.test(c));
  return (buttonRadius && (fill || outline)) || t.some((c) => SOLID.test(c)) || (outline && padded);
}

// What it cannot see: classes kept in a constant (`className={BOX}`), a box
// built from a `<div role="button">` or an `<a>`, and a box drawn by a
// stylesheet. It catches the copy-paste case, which is how the ninety happened.

// file -> the most hand-drawn buttons it may contain. Lower a number when you
// remove one; never raise one.
const ALLOWED: Record<string, number> = {
  "components/article/ArticleEditor.tsx": 2, // the Write and Preview segments
  "components/dm/DMView.tsx": 2, // conversation rows, tinted when selected
  "components/feed/ComposeBox.tsx": 1, // the dot that removes an attachment
  "components/feed/Feed.tsx": 2, // the "new notes" bar, and interest chips on the empty feed
  "components/feed/InlineReplyBox.tsx": 1, // the dot that removes an attachment
  "components/feed/MediaCards.tsx": 1, // an audio card
  "components/feed/NoteActions.tsx": 1, // reaction pills
  "components/onboarding/OnboardingFlow.tsx": 2, // interest chips, and the login method segments
  "components/podcast/EpisodeList.tsx": 1, // an episode row, tinted while it plays
  "components/podcast/V4VIndicator.tsx": 1, // the streaming pill in the player bar
  "components/poll/PollWidget.tsx": 1, // a poll option, with its result bar behind it
  "components/search/SearchView.tsx": 1, // trending hashtag chips
  "components/shared/RelaysView.tsx": 1, // the relay authentication segments
  "components/shared/SettingsView.tsx": 3, // theme cards, and the font size and relay authentication segments
  "components/sidebar/Sidebar.tsx": 1, // navigation rows, tinted when current
  "components/v4v/V4VSettings.tsx": 1, // the streaming rate options
  "components/zap/ZapHistoryView.tsx": 1, // a zap row that opens its note
  "components/zap/ZapModal.tsx": 1, // the amount presets
};

// The shared controls are where a box is meant to be drawn. (The switch's track is `bg-accent` when on.)
const SHARED = new Set(["../components/shared/Button.tsx", "../components/shared/Switch.tsx"]);

function count(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const [path, text] of Object.entries(sources)) {
    if (path.includes(".test.") || SHARED.has(path)) continue;
    const n = buttonTags(text).filter(isHandDrawn).length;
    if (n > 0) found[path.replace(/^\.\.\//, "")] = n;
  }
  return found;
}

describe("the tag scanner", () => {
  it("reads past arrows, braces and strings to the end of the tag", () => {
    const src = `<div><button onClick={() => a > b ? go({ x: ">" }) : stop()} className={\`px-3 \${on ? "border" : "x"}\`}>Go</button></div>`;
    const tags = buttonTags(src);
    expect(tags).toHaveLength(1);
    expect(tags[0].endsWith("`}>")).toBe(true);
    expect(isHandDrawn(tags[0])).toBe(true);
  });

  it("does not mistake the shared component, or another tag, for a button", () => {
    expect(buttonTags(`<Button variant="primary">Go</Button><buttonish /><a className="border px-3" />`)).toHaveLength(0);
  });

  it("tells a hand-drawn button from a plain one", () => {
    // the old look, and a copy of the new one
    expect(isHandDrawn(`<button className="px-3 py-1 border border-border rounded-sm">`)).toBe(true);
    expect(isHandDrawn(`<button className="h-8 px-3 bg-text/8 text-text rounded-sm">`)).toBe(true);
    // solid fills and tints in a token colour, whatever the radius
    expect(isHandDrawn(`<button className="px-4 py-1 bg-accent text-accent-text">`)).toBe(true);
    expect(isHandDrawn(`<button className="w-full py-2 bg-zap text-zap-text">`)).toBe(true);
    expect(isHandDrawn(`<button className="px-2 bg-accent/10 text-accent">`)).toBe(true);
    // an outline with padding and no horizontal padding class: "w-full py-2 border" was missed once
    expect(isHandDrawn(`<button className="w-full py-2.5 border border-border">`)).toBe(true);
    expect(isHandDrawn(`<button className="p-2 border rounded-lg">`)).toBe(true);
    expect(isHandDrawn(`<button className="px-[10px] border-2 border-accent">`)).toBe(true);
    expect(isHandDrawn(`<button className="py-1 ring-1 ring-border rounded-sm">`)).toBe(true);
    // a class inside a condition counts
    expect(isHandDrawn(`<button className={\`px-3 \${on ? "bg-accent/10" : ""}\`}>`)).toBe(true);
  });

  it("leaves alone what is not a box", () => {
    // a divider on one side, text alone, a row that only lights up under the pointer
    expect(isHandDrawn(`<button className="px-3 border-b border-border-subtle">`)).toBe(false);
    expect(isHandDrawn(`<button className="text-text-dim hover:text-text">`)).toBe(false);
    expect(isHandDrawn(`<button className="w-full px-4 py-3 text-left hover:bg-bg-hover">`)).toBe(false);
    expect(isHandDrawn(`<button className="h-8 w-8 rounded-sm hover:bg-text/8">`)).toBe(false);
    expect(isHandDrawn(`<button className="px-2 bg-transparent">`)).toBe(false);
  });
});

describe("hand-drawn buttons", () => {
  it("finds the source files", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it("gains none", () => {
    const over = Object.entries(count())
      .filter(([file, n]) => n > (ALLOWED[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} hand-drawn buttons, ${ALLOWED[file] ?? 0} allowed`);
    expect(over, "use <Button> from components/shared/Button").toEqual([]);
  });

  // Keeps the list honest: when one is removed, the ceiling comes down with it.
  it("has no ceiling higher than what is there", () => {
    const found = count();
    const slack = Object.entries(ALLOWED)
      .filter(([file, n]) => (found[file] ?? 0) < n)
      .map(([file, n]) => `${file}: allows ${n}, has ${found[file] ?? 0}`);
    expect(slack, "lower these numbers in ALLOWED").toEqual([]);
  });
});
