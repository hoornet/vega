import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

// The reader, after the October 2026 UI review: icon buttons in the header, a
// title the body does not repeat, read when read, the comment box where the
// button is, and the writer and their other articles at the end.

const signer = vi.hoisted(() => ({ canSign: true, pubkey: "me" as string | null }));
vi.mock("../../stores/user", () => ({
  useCanSign: () => signer.canSign,
  useUserStore: <T,>(pick: (s: { pubkey: string | null; follows: string[]; followsStatus: string }) => T) => pick({ pubkey: signer.pubkey, follows: [], followsStatus: "loaded" }),
}));
vi.mock("../../hooks/useProfile", () => ({ useProfile: (pk: string) => (pk === "writer" ? { name: "Writer", about: "Writes about relays.\n\nAnd more." } : null) }));
const bookmarks = vi.hoisted(() => ({ markArticleRead: vi.fn(), saved: new Set<string>() }));
vi.mock("../../stores/bookmark", () => {
  const state = {
    markArticleRead: bookmarks.markArticleRead,
    isArticleBookmarked: (addr: string) => bookmarks.saved.has(addr), isBookmarked: () => false,
    addArticleBookmark: vi.fn(), removeArticleBookmark: vi.fn(), addBookmark: vi.fn(), removeBookmark: vi.fn(),
  };
  return { useBookmarkStore: <T,>(pick?: (s: typeof state) => T) => (pick ? pick(state) : state) };
});
const relays = vi.hoisted(() => ({ others: [] as unknown[] }));
vi.mock("../../lib/nostr", () => ({
  fetchArticle: vi.fn(),
  fetchAuthorArticles: vi.fn(async () => { const { recordFetchOutcome } = await import("../../lib/nostr/fetchTotals"); recordFetchOutcome(true); return relays.others; }),
  publishReaction: vi.fn(), publishRepost: vi.fn(), publishNote: vi.fn(),
}));
const copied = vi.hoisted(() => ({ text: "" }));
vi.mock("../../lib/clipboard", () => ({ copyText: async (text: string) => { copied.text = text; return true; } }));
vi.mock("../../lib/publishFeedback", () => ({ tellPublish: async (run: () => Promise<unknown>) => { await run(); return { ok: true }; } }));
vi.mock("../zap/ZapModal", () => ({ ZapModal: () => <div role="dialog">zap</div> }));
vi.mock("../shared/FollowButton", () => ({ FollowButton: ({ pubkey }: { pubkey: string }) => <button>Follow {pubkey}</button> }));
vi.mock("./ArticleCard", () => ({ ArticleCard: ({ event }: { event: NDKEvent }) => <article data-testid="more">{event.tags.find((t) => t[0] === "title")?.[1]}</article> }));

import { ArticleView } from "./ArticleView";
import { useUIStore } from "../../stores/ui";

const article = (d: string, tags: string[][], content: string) =>
  ({ id: `id-${d}`, kind: 30023, pubkey: "writer", content, created_at: 1_700_000_000, tags: [["d", d], ...tags] }) as unknown as NDKEvent;
const MAIN = article("post", [["title", "On relays"], ["summary", "Why they matter."], ["image", "https://x/cover.jpg"], ["t", "nostr"]], "# On relays\n\nRelays are where notes live.\n\n## Why\n\nBecause.\n\n## How\n\nLike so.");

function open(event: NDKEvent) {
  useUIStore.setState({ pendingArticleNaddr: "naddr1test", pendingArticleEvent: event, goBack: vi.fn() });
  return render(<ArticleView />);
}
const scroller = () => screen.getByRole("heading", { level: 1 }).closest(".overflow-y-auto") as HTMLElement;
// jsdom lays nothing out, so every element is 0 by 0. Give the pane a size for the test.
function layout(scrollHeight: number, clientHeight: number) {
  const proto = HTMLElement.prototype;
  const before = { s: Object.getOwnPropertyDescriptor(proto, "scrollHeight"), c: Object.getOwnPropertyDescriptor(proto, "clientHeight") };
  Object.defineProperty(proto, "scrollHeight", { get: () => scrollHeight, configurable: true });
  Object.defineProperty(proto, "clientHeight", { get: () => clientHeight, configurable: true });
  return () => {
    if (before.s) Object.defineProperty(proto, "scrollHeight", before.s); else delete (proto as unknown as Record<string, unknown>).scrollHeight;
    if (before.c) Object.defineProperty(proto, "clientHeight", before.c); else delete (proto as unknown as Record<string, unknown>).clientHeight;
  };
}
function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  fireEvent.scroll(el);
}

beforeEach(() => {
  signer.canSign = true; signer.pubkey = "me";
  bookmarks.markArticleRead.mockClear(); bookmarks.saved.clear();
  relays.others = [];
  copied.text = "";
});
afterEach(cleanup);

describe("ArticleView", () => {
  it("has icon buttons in its header, each named", () => {
    open(MAIN);
    for (const name of ["Save to reading list", "Zap Writer", "Repost", "Comment", "Copy link"]) {
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("offers a read-only account only the link", () => {
    signer.canSign = false;
    open(MAIN);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Repost" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Zap/ })).toBeNull();
  });

  it("copies a web link, which opens anywhere", async () => {
    open(MAIN);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(copied.text).toBe("https://njump.me/naddr1test"));
  });

  it("does not repeat the title as the body's first heading", () => {
    open(MAIN);
    expect(screen.getAllByText("On relays")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("On relays");
    expect(screen.getByRole("heading", { level: 2, name: "Why" })).toBeTruthy();
  });

  it("shows the standfirst, then the writer, then the cover, then the text", () => {
    open(MAIN);
    const title = screen.getByRole("heading", { level: 1 });
    const standfirst = screen.getByText("Why they matter.");
    const byline = screen.getAllByRole("button", { name: "Writer" })[0];
    const cover = document.querySelector('img[src="https://x/cover.jpg"]')!;
    const body = screen.getByText("Relays are where notes live.");
    const order = [title, standfirst, byline, cover, body];
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("drops a cover that fails to load", () => {
    open(MAIN);
    fireEvent.error(document.querySelector('img[src="https://x/cover.jpg"]')!);
    expect(document.querySelector('img[src="https://x/cover.jpg"]')).toBeNull();
  });

  describe("read", () => {
    let restore = () => {};
    beforeEach(() => { restore = layout(2000, 500); });
    afterEach(() => restore());

    it("is not marked on open", () => {
      open(MAIN);
      scrollTo(scroller(), 0);
      expect(bookmarks.markArticleRead).not.toHaveBeenCalled();
    });

    it("is marked once the reader is 90% of the way down, once", () => {
      open(MAIN);
      const el = scroller();
      scrollTo(el, 1000);
      expect(bookmarks.markArticleRead).not.toHaveBeenCalled();
      scrollTo(el, 1350);
      expect(bookmarks.markArticleRead).toHaveBeenCalledWith("30023:writer:post");
      scrollTo(el, 1400);
      expect(bookmarks.markArticleRead).toHaveBeenCalledTimes(1);
    });

    it("is marked on open when the whole article fits the pane", () => {
      restore(); restore = layout(500, 500);
      open(MAIN);
      expect(bookmarks.markArticleRead).toHaveBeenCalledWith("30023:writer:post");
    });
  });

  it("opens the comment box under the footer, not at the top", async () => {
    open(MAIN);
    expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
    const footer = screen.getAllByRole("button", { name: "Back" })[1];
    fireEvent.click(screen.getAllByRole("button", { name: "Comment" })[1]);
    const box = screen.getByRole("textbox", { name: "Comment" });
    expect(footer.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("ends with the writer: name, bio on one line, Follow and Zap", () => {
    open(MAIN);
    const card = screen.getByRole("region", { name: "About the writer" });
    expect(card.textContent).toContain("Writer");
    expect(card.textContent).toContain("Writes about relays. And more.");
    expect(screen.getByRole("button", { name: "Follow writer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zap" })).toBeTruthy();
  });

  it("offers up to three more articles by the writer, not this one, newest first", async () => {
    relays.others = [
      MAIN,
      article("a", [["title", "A"], ["published_at", "100"]], "x"),
      article("b", [["title", "B"], ["published_at", "400"]], "x"),
      article("c", [["title", "C"], ["published_at", "300"]], "x"),
      article("d", [["title", "D"], ["published_at", "200"]], "x"),
    ];
    open(MAIN);
    await waitFor(() => expect(screen.getAllByTestId("more")).toHaveLength(3));
    expect(screen.getAllByTestId("more").map((e) => e.textContent)).toEqual(["B", "C", "D"]);
    expect(screen.getByRole("heading", { name: "More from Writer" })).toBeTruthy();
  });

  it("says nothing about more articles when there are none", async () => {
    open(MAIN);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByText(/More from/)).toBeNull();
  });

  it("lists the contents beside the text when there are two or more headings", () => {
    open(MAIN);
    const nav = screen.getByRole("navigation", { name: "Contents" });
    expect(nav.textContent).toContain("Why");
    expect(nav.textContent).toContain("How");
  });
});
