import { create } from "zustand";
import { fetchReplaceableList, publishReplaceableList, type ListResult } from "../lib/nostr";
import { useToastStore } from "./toast";
import { forThisAccount } from "../lib/toastActions";
import { currentAccount, stillAccount } from "../lib/currentAccount";
import { tagValues, withListChanges, recordChange, hasChanges, noChanges, parseStoredChanges, type ListChanges, type ListSnapshot } from "../lib/lists";
import { parseStoredContactList } from "../lib/contacts";
import { debug } from "../lib/debug";

// The mute list (kind 10000) is a replaceable event, like the contact list,
// and was open to the same accident: the list as this device held it was
// published whole, over a longer one on the relays when the relays had not
// been read, with `content` (where other clients keep private mutes) written
// empty every time. Now, per account, this device keeps the relays' list as
// last read (the base) and a record of which people it muted or unmuted since
// (the changes). What is shown is the base with the changes applied; what is
// published is the same, built from the newest list the relays hold at that
// moment, and only once the relays have been read. See `lib/lists.ts` and
// the contact list section of CLAUDE.md.

const MUTE_KIND = 10000;
const KEYWORDS_KEY = "wrystr_muted_keywords";
/** The one list older builds kept for the whole computer; its entries become this account's changes, once. */
const LEGACY_KEY = "wrystr_mutes";
const baseKey = (pubkey: string) => `wrystr_mute_list_${pubkey}`;
const changesKey = (pubkey: string) => `wrystr_mute_changes_${pubkey}`;

function loadBase(pubkey: string): ListSnapshot | null {
  try { return parseStoredContactList(localStorage.getItem(baseKey(pubkey))); } catch { return null; }
}
function saveBase(pubkey: string, base: ListSnapshot): void {
  try { localStorage.setItem(baseKey(pubkey), JSON.stringify(base)); } catch { /* storage full: read again next time */ }
}
function loadChanges(pubkey: string): ListChanges {
  try { return parseStoredChanges(localStorage.getItem(changesKey(pubkey))); } catch { return {}; }
}
function saveChanges(pubkey: string, changes: ListChanges): void {
  try { localStorage.setItem(changesKey(pubkey), JSON.stringify(changes)); } catch { /* storage full: the change is shown, and lost at restart */ }
}

/** The mutes an older build kept, taken as this account's changes the first time it is seen here. */
function adoptLegacyMutes(pubkey: string): void {
  if (loadBase(pubkey) || hasChanges(loadChanges(pubkey))) return;
  let legacy: string[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    legacy = Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch { /* nothing to adopt */ }
  if (legacy.length === 0) return;
  let changes = noChanges();
  for (const pk of legacy) changes = recordChange(changes, "p", { add: pk });
  saveChanges(pubkey, changes);
}

/** What this account mutes, as this device knows it: the relays' list with this device's changes. */
function shown(pubkey: string): string[] {
  return tagValues(withListChanges(loadBase(pubkey)?.tags ?? [], loadChanges(pubkey)), "p");
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
  /** Who the current account mutes, as shown: the relays' list with this device's changes. */
  mutedPubkeys: string[];
  mutedKeywords: string[];
  /** The account `mutedPubkeys` is for; "" while nobody is signed in. */
  listFor: string;
  fetchMuteList: (pubkey: string) => Promise<void>;
  mute: (pubkey: string) => Promise<void>;
  unmute: (pubkey: string) => Promise<void>;
  addKeyword: (keyword: string) => void;
  removeKeyword: (keyword: string) => void;
  contentMatchesMutedKeyword: (content: string) => boolean;
}

const FAILED = "publish:mutes";
const NO_KEY = "Couldn't publish your mute list: you are not signed in with a key that can sign.";

// How many changes each account has made in this session. A publish clears
// the record only if none was made while it was on its way.
const revisions = new Map<string, number>();

function show(set: (patch: Partial<MuteState>) => void, pubkey: string): void {
  set({ mutedPubkeys: shown(pubkey), listFor: pubkey });
}

function sayNotPublished(pubkey: string, message: string): void {
  useToastStore.getState().addToast(message, "error", {
    key: FAILED,
    action: forThisAccount("Try again", () => void inTurn(() => reconcile(pubkey, "retry")), pubkey),
  });
}

// One round at a time, as for the podcast list: two rounds at once could
// each publish what they worked out from the same reading.
let turns: Promise<void> = Promise.resolve();
function inTurn(round: () => Promise<void>): Promise<void> {
  const quietly = () => round().catch((err) => { debug.warn("[Vega] Mute list could not be brought in line:", err); });
  turns = turns.then(quietly, quietly);
  return turns;
}

/**
 * The base after a read: the relays' list when it is newer than what this
 * device last published (older is a relay that has not caught up), an empty
 * list when every relay answered and none has one (this device's is then the
 * first), and what was read before when the relays could not tell. Null when
 * nothing is known at all.
 */
function settleBase(pubkey: string, read: ListResult): ListSnapshot | null {
  const base = loadBase(pubkey);
  if (read.status === "found" && (!base || read.list.createdAt >= base.createdAt)) { saveBase(pubkey, read.list); return read.list; }
  if (read.status === "none" && !base) { const first = { tags: [], content: "", createdAt: 0 }; saveBase(pubkey, first); return first; }
  return base;
}

/** `set` for the store, held here so `reconcile` can be called from a toast's action. */
let setState: (patch: Partial<MuteState>) => void = () => {};

/**
 * Bring this account's list and the relays' together: the one way the list
 * is read, and the one way a change made here goes out. At the start, a
 * moment after a change, and from "Try again".
 */
async function reconcile(pubkey: string, why: "start" | "change" | "retry"): Promise<void> {
  if (!stillAccount(pubkey)) return;
  if (why !== "start" && !hasChanges(loadChanges(pubkey))) return;

  let read: ListResult;
  try {
    read = await fetchReplaceableList(MUTE_KIND, pubkey);
  } catch (err) {
    debug.warn("[Vega] Failed to read the mute list:", err);
    read = { status: "unknown" };
  }
  if (!stillAccount(pubkey)) return;

  const known = settleBase(pubkey, read);
  show(setState, pubkey);
  if (!known) {
    // Could not tell what the relays hold, and nothing was read before:
    // nothing is published over a list that may well be there.
    if (why !== "start") sayNotPublished(pubkey, "Couldn't publish your mute list: the list on your relays could not be read. The change is kept on this device, and Vega will try again when it next starts.");
    return;
  }
  const base = known;

  const changes = loadChanges(pubkey);
  if (!hasChanges(changes)) return;
  const unmutes = Object.values(changes).some((c) => c.remove.length > 0);
  const revision = revisions.get(pubkey) ?? 0;
  const tags = withListChanges(base.tags, changes);
  try {
    const published = await publishReplaceableList(MUTE_KIND, tags, base.content);
    if (!stillAccount(pubkey)) return;
    const toasts = useToastStore.getState();
    if (!published) {
      // No key to sign with: nothing went out. A retry that ends like this
      // must not just close its toast and say nothing.
      if (why === "retry") toasts.addToast(NO_KEY, "error", { key: FAILED });
      return;
    }
    // Out. The record is cleared unless a change was made meanwhile; the
    // published list is the new base either way.
    if ((revisions.get(pubkey) ?? 0) === revision) saveChanges(pubkey, noChanges());
    saveBase(pubkey, { tags, content: base.content, createdAt: Math.floor(Date.now() / 1000) });
    show(setState, pubkey);
    toasts.removeByKey(FAILED);
    if (why === "retry") toasts.addToast("Mute list published.", "success");
  } catch {
    if (!stillAccount(pubkey)) return;
    sayNotPublished(pubkey, unmutes
      ? "Couldn't publish your mute list. The unmute is on this device only until it goes out; Vega will try again when it next starts."
      : "Couldn't publish your mute list. The mute is on this device only until it goes out; Vega will try again when it next starts.");
  }
}

// One publish for changes made in quick succession. Mute then Undo within a
// second made two lists with the same timestamp, and which of two such events
// a relay keeps is not defined.
let publishTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePublish(pubkey: string): void {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void inTurn(() => reconcile(pubkey, "change"));
  }, 1000);
}

function change(set: (patch: Partial<MuteState>) => void, who: string, c: { add: string } | { remove: string }): void {
  const pubkey = currentAccount() ?? "";
  saveChanges(pubkey, recordChange(loadChanges(pubkey), "p", c));
  revisions.set(pubkey, (revisions.get(pubkey) ?? 0) + 1);
  show(set, pubkey);
  // Nobody signed in: muted here, and nothing to publish it with.
  if (pubkey) schedulePublish(pubkey);
  void who;
}

export const useMuteStore = create<MuteState>((set, get) => {
  setState = set;
  return {
    mutedPubkeys: shown(currentAccount() ?? ""),
    mutedKeywords: loadKeywords(),
    listFor: currentAccount() ?? "",

    fetchMuteList: async (pubkey: string) => {
      adoptLegacyMutes(pubkey);
      // At once: what this device knows, so the last account's list is not shown for this one.
      show(set, pubkey);
      await inTurn(() => reconcile(pubkey, "start"));
    },

    mute: async (pubkey: string) => {
      if (get().mutedPubkeys.includes(pubkey)) return;
      change(set, pubkey, { add: pubkey });
    },

    unmute: async (pubkey: string) => {
      if (!get().mutedPubkeys.includes(pubkey)) return;
      change(set, pubkey, { remove: pubkey });
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
  };
});
