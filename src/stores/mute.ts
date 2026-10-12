import { create } from "zustand";
import { fetchMuteList, publishMuteList } from "../lib/nostr";
import { useToastStore } from "./toast";
import { forThisAccount } from "../lib/toastActions";
import { currentAccount, stillAccount } from "../lib/currentAccount";

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

// One publish for changes made in quick succession. Mute then Undo within a
// second made two lists with the same timestamp, and which of two such events
// a relay keeps is decided by their ids, not by which came last.
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let batchUnmutes = false;
let batchAccount: string | null = null;
const FAILED = "publish:mutes";

function schedulePublish(get: () => MuteState, unmuted: boolean): void {
  // Whose list this is. Read now: by the time the pause is over the account
  // may have changed, and the list would be signed by whoever is there then.
  const account = currentAccount();
  // A batch belongs to one account. What the one before it did (an unmute)
  // must not word the failure of this one's mute.
  if (account !== batchAccount) batchUnmutes = false;
  batchAccount = account;
  batchUnmutes ||= unmuted;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    const unmutes = batchUnmutes;
    batchUnmutes = false;
    publishTimer = null;
    publishMutes(get, { unmutes, account });
  }, 1000);
}

/**
 * Publish the mute list as it stands now. Muting already works on this
 * device, so a failure changes nothing here, but it used to be swallowed:
 * the mute never reached the user's other devices and nothing said so.
 *
 * What is true of a failed mute is not true of a failed unmute. The next
 * load merges the relays' list with this device's, so someone unmuted only
 * here is muted again by it. The message says which.
 */
function publishMutes(get: () => MuteState, { unmutes, account, retry = false }: { unmutes: boolean; account: string | null; retry?: boolean }): void {
  // The account changed during the pause: this list is not the new account's
  // to sign, and would replace theirs.
  if (!stillAccount(account)) return;
  publishMuteList(get().mutedPubkeys).then(
    (published) => {
      if (!stillAccount(account)) return;
      const toasts = useToastStore.getState();
      if (!published) {
        // No key to sign with: nothing went out. A retry that ends like this
        // must not just close its toast and say nothing.
        if (retry) toasts.addToast("Couldn't publish your mute list: you are not signed in with a key that can sign.", "error", { key: FAILED });
        return;
      }
      // The list is out, so an earlier "couldn't publish" is no longer true.
      toasts.removeByKey(FAILED);
      // A retry that works must say so: the toast is gone and nothing else on screen changes.
      if (retry) toasts.addToast("Mute list published.", "success");
    },
    () => {
      if (!stillAccount(account)) return; // not the new account's failure to hear
      useToastStore.getState().addToast(
        unmutes
          ? "Couldn't publish your mute list. The unmute is on this device only, and may be undone the next time your list is loaded."
          : "Couldn't publish your mute list. The mute is on this device only.",
        "error",
        { key: FAILED, action: forThisAccount("Try again", () => publishMutes(get, { unmutes, account, retry: true }), account) },
      );
    },
  );
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
    schedulePublish(get, false);
  },

  unmute: async (pubkey: string) => {
    const updated = get().mutedPubkeys.filter((p) => p !== pubkey);
    set({ mutedPubkeys: updated });
    saveLocal(updated);
    schedulePublish(get, true);
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
