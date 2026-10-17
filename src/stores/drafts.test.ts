import { describe, it, expect, beforeEach } from "vitest";
import { useDraftStore, isEmptyDraft } from "./drafts";

beforeEach(() => {
  localStorage.clear();
  useDraftStore.setState({ drafts: [], activeDraftId: null });
});

describe("drafts", () => {
  it("makes a draft from fields, as an edit of a published article keeps its address", () => {
    const id = useDraftStore.getState().createDraft({ title: "T", content: "c", dTag: "slug-1", publishedAt: 1_600_000_000 });
    const d = useDraftStore.getState().drafts[0];
    expect(d.id).toBe(id);
    expect(useDraftStore.getState().activeDraftId).toBe(id);
    expect(d).toMatchObject({ title: "T", content: "c", summary: "", dTag: "slug-1", publishedAt: 1_600_000_000 });
    expect(JSON.parse(localStorage.getItem("wrystr_article_drafts")!)[0].dTag).toBe("slug-1");
  });

  it("puts a deleted draft back once, where its date places it", () => {
    const store = useDraftStore.getState();
    const a = store.createDraft({ title: "A" });
    const b = store.createDraft({ title: "B" });
    const gone = useDraftStore.getState().drafts.find((d) => d.id === a)!;
    useDraftStore.getState().deleteDraft(a);
    expect(useDraftStore.getState().drafts.map((d) => d.id)).toEqual([b]);
    useDraftStore.getState().restoreDraft(gone);
    useDraftStore.getState().restoreDraft(gone);
    expect(useDraftStore.getState().drafts.map((d) => d.id)).toEqual([b, a]);
  });

  it("drops empty drafts and forgets an active one that was empty", () => {
    const store = useDraftStore.getState();
    const full = store.createDraft({ title: "Words" });
    const empty = store.createDraft();
    expect(useDraftStore.getState().activeDraftId).toBe(empty);
    useDraftStore.getState().pruneEmptyDrafts();
    expect(useDraftStore.getState().drafts.map((d) => d.id)).toEqual([full]);
    expect(useDraftStore.getState().activeDraftId).toBeNull();
    useDraftStore.getState().setActiveDraft(full);
    useDraftStore.getState().pruneEmptyDrafts();
    expect(useDraftStore.getState().activeDraftId).toBe(full);
  });

  it("calls a draft empty only when every field is blank", () => {
    expect(isEmptyDraft({ title: " ", content: "", summary: "", image: "", tags: "" })).toBe(true);
    expect(isEmptyDraft({ title: "", content: "", summary: "", image: "https://x", tags: "" })).toBe(false);
  });
});
