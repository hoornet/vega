import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

// The card: what a list says about an article before it is opened.

const signer = vi.hoisted(() => ({ canSign: true }));
vi.mock("../../stores/user", () => ({ useCanSign: () => signer.canSign }));
const WRITER = "ab".repeat(32);
vi.mock("../../hooks/useProfile", () => ({ useProfile: (pk: string) => (pk === "ab".repeat(32) ? { name: "Writer", picture: "https://x/pic.png" } : null) }));
const bookmarks = vi.hoisted(() => ({ saved: new Set<string>(), add: vi.fn(), remove: vi.fn() }));
vi.mock("../../stores/bookmark", () => {
  const state = { isArticleBookmarked: (addr: string) => bookmarks.saved.has(addr), addArticleBookmark: bookmarks.add, removeArticleBookmark: bookmarks.remove };
  const useBookmarkStore = Object.assign(<T,>(pick?: (s: typeof state) => T) => (pick ? pick(state) : state), { getState: () => state });
  return { useBookmarkStore };
});

import { ArticleCard } from "./ArticleCard";
import { useUIStore } from "../../stores/ui";

const article = (tags: string[][], content = "") =>
  ({ id: "ev1", kind: 30023, pubkey: WRITER, content, created_at: 1_700_000_000, tags: [["d", "post"], ...tags] }) as unknown as NDKEvent;
const ui = { openArticle: vi.fn(), openProfile: vi.fn(), openHashtag: vi.fn() };

beforeEach(() => {
  signer.canSign = true;
  bookmarks.saved.clear();
  bookmarks.add.mockClear(); bookmarks.remove.mockClear();
  Object.values(ui).forEach((f) => f.mockClear());
  useUIStore.setState(ui);
});
afterEach(cleanup);

describe("ArticleCard", () => {
  it("shows the byline, the title and the writer's summary, and opens the article from the card or the title", () => {
    render(<ArticleCard event={article([["title", "On relays"], ["summary", "Why they matter."]])} />);
    expect(screen.getByText("Writer")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "On relays" })).toBeTruthy();
    expect(screen.getByText("Why they matter.")).toBeTruthy();
    fireEvent.click(screen.getByText("Why they matter."));
    expect(ui.openArticle).toHaveBeenCalledTimes(1);
    expect(ui.openArticle.mock.calls[0][0]).toMatch(/^naddr1/);
    fireEvent.click(screen.getByRole("button", { name: "On relays" }));
    expect(ui.openArticle).toHaveBeenCalledTimes(2);
  });

  it("reads the summary from the body when the writer gave none, without the title", () => {
    render(<ArticleCard event={article([["title", "On relays"]], "# On relays\n\nRelays are where notes live. " + "More words. ".repeat(30))} />);
    const summary = screen.getByText(/^Relays are where notes live\./);
    expect(summary.textContent?.endsWith("…")).toBe(true);
    expect(summary.textContent).not.toContain("On relays");
  });

  it("shows at most two tags as text, which open the hashtag and not the article", () => {
    render(<ArticleCard event={article([["title", "T"], ["t", "nostr"], ["t", "vega"], ["t", "more"]])} />);
    expect(screen.getByRole("button", { name: "#nostr" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "#vega" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "#more" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "#vega" }));
    expect(ui.openHashtag).toHaveBeenCalledWith("vega");
    expect(ui.openArticle).not.toHaveBeenCalled();
  });

  it("opens the writer's profile from the byline, not the article", () => {
    render(<ArticleCard event={article([["title", "T"]])} />);
    fireEvent.click(screen.getByRole("button", { name: "Writer" }));
    expect(ui.openProfile).toHaveBeenCalledWith(WRITER);
    expect(ui.openArticle).not.toHaveBeenCalled();
  });

  it("leaves the writer out on their own profile, keeping the date", () => {
    render(<ArticleCard event={article([["title", "T"]])} showAuthor={false} />);
    expect(screen.queryByText("Writer")).toBeNull();
    expect(screen.getByText(/2023/)).toBeTruthy();
  });

  it("drops the cover, frame and all, when it fails to load", () => {
    const { container } = render(<ArticleCard event={article([["title", "T"], ["image", "https://x/cover.jpg"]])} />);
    const cover = container.querySelector('img[src="https://x/cover.jpg"]');
    expect(cover).toBeTruthy();
    fireEvent.error(cover!);
    expect(container.querySelector('img[src="https://x/cover.jpg"]')).toBeNull();
  });

  it("says the reading time", () => {
    render(<ArticleCard event={article([["title", "T"]], "word ".repeat(700))} />);
    expect(screen.getByText("4 min read")).toBeTruthy();
  });

  describe("Save", () => {
    it("is offered to an account that can sign, and saves or removes the article without opening it", () => {
      render(<ArticleCard event={article([["title", "T"]])} />);
      const save = screen.getByRole("button", { name: "Save to reading list" });
      expect(save.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(save);
      expect(bookmarks.add).toHaveBeenCalledWith(`30023:${WRITER}:post`);
      expect(ui.openArticle).not.toHaveBeenCalled();
    });

    it("reads as saved, and removes on a press", () => {
      bookmarks.saved.add(`30023:${WRITER}:post`);
      render(<ArticleCard event={article([["title", "T"]])} />);
      const save = screen.getByRole("button", { name: "Remove from reading list" });
      expect(save.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(save);
      expect(bookmarks.remove).toHaveBeenCalledWith(`30023:${WRITER}:post`);
    });

    it("is absent for a read-only account", () => {
      signer.canSign = false;
      render(<ArticleCard event={article([["title", "T"]])} />);
      expect(screen.queryByRole("button", { name: /reading list/ })).toBeNull();
    });
  });

  describe("reading-list state", () => {
    it("marks an unread article with a dot the screen reader hears, and reads a read one quietly", () => {
      const { rerender } = render(<ArticleCard event={article([["title", "T"]])} read={false} />);
      expect(screen.getByRole("button", { name: /Unread/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Unread/ }).textContent).toBe("Unread: T");
      expect(screen.getByRole("heading").className.split(" ")).toContain("text-text");
      rerender(<ArticleCard event={article([["title", "T"]])} read={true} />);
      expect(screen.queryByText(/Unread/)).toBeNull();
      expect(screen.getByRole("heading").className).toContain("text-text-muted");
    });

    it("shows neither when the list does not track it", () => {
      render(<ArticleCard event={article([["title", "T"]])} />);
      expect(screen.queryByText(/Unread/)).toBeNull();
      expect(screen.getByRole("heading").className.split(" ")).toContain("text-text");
    });

    it("takes more controls for its footer", () => {
      render(<ArticleCard event={article([["title", "T"]])} actions={<button>Mark read</button>} />);
      expect(screen.getByRole("button", { name: "Mark read" })).toBeTruthy();
    });
  });

  it("renders nothing for an event without an address", () => {
    const { container } = render(<ArticleCard event={{ id: "x", kind: 30023, pubkey: WRITER, content: "", tags: [["title", "T"]] } as unknown as NDKEvent} />);
    expect(container.textContent).toBe("");
  });
});
