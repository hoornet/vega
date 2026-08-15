import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown";

/**
 * Characterization tests for article rendering (NIP-23).
 *
 * Written against marked 17 before the bump to 18, so that a major-version
 * change to the renderer shows up as a failing assertion rather than as a
 * subtly different article three releases later. Long-form is a first-class
 * feature and nothing pinned its output before this.
 *
 * These assert on structure, not exact whitespace — the point is to catch a
 * changed contract, not to freeze formatting.
 */
describe("renderMarkdown", () => {
  it("renders the basic constructs an article is made of", () => {
    const html = renderMarkdown(
      "# Title\n\nSome **bold** and *italic* text.\n\n## Section\n\nA paragraph.",
    );
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<p>");
  });

  it("renders links and images", () => {
    const html = renderMarkdown(
      "[a link](https://example.com)\n\n![alt text](https://example.com/i.png)",
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("a link");
    expect(html).toContain('src="https://example.com/i.png"');
    expect(html).toContain('alt="alt text"');
  });

  it("renders lists and blockquotes", () => {
    const html = renderMarkdown("- one\n- two\n\n> quoted\n\n1. first\n2. second");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<ol>");
  });

  it("highlights fenced code blocks via marked-highlight", () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```');
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    // highlight.js wraps tokens in hljs-* spans; losing these means the
    // marked-highlight extension silently stopped being applied.
    expect(html).toMatch(/hljs-/);
  });

  it("renders inline code without highlighting", () => {
    const html = renderMarkdown("use `npm run build` here");
    expect(html).toContain("<code>npm run build</code>");
  });

  it("honours breaks: true — a single newline becomes <br>", () => {
    // This is configured explicitly in markdown.ts. marked's default is the
    // opposite, so a major bump resetting it would silently reflow articles.
    const html = renderMarkdown("line one\nline two");
    expect(html).toContain("<br>");
  });

  it("strips script tags via DOMPurify", () => {
    // Articles are untrusted input from relays. This is the security boundary.
    const html = renderMarkdown('hello <script>alert("xss")</script> world');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
    expect(html).toContain("hello");
  });

  it("strips inline event handlers while keeping the element", () => {
    const html = renderMarkdown('<img src="x.png" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert(1)");
  });

  it("keeps id and class attributes, which are explicitly allowed", () => {
    const html = renderMarkdown('<div class="note" id="n1">text</div>');
    expect(html).toContain('class="note"');
    expect(html).toContain('id="n1"');
  });

  it("returns a string for empty input rather than throwing", () => {
    expect(typeof renderMarkdown("")).toBe("string");
  });
});
