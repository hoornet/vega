import { create } from "zustand";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { getNDK, publishContactList } from "../lib/nostr";
import { nip19 } from "@nostr-dev-kit/ndk";
import { invoke } from "@tauri-apps/api/core";
import { useMuteStore } from "./mute";
import { useLightningStore } from "./lightning";

export interface SavedAccount {
  pubkey: string;
  npub: string;
  name?: string;
  picture?: string;
}

function loadSavedAccounts(): SavedAccount[] {
  try {
    return JSON.parse(localStorage.getItem("wrystr_accounts") ?? "[]");
  } catch {
    return [];
  }
}

function persistAccounts(accounts: SavedAccount[]) {
  localStorage.setItem("wrystr_accounts", JSON.stringify(accounts));
}

function upsertAccount(accounts: SavedAccount[], entry: SavedAccount): SavedAccount[] {
  const idx = accounts.findIndex((a) => a.pubkey === entry.pubkey);
  if (idx === -1) return [...accounts, entry];
  return accounts.map((a, i) => (i === idx ? { ...a, ...entry } : a));
}

interface UserState {
  pubkey: string | null;
  npub: string | null;
  profile: any | null;
  follows: string[];
  loggedIn: boolean;
  loginError: string | null;
  accounts: SavedAccount[];

  loginWithNsec: (nsec: string) => Promise<void>;
  loginWithPubkey: (pubkey: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => Promise<void>;
  switchAccount: (pubkey: string) => Promise<void>;
  removeAccount: (pubkey: string) => void;
  fetchOwnProfile: () => Promise<void>;
  fetchFollows: () => Promise<void>;
  follow: (pubkey: string) => Promise<void>;
  unfollow: (pubkey: string) => Promise<void>;
}

export const useUserStore = create<UserState>((set, get) => ({
  pubkey: null,
  npub: null,
  profile: null,
  follows: [],
  loggedIn: false,
  loginError: null,
  accounts: loadSavedAccounts(),

  loginWithNsec: async (nsecInput: string) => {
    try {
      set({ loginError: null });

      let privkey: string;

      // Handle both nsec and raw hex
      if (nsecInput.startsWith("nsec1")) {
        const decoded = nip19.decode(nsecInput);
        if (decoded.type !== "nsec") {
          throw new Error("Invalid nsec key");
        }
        privkey = decoded.data as string;
      } else {
        privkey = nsecInput;
      }

      const signer = new NDKPrivateKeySigner(privkey);
      const ndk = getNDK();
      ndk.signer = signer;

      const user = await signer.user();
      const pubkey = user.pubkey;
      const npub = nip19.npubEncode(pubkey);

      // Update accounts list
      const accounts = upsertAccount(get().accounts, { pubkey, npub });
      persistAccounts(accounts);

      set({ pubkey, npub, loggedIn: true, loginError: null, accounts });

      // Persist active session
      localStorage.setItem("wrystr_pubkey", pubkey);
      localStorage.setItem("wrystr_login_type", "nsec");

      // Store nsec in OS keychain (best-effort — gracefully ignored if unavailable)
      invoke<void>("store_nsec", { pubkey, nsec: nsecInput }).catch(() => {});

      // Load per-account NWC wallet
      useLightningStore.getState().loadNwcForAccount(pubkey);

      // Fetch profile, follows, and mute list
      get().fetchOwnProfile();
      get().fetchFollows();
      useMuteStore.getState().fetchMuteList(pubkey);
    } catch (err) {
      set({ loginError: `Login failed: ${err}` });
    }
  },

  loginWithPubkey: async (pubkeyInput: string) => {
    try {
      set({ loginError: null });

      let pubkey: string;

      if (pubkeyInput.startsWith("npub1")) {
        const decoded = nip19.decode(pubkeyInput);
        if (decoded.type !== "npub") {
          throw new Error("Invalid npub");
        }
        pubkey = decoded.data as string;
      } else {
        pubkey = pubkeyInput;
      }

      const npub = nip19.npubEncode(pubkey);

      // Update accounts list
      const accounts = upsertAccount(get().accounts, { pubkey, npub });
      persistAccounts(accounts);

      set({ pubkey, npub, loggedIn: true, loginError: null, accounts });

      localStorage.setItem("wrystr_pubkey", pubkey);
      localStorage.setItem("wrystr_login_type", "pubkey");

      // Load per-account NWC wallet
      useLightningStore.getState().loadNwcForAccount(pubkey);

      get().fetchOwnProfile();
      get().fetchFollows();
      useMuteStore.getState().fetchMuteList(pubkey);
    } catch (err) {
      set({ loginError: `Login failed: ${err}` });
    }
  },

  logout: () => {
    const ndk = getNDK();
    ndk.signer = undefined;
    // Don't delete the keychain entry — keep the account available for instant switch-back.
    localStorage.removeItem("wrystr_pubkey");
    localStorage.removeItem("wrystr_login_type");
    set({ pubkey: null, npub: null, profile: null, follows: [], loggedIn: false, loginError: null });
  },

  restoreSession: async () => {
    const savedPubkey = localStorage.getItem("wrystr_pubkey");
    const savedLoginType = localStorage.getItem("wrystr_login_type");
    if (!savedPubkey) return;

    if (savedLoginType === "pubkey") {
      await get().loginWithPubkey(savedPubkey);
      return;
    }

    if (savedLoginType === "nsec") {
      try {
        const nsec = await invoke<string | null>("load_nsec", { pubkey: savedPubkey });
        if (nsec) {
          await get().loginWithNsec(nsec);
        }
        // No keychain entry yet → stay logged out, user re-enters nsec once.
      } catch {
        // Keychain unavailable (e.g. no secret service on this Linux session) — stay logged out.
      }
    }
  },

  switchAccount: async (pubkey: string) => {
    // Clear signer immediately — no window where old account could sign
    getNDK().signer = undefined;
    // Try nsec from keychain first; fall back to read-only
    try {
      const nsec = await invoke<string | null>("load_nsec", { pubkey });
      if (nsec) {
        await get().loginWithNsec(nsec);
        return;
      }
    } catch {
      // Keychain unavailable
    }
    await get().loginWithPubkey(pubkey);
  },

  removeAccount: (pubkey: string) => {
    // Delete keychain entry (best-effort)
    invoke<void>("delete_nsec", { pubkey }).catch(() => {});

    const accounts = get().accounts.filter((a) => a.pubkey !== pubkey);
    persistAccounts(accounts);
    set({ accounts });

    // If removing the active account, clear the session
    if (get().pubkey === pubkey) {
      const ndk = getNDK();
      ndk.signer = undefined;
      localStorage.removeItem("wrystr_pubkey");
      localStorage.removeItem("wrystr_login_type");
      set({ pubkey: null, npub: null, profile: null, follows: [], loggedIn: false, loginError: null });
    }
  },

  fetchOwnProfile: async () => {
    const { pubkey } = get();
    if (!pubkey) return;

    try {
      const ndk = getNDK();
      const user = ndk.getUser({ pubkey });
      await user.fetchProfile();
      set({ profile: user.profile });

      // Update cached name/picture in accounts list
      const name = user.profile?.displayName || user.profile?.name;
      const picture = user.profile?.picture;
      const accounts = upsertAccount(get().accounts, { pubkey, npub: get().npub!, name, picture });
      persistAccounts(accounts);
      set({ accounts });
    } catch {
      // Profile fetch is non-critical
    }
  },

  fetchFollows: async () => {
    const { pubkey } = get();
    if (!pubkey) return;

    try {
      const ndk = getNDK();
      const user = ndk.getUser({ pubkey });
      const followSet = await user.follows();
      const follows = Array.from(followSet).map((u) => u.pubkey);
      set({ follows });
    } catch {
      // Non-critical
    }
  },

  follow: async (pubkey: string) => {
    const { follows } = get();
    if (follows.includes(pubkey)) return;
    const updated = [...follows, pubkey];
    set({ follows: updated });
    await publishContactList(updated);
  },

  unfollow: async (pubkey: string) => {
    const { follows } = get();
    const updated = follows.filter((pk) => pk !== pubkey);
    set({ follows: updated });
    await publishContactList(updated);
  },
}));
