import { create } from "zustand";

// Accounts whose secret key was made here and never copied out.
//
// The backup step lets a new account through with "I'll back up my key
// later", and nothing ever came back to it: Settings → Account is the
// twelfth of sixteen sections. The key then lived in this computer's
// keychain alone. This remembers who pressed "later", so a banner can ask
// until the key has been copied once, from the banner or from Settings.
//
// A leaf: the user store imports it. Per account, so one account's copy
// does not clear another's reminder.

const KEY = "wrystr_backup_pending";

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}
function save(pending: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch { /* remembered for this session all the same */ }
}

interface BackupState {
  /** Accounts still to back up, by pubkey. */
  pending: string[];
  /** The account's key has not been copied anywhere: ask until it is. */
  markPending: (pubkey: string) => void;
  /** The key was copied out, or the account is gone: nothing left to ask. */
  clearPending: (pubkey: string) => void;
}

export const useBackupStore = create<BackupState>((set, get) => ({
  pending: load(),
  markPending: (pubkey) => {
    if (get().pending.includes(pubkey)) return;
    const pending = [...get().pending, pubkey];
    save(pending);
    set({ pending });
  },
  clearPending: (pubkey) => {
    if (!get().pending.includes(pubkey)) return;
    const pending = get().pending.filter((p) => p !== pubkey);
    save(pending);
    set({ pending });
  },
}));
