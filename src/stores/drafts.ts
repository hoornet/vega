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
  createDraft: () => string;
  updateDraft: (id: string, fields: Partial<Pick<ArticleDraft, "title" | "content" | "summary" | "image" | "tags">>) => void;
  deleteDraft: (id: string) => void;
  setActiveDraft: (id: string | null) => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: loadDrafts(),
  activeDraftId: loadActiveDraftId(),

  createDraft: () => {
    const id = generateId();
    const draft: ArticleDraft = {
      id,
      title: "",
      content: "",
      summary: "",
      image: "",
      tags: "",
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

  setActiveDraft: (id) => {
    set({ activeDraftId: id });
    saveActiveDraftId(id);
  },
}));
