import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

// The editor after the October 2026 UI review: a page, not a form; a publish
// sheet instead of a one-click Publish; drafts that exist once something is
// typed; an edit that keeps its address.

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFullscreen: async () => {} }) }));
vi.mock("../../lib/upload", () => ({ uploadBytes: vi.fn(), uploadImage: vi.fn() }));
vi.mock("../../stores/user", () => ({
  useCanSign: () => true,
  useUserStore: <T,>(pick: (s: { pubkey: string; follows: string[]; followsStatus: string }) => T) => pick({ pubkey: "ab".repeat(32), follows: [], followsStatus: "loaded" }),
}));
vi.mock("../../hooks/useProfile", () => ({ useProfile: () => ({ name: "Me" }) }));
vi.mock("../shared/LoginModal", () => ({ LoginModal: () => <div role="dialog">login</div> }));
const published = vi.hoisted(() => ({ calls: [] as unknown[], fail: false }));
vi.mock("../../lib/nostr", async () => {
  const { articleTags } = await import("../../lib/nostr/articles");
  const event = (fields: Parameters<typeof articleTags>[0], pubkey: string) => ({ id: "ev", kind: 30023, pubkey, content: fields.content, created_at: 1_700_000_000, tags: articleTags(fields, 1_700_000_000_000) }) as unknown as NDKEvent;
  return {
    previewArticleEvent: event,
    publishArticle: vi.fn(async (fields: Parameters<typeof articleTags>[0]) => {
      published.calls.push(fields);
      if (published.fail) throw new Error("Not enough relays received the event (0 published, 1 required)");
      return { relayCount: 2, event: event(fields, "ab".repeat(32)) };
    }),
  };
});

import { ArticleEditor } from "./ArticleEditor";
import { useDraftStore } from "../../stores/drafts";
import { useUIStore } from "../../stores/ui";
import { useToastStore } from "../../stores/toast";

const openArticle = vi.fn();
const drafts = () => useDraftStore.getState().drafts;
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  localStorage.clear();
  useDraftStore.setState({ drafts: [], activeDraftId: null });
  useToastStore.setState({ toasts: [] });
  useUIStore.setState({ openArticle });
  openArticle.mockClear();
  published.calls.length = 0; published.fail = false;
});
afterEach(cleanup);

describe("ArticleEditor", () => {
  it("opens on a blank page when there are no drafts, and has a draft once something is typed", async () => {
    render(<ArticleEditor />);
    expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(screen.queryByText(/No drafts/)).toBeNull();
    expect(drafts()).toHaveLength(0);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "First words" } });
    await waitFor(() => expect(drafts()).toHaveLength(1), { timeout: 3000 });
    expect(drafts()[0].title).toBe("First words");
    // Typing on keeps writing to the same draft.
    fireEvent.change(screen.getByRole("textbox", { name: "Body" }), { target: { value: "and a body" } });
    await waitFor(() => expect(drafts()[0].content).toBe("and a body"), { timeout: 3000 });
    expect(drafts()).toHaveLength(1);
  });

  it("writes in the reading face on the reader's page, with the toolbar above the title", () => {
    render(<ArticleEditor />);
    const body = screen.getByRole("textbox", { name: "Body" });
    expect(body.className).toContain("font-reading");
    expect(body.className).not.toContain("font-mono");
    expect(body.closest(".reader-page")).toBeTruthy();
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    const title = screen.getByRole("textbox", { name: "Title" });
    expect(toolbar.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mono" }));
    expect(screen.getByRole("textbox", { name: "Body" }).className).toContain("font-mono");
    expect(localStorage.getItem("wrystr_editor_mono")).toBe("true");
  });

  it("puts a heading mark at the start of the line, not at the caret", () => {
    useDraftStore.getState().createDraft({ title: "T", content: "My heading" });
    render(<ArticleEditor />);
    const body = screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement;
    body.setSelectionRange(10, 10);
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    expect(body.value).toBe("## My heading");
  });

  it("previews the article as the reader shows it", () => {
    useDraftStore.getState().createDraft({ title: "A title", content: "# A title\n\nSome **words**." });
    render(<ArticleEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.className).toContain("reader-title");
    expect(title.textContent).toBe("A title");
    const body = document.querySelector(".prose-article")!;
    expect(body.textContent?.trim()).toBe("Some words.");
    expect(body.querySelector("h1")).toBeNull();
  });

  describe("the publish sheet", () => {
    it("shows the card with a summary taken from the body, and publishes from its one button", async () => {
      useDraftStore.getState().createDraft({ title: "On relays", content: "Relays are where notes live. " + "More. ".repeat(10), tags: "nostr, vega" });
      render(<ArticleEditor />);
      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
      const sheet = screen.getByRole("dialog");
      expect(within(sheet).getByRole("heading", { name: "On relays" })).toBeTruthy();
      // The body's start is offered as the placeholder and used at publish; it is not written into the field.
      const summary = within(sheet).getByLabelText("Summary") as HTMLTextAreaElement;
      expect(summary.value).toBe("");
      expect(summary.placeholder.startsWith("Relays are where notes live.")).toBe(true);
      expect(within(sheet).getAllByText("#nostr").length).toBeGreaterThanOrEqual(1);
      fireEvent.click(within(sheet).getByRole("button", { name: "Publish now" }));
      await waitFor(() => expect(published.calls).toHaveLength(1));
      expect(published.calls[0]).toMatchObject({ title: "On relays", tags: ["nostr", "vega"], dTag: undefined });
      expect((published.calls[0] as { summary: string }).summary.startsWith("Relays are where")).toBe(true);
      await waitFor(() => expect(openArticle).toHaveBeenCalledTimes(1));
      expect(openArticle.mock.calls[0][0]).toMatch(/^naddr1/);
      expect(drafts()).toHaveLength(0);
      expect(toasts()).toContain("Article published to 2 relays.");
    });

    it("keeps the draft and says why when no relay took it", async () => {
      published.fail = true;
      useDraftStore.getState().createDraft({ title: "T", content: "body" });
      render(<ArticleEditor />);
      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish now" }));
      await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("Your draft is safe."));
      expect(drafts()).toHaveLength(1);
      expect(openArticle).not.toHaveBeenCalled();
    });

    it("saves details without publishing", () => {
      useDraftStore.getState().createDraft({ title: "T", content: "body" });
      render(<ArticleEditor />);
      fireEvent.click(screen.getByRole("button", { name: "Details" }));
      fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Tags"), { target: { value: "a, b" } });
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save details" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(published.calls).toHaveLength(0);
    });
  });

  it("publishes an edit of a published article at its own address", async () => {
    useDraftStore.getState().createDraft({ title: "Fixed title", content: "body", dTag: "my-post-1", publishedAt: 1_600_000_000 });
    render(<ArticleEditor />);
    expect(screen.getByText("Editing a published article")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish update" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish update" }));
    await waitFor(() => expect(published.calls).toHaveLength(1));
    expect(published.calls[0]).toMatchObject({ dTag: "my-post-1", publishedAt: 1_600_000_000 });
    await waitFor(() => expect(toasts()).toContain("Update published to 2 relays."));
  });

  describe("saving", () => {
    it("writes a new draft when the one it had is gone, instead of saving into nothing", async () => {
      render(<ArticleEditor />);
      fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "First" } });
      await waitFor(() => expect(drafts()).toHaveLength(1), { timeout: 3000 });
      // The draft disappears under the editor (pruned, or deleted from another view).
      useDraftStore.getState().deleteDraft(drafts()[0].id);
      expect(drafts()).toHaveLength(0);
      fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "First again" } });
      await waitFor(() => expect(drafts()).toHaveLength(1), { timeout: 3000 });
      expect(drafts()[0].title).toBe("First again");
    });

    it("keeps the last second of typing when the editor is left", async () => {
      const { unmount } = render(<ArticleEditor />);
      fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Quick" } });
      unmount();
      expect(drafts()).toHaveLength(1);
      expect(drafts()[0].title).toBe("Quick");
    });

    it("does not resurrect a published article as a draft when the editor closes", async () => {
      useDraftStore.getState().createDraft({ title: "T", content: "body" });
      const { unmount } = render(<ArticleEditor />);
      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish now" }));
      await waitFor(() => expect(openArticle).toHaveBeenCalled());
      expect(drafts()).toHaveLength(0);
      unmount();
      expect(drafts()).toHaveLength(0);
    });

    it("offers Drafts only when the list would have something in it, and saves before going", async () => {
      render(<ArticleEditor />);
      expect(screen.queryByRole("button", { name: "Drafts" })).toBeNull();
      fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Kept" } });
      await waitFor(() => expect(drafts()).toHaveLength(1), { timeout: 3000 });
      fireEvent.change(screen.getByRole("textbox", { name: "Body" }), { target: { value: "last second" } });
      fireEvent.click(screen.getByRole("button", { name: "Drafts" }));
      expect(drafts()[0].content).toBe("last second");
      expect(screen.getByRole("heading", { name: "Write Article" })).toBeTruthy();
    });
  });

  it("moves from the title to the body on Enter, and keeps the title on one line", () => {
    render(<ArticleEditor />);
    const title = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "Two\nlines" } });
    expect((title as HTMLTextAreaElement).value).toBe("Two lines");
    fireEvent.keyDown(title, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Body" }));
  });

  describe("the drafts list", () => {
    it("shows the drafts with an excerpt, and a deleted one can be brought back", () => {
      const store = useDraftStore.getState();
      store.createDraft({ title: "Older", content: "The older words." });
      store.createDraft({ title: "Newer", content: "# Newer\n\nThe newer words." });
      store.setActiveDraft(null);
      render(<ArticleEditor />);
      expect(screen.getByRole("heading", { name: "Write Article" })).toBeTruthy();
      expect(screen.getByText("The newer words.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Delete draft Older" }));
      expect(drafts().map((d) => d.title)).toEqual(["Newer"]);
      const toast = useToastStore.getState().toasts.find((t) => t.message === "Draft deleted.");
      expect(toast?.action?.label).toBe("Undo");
      toast!.action!.run();
      expect(drafts().map((d) => d.title).sort()).toEqual(["Newer", "Older"]);
    });

    it("gives two deletions two toasts, each undoing its own", () => {
      const store = useDraftStore.getState();
      store.createDraft({ title: "A", content: "a" });
      store.createDraft({ title: "B", content: "b" });
      store.setActiveDraft(null);
      render(<ArticleEditor />);
      fireEvent.click(screen.getByRole("button", { name: "Delete draft A" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete draft B" }));
      const undo = useToastStore.getState().toasts.filter((t) => t.message === "Draft deleted.");
      expect(undo).toHaveLength(2);
      undo[0].action!.run();
      expect(drafts().map((d) => d.title)).toEqual(["A"]);
    });

    it("opens a draft from its row, and Drafts leads back to the list without the empty ones", () => {
      const store = useDraftStore.getState();
      store.createDraft({ title: "Kept", content: "words" });
      store.createDraft();
      render(<ArticleEditor />);
      // The active, empty draft opens in the editor.
      expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Drafts" }));
      expect(drafts().map((d) => d.title)).toEqual(["Kept"]);
      fireEvent.click(screen.getByRole("button", { name: "Kept" }));
      expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Kept");
    });
  });
});
