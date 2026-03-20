import { create } from "zustand";
import { fetchMuteList, publishMuteList } from "../lib/nostr";

const STORAGE_KEY = "wrystr_mutes";
const KEYWORDS_KEY = "wrystr_muted_keywords";

function loadLocal(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveLocal(pubkeys: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pubkeys));
}

function loadKeywords(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEYWORDS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveKeywords(keywords: string[]) {
  localStorage.setItem(KEYWORDS_KEY, JSON.stringify(keywords));
}

// Build word-boundary regexes for single words, substring match for phrases
function buildKeywordMatchers(keywords: string[]): Array<(content: string) => boolean> {
  return keywords.map((kw) => {
    const lower = kw.toLowerCase();
    if (/\s/.test(lower)) {
      // Phrase — substring match
      return (content: string) => content.toLowerCase().includes(lower);
    }
    // Single word — word boundary match
    const re = new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return (content: string) => re.test(content);
  });
}

interface MuteState {
  mutedPubkeys: string[];
  mutedKeywords: string[];
  fetchMuteList: (pubkey: string) => Promise<void>;
  mute: (pubkey: string) => Promise<void>;
  unmute: (pubkey: string) => Promise<void>;
  addKeyword: (keyword: string) => void;
  removeKeyword: (keyword: string) => void;
  contentMatchesMutedKeyword: (content: string) => boolean;
}

export const useMuteStore = create<MuteState>((set, get) => ({
  mutedPubkeys: loadLocal(),
  mutedKeywords: loadKeywords(),

  fetchMuteList: async (pubkey: string) => {
    try {
      const pubkeys = await fetchMuteList(pubkey);
      if (pubkeys.length === 0) return;
      const local = get().mutedPubkeys;
      const merged = Array.from(new Set([...pubkeys, ...local]));
      set({ mutedPubkeys: merged });
      saveLocal(merged);
    } catch {
      // Non-critical — local mutes still work
    }
  },

  mute: async (pubkey: string) => {
    const { mutedPubkeys } = get();
    if (mutedPubkeys.includes(pubkey)) return;
    const updated = [...mutedPubkeys, pubkey];
    set({ mutedPubkeys: updated });
    saveLocal(updated);
    publishMuteList(updated).catch(() => {});
  },

  unmute: async (pubkey: string) => {
    const updated = get().mutedPubkeys.filter((p) => p !== pubkey);
    set({ mutedPubkeys: updated });
    saveLocal(updated);
    publishMuteList(updated).catch(() => {});
  },

  addKeyword: (keyword: string) => {
    const trimmed = keyword.trim().toLowerCase();
    if (trimmed.length < 2) return;
    const { mutedKeywords } = get();
    if (mutedKeywords.includes(trimmed)) return;
    const updated = [...mutedKeywords, trimmed];
    set({ mutedKeywords: updated });
    saveKeywords(updated);
  },

  removeKeyword: (keyword: string) => {
    const updated = get().mutedKeywords.filter((k) => k !== keyword);
    set({ mutedKeywords: updated });
    saveKeywords(updated);
  },

  contentMatchesMutedKeyword: (content: string) => {
    const { mutedKeywords } = get();
    if (mutedKeywords.length === 0) return false;
    const matchers = buildKeywordMatchers(mutedKeywords);
    return matchers.some((match) => match(content));
  },
}));
