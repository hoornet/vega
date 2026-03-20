import { create } from "zustand";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { getNDK, publishContactList } from "../lib/nostr";
import { nip19 } from "@nostr-dev-kit/ndk";
import { invoke } from "@tauri-apps/api/core";
import { useMuteStore } from "./mute";
import { useLightningStore } from "./lightning";
import { useUIStore } from "./ui";
import { useNotificationsStore } from "./notifications";
import { useFeedStore } from "./feed";
import { startNotificationPoller, stopNotificationPoller } from "../lib/notificationPoller";

export interface SavedAccount {
  pubkey: string;
  npub: string;
  name?: string;
  picture?: string;
  loginType?: "nsec" | "pubkey";
}

// In-memory signer cache — survives account switches within a session.
// Keyed by pubkey hex. NOT persisted to localStorage; rebuilt on next login.
// This means the keychain is only ever consulted at startup (restoreSession),
// not on every switch, eliminating the "read-only after switch" class of bugs.
const _signerCache = new Map<string, NDKPrivateKeySigner>();

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

      // Cache signer in memory so switchAccount can reuse it without keychain
      _signerCache.set(pubkey, signer);

      // Update accounts list
      const accounts = upsertAccount(get().accounts, { pubkey, npub, loginType: "nsec" });
      persistAccounts(accounts);

      set({ pubkey, npub, loggedIn: true, loginError: null, accounts });

      // Persist active session
      localStorage.setItem("wrystr_pubkey", pubkey);
      localStorage.setItem("wrystr_login_type", "nsec");

      // Store nsec in OS keychain
      invoke<void>("store_nsec", { pubkey, nsec: nsecInput }).catch((err) => {
        console.warn("Failed to store nsec in OS keychain:", err);
      });

      // Load per-account NWC wallet
      useLightningStore.getState().loadNwcForAccount(pubkey);

      // Fetch profile, follows, mute list, and notifications
      get().fetchOwnProfile();
      get().fetchFollows();
      useMuteStore.getState().fetchMuteList(pubkey);
      useNotificationsStore.getState().fetchNotifications(pubkey);
      startNotificationPoller(pubkey);

      // Navigate to feed and refresh so the new account's content loads
      useUIStore.getState().setView("feed");
      useFeedStore.getState().loadFeed();
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
      const accounts = upsertAccount(get().accounts, { pubkey, npub, loginType: "pubkey" });
      persistAccounts(accounts);

      set({ pubkey, npub, loggedIn: true, loginError: null, accounts });

      localStorage.setItem("wrystr_pubkey", pubkey);
      localStorage.setItem("wrystr_login_type", "pubkey");

      // Load per-account NWC wallet
      useLightningStore.getState().loadNwcForAccount(pubkey);

      get().fetchOwnProfile();
      get().fetchFollows();
      useMuteStore.getState().fetchMuteList(pubkey);
      useNotificationsStore.getState().fetchNotifications(pubkey);
      startNotificationPoller(pubkey);

      useUIStore.getState().setView("feed");
      useFeedStore.getState().loadFeed();
    } catch (err) {
      set({ loginError: `Login failed: ${err}` });
    }
  },

  logout: () => {
    stopNotificationPoller();
    const ndk = getNDK();
    ndk.signer = undefined;
    // Don't delete the keychain entry — keep the account available for instant switch-back.
    localStorage.removeItem("wrystr_pubkey");
    localStorage.removeItem("wrystr_login_type");
    set({ pubkey: null, npub: null, profile: null, follows: [], loggedIn: false, loginError: null });
  },

  restoreSession: async () => {
    // Pre-populate signer cache for ALL nsec accounts so switchAccount
    // always hits the fast path (no keychain round-trip on every switch).
    const accounts = get().accounts;
    for (const acct of accounts) {
      if (acct.loginType !== "nsec" || _signerCache.has(acct.pubkey)) continue;
      try {
        const nsec = await invoke<string | null>("load_nsec", { pubkey: acct.pubkey });
        if (nsec) {
          let privkey: string;
          if (nsec.startsWith("nsec1")) {
            const decoded = nip19.decode(nsec);
            privkey = decoded.data as string;
          } else {
            privkey = nsec;
          }
          _signerCache.set(acct.pubkey, new NDKPrivateKeySigner(privkey));
        }
      } catch (err) {
        console.warn(`Failed to load nsec for ${acct.npub} from keychain:`, err);
      }
    }

    // Now restore the active account
    const savedPubkey = localStorage.getItem("wrystr_pubkey");
    const savedLoginType = localStorage.getItem("wrystr_login_type");
    if (!savedPubkey) return;

    if (savedLoginType === "pubkey") {
      await get().loginWithPubkey(savedPubkey);
      return;
    }

    if (savedLoginType === "nsec") {
      const cachedSigner = _signerCache.get(savedPubkey);
      if (cachedSigner) {
        getNDK().signer = cachedSigner;
        const npub = nip19.npubEncode(savedPubkey);
        set({ pubkey: savedPubkey, npub, loggedIn: true, loginError: null });
        localStorage.setItem("wrystr_pubkey", savedPubkey);
        localStorage.setItem("wrystr_login_type", "nsec");
        useLightningStore.getState().loadNwcForAccount(savedPubkey);
        get().fetchOwnProfile();
        get().fetchFollows();
        useMuteStore.getState().fetchMuteList(savedPubkey);
        useNotificationsStore.getState().fetchNotifications(savedPubkey);
        startNotificationPoller(savedPubkey);
      }
      // No keychain entry → stay logged out, user re-enters nsec once.
    }
  },

  switchAccount: async (pubkey: string) => {
    // Clear signer immediately — no window where old account could sign
    getNDK().signer = undefined;

    // Fast path: reuse in-memory signer cached from the login that added this
    // account earlier in this session. Avoids a round-trip to the OS keychain
    // and eliminates the "becomes read-only after switch" failure class.
    const cachedSigner = _signerCache.get(pubkey);
    if (cachedSigner) {
      getNDK().signer = cachedSigner;
      const account = get().accounts.find((a) => a.pubkey === pubkey);
      const npub = account?.npub ?? nip19.npubEncode(pubkey);
      set({ pubkey, npub, loggedIn: true, loginError: null });
      localStorage.setItem("wrystr_pubkey", pubkey);
      localStorage.setItem("wrystr_login_type", "nsec");
      useLightningStore.getState().loadNwcForAccount(pubkey);
      get().fetchOwnProfile();
      get().fetchFollows();
      useMuteStore.getState().fetchMuteList(pubkey);
      startNotificationPoller(pubkey);
      useUIStore.getState().setView("feed");
      return;
    }

    // Slow path: cache miss — try OS keychain
    let succeeded = false;
    try {
      const nsec = await invoke<string | null>("load_nsec", { pubkey });
      if (nsec) {
        await get().loginWithNsec(nsec);
        succeeded = !!getNDK().signer;
      }
    } catch (err) {
      console.warn("Keychain load failed during account switch:", err);
    }
    if (!succeeded) {
      const account = get().accounts.find((a) => a.pubkey === pubkey);
      if (account?.loginType === "pubkey") {
        // Deliberately read-only (npub) account — correct behavior
        await get().loginWithPubkey(pubkey);
      } else {
        // nsec account whose keychain entry was lost — update state to reflect
        // the target account (logged out) so the UI shows the correct account
        // with a login prompt, rather than staying stuck on the previous account.
        const npub = account?.npub ?? nip19.npubEncode(pubkey);
        set({ pubkey, npub, loggedIn: false, loginError: null, profile: null, follows: [] });
        localStorage.setItem("wrystr_pubkey", pubkey);
        localStorage.setItem("wrystr_login_type", "nsec");
      }
    }
    // Always land on feed to avoid stale UI from previous account's view
    useUIStore.getState().setView("feed");
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
