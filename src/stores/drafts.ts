import { create } from "zustand";

const STORAGE_KEY = "wrystr_article_drafts";
const ACTIVE_KEY = "wrystr_active_draft";
const OLD_DRAFT_KEY = "wrystr_article_draft";

export interface ArticleDraft {
  id: string;
  title: string;
  content: string;
  summary: string;
  image: string;
  tags: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Set when the draft is an edit of a published article: its `d` tag and its
   * first `published_at`. Publishing reuses both, so the article is replaced
   * (NIP-23 is replaceable for exactly this) instead of a second one minted.
   */
  dTag?: string;
  publishedAt?: number;
}

export type DraftFields = Pick<ArticleDraft, "title" | "content" | "summary" | "image" | "tags">;

/** A draft with nothing in it: never worth a row in the list or a count in the sidebar. */
export function isEmptyDraft(d: DraftFields): boolean {
  return !d.title.trim() && !d.content.trim() && !d.summary.trim() && !d.image.trim() && !d.tags.trim();
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadDrafts(): ArticleDraft[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }

  // Auto-migrate old single-draft format
  try {
    const old = localStorage.getItem(OLD_DRAFT_KEY);
    if (old) {
      const data = JSON.parse(old);
      if (data && (data.title || data.content)) {
        const migrated: ArticleDraft = {
          id: generateId(),
          title: data.title || "",
          content: data.content || "",
          summary: data.summary || "",
          image: data.image || "",
          tags: data.tags || "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify([migrated]));
        localStorage.removeItem(OLD_DRAFT_KEY);
        return [migrated];
      }
    }
  } catch { /* ignore */ }

  return [];
}

function saveDrafts(drafts: ArticleDraft[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

function loadActiveDraftId(): string | null {
  return localStorage.getItem(ACTIVE_KEY) || null;
}

function saveActiveDraftId(id: string | null) {
  if (id) {
    localStorage.setItem(ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

interface DraftState {
  drafts: ArticleDraft[];
  activeDraftId: string | null;
  /** A new draft, made active. `fields` for one that starts with something in it (an edit of a published article). */
  createDraft: (fields?: Partial<DraftFields> & Pick<ArticleDraft, "dTag" | "publishedAt">) => string;
  updateDraft: (id: string, fields: Partial<DraftFields>) => void;
  deleteDraft: (id: string) => void;
  /** Put a deleted draft back, as it was (Undo). */
  restoreDraft: (draft: ArticleDraft) => void;
  /** Drop every draft with nothing in it. Called when the editor is left. */
  pruneEmptyDrafts: () => void;
  setActiveDraft: (id: string | null) => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: loadDrafts(),
  activeDraftId: loadActiveDraftId(),

  createDraft: (fields) => {
    const id = generateId();
    const given = Object.fromEntries(Object.entries(fields ?? {}).filter(([, v]) => v !== undefined));
    const draft: ArticleDraft = {
      id,
      title: "",
      content: "",
      summary: "",
      image: "",
      tags: "",
      ...given,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [draft, ...get().drafts];
    set({ drafts: updated, activeDraftId: id });
    saveDrafts(updated);
    saveActiveDraftId(id);
    return id;
  },

  updateDraft: (id, fields) => {
    const updated = get().drafts.map((d) =>
      d.id === id ? { ...d, ...fields, updatedAt: Date.now() } : d
    );
    set({ drafts: updated });
    saveDrafts(updated);
  },

  deleteDraft: (id) => {
    const updated = get().drafts.filter((d) => d.id !== id);
    const activeId = get().activeDraftId === id ? null : get().activeDraftId;
    set({ drafts: updated, activeDraftId: activeId });
    saveDrafts(updated);
    saveActiveDraftId(activeId);
  },

  restoreDraft: (draft) => {
    const drafts = get().drafts;
    if (drafts.some((d) => d.id === draft.id)) return;
    // Back where its date places it, the others left in their order.
    const at = drafts.findIndex((d) => d.updatedAt < draft.updatedAt);
    const updated = at === -1 ? [...drafts, draft] : [...drafts.slice(0, at), draft, ...drafts.slice(at)];
    set({ drafts: updated });
    saveDrafts(updated);
  },

  pruneEmptyDrafts: () => {
    const { drafts, activeDraftId } = get();
    const kept = drafts.filter((d) => !isEmptyDraft(d));
    if (kept.length === drafts.length) return;
    const activeId = kept.some((d) => d.id === activeDraftId) ? activeDraftId : null;
    set({ drafts: kept, activeDraftId: activeId });
    saveDrafts(kept);
    saveActiveDraftId(activeId);
  },

  setActiveDraft: (id) => {
    set({ activeDraftId: id });
    saveActiveDraftId(id);
  },
}));
