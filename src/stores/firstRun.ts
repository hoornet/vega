import { create } from "zustand";

// An account made in Vega gets a "start here" card on the feed until it is
// dismissed or done (`StartHereCard`). Per account, because one person can
// make a second account on the same computer. A store, not a bare
// localStorage read: the card is already on screen when the account is made
// from inside the app, and has to hear about it.

const STORAGE_KEY = "wrystr_first_run";
const HELLO_KEY = "wrystr_first_run_hello";

/** Three follows: enough for a Following tab that shows something. */
export const FOLLOWS_TO_START = 3;

function load(key = STORAGE_KEY): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function save(accounts: string[], key = STORAGE_KEY): void {
  try { localStorage.setItem(key, JSON.stringify(accounts)); } catch { /* storage full: the card may show again, nothing lost */ }
}

interface FirstRunState {
  /** Accounts made here whose card has not been dismissed or completed. */
  accounts: string[];
  /** Accounts that have posted a note from here: the card's "Say hello" is done. */
  hello: string[];
  mark: (pubkey: string) => void;
  end: (pubkey: string) => void;
  markHello: (pubkey: string) => void;
}

export const useFirstRunStore = create<FirstRunState>((set, get) => ({
  accounts: load(),
  hello: load(HELLO_KEY),
  markHello: (pubkey) => {
    // Only for an account with a card: nothing to remember for the others.
    if (!get().accounts.includes(pubkey) || get().hello.includes(pubkey)) return;
    const hello = [...get().hello, pubkey];
    save(hello, HELLO_KEY);
    set({ hello });
  },
  mark: (pubkey) => {
    if (get().accounts.includes(pubkey)) return;
    const accounts = [...get().accounts, pubkey];
    save(accounts);
    set({ accounts });
  },
  end: (pubkey) => {
    if (!get().accounts.includes(pubkey)) return;
    const accounts = get().accounts.filter((p) => p !== pubkey);
    const hello = get().hello.filter((p) => p !== pubkey);
    save(accounts);
    save(hello, HELLO_KEY);
    set({ accounts, hello });
  },
}));

export const markFirstRun = (pubkey: string): void => useFirstRunStore.getState().mark(pubkey);
export const endFirstRun = (pubkey: string): void => useFirstRunStore.getState().end(pubkey);
export const isFirstRun = (pubkey: string): boolean => useFirstRunStore.getState().accounts.includes(pubkey);
export const markSaidHello = (pubkey: string): void => useFirstRunStore.getState().markHello(pubkey);
