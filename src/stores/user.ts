import { create } from "zustand";
import { NDKPrivateKeySigner, NDKNip46Signer } from "@nostr-dev-kit/ndk";
import { getNDK, publishContactList, fetchContactList } from "../lib/nostr";
import {
  contactPubkeys,
  newerContactList,
  nextContactTags,
  parseStoredContactList,
  type ContactListResult,
  type ContactListSnapshot,
} from "../lib/contacts";
import {
  acceptSecretEchoAsAck,
  connectWithTimeout,
  explainBunkerConnectError,
  forgetPendingClientKey,
  pendingClientKeyFor,
  rememberPendingClientKey,
} from "../lib/nostr/nip46";
import { authenticatedRelayUrls, rechallengeRelays, setOwnDMRelayUrls } from "../lib/nostr/relayAuth";
import { clearDecryptedDMCache } from "../lib/nostr/dms";
import { useToastStore } from "./toast";
import { explainPublicKeyError, explainSecretKeyError } from "../lib/loginErrors";
import { nip19 } from "@nostr-dev-kit/ndk";
import { invoke } from "@tauri-apps/api/core";
import { useMuteStore } from "./mute";
import { useLightningStore } from "./lightning";
import { useUIStore } from "./ui";
import { useNotificationsStore } from "./notifications";
import { useFeedStore } from "./feed";
import { usePodcastStore } from "./podcast";
import { startNotificationPoller, stopNotificationPoller } from "../lib/notificationPoller";
import { dbLoadProfile } from "../lib/db";
import { debug } from "../lib/debug";

/**
 * Bounce every relay currently holding an authenticated session.
 *
 * There is no "un-AUTH" in NIP-42 — the only way to stop a relay treating this
 * connection as the previous identity is to drop the connection. Called on any
 * change of who we are.
 */
function dropAuthenticatedSessions(): void {
  const instance = getNDK();
  rechallengeRelays(instance, authenticatedRelayUrls(instance));
  // Decrypted messages are cached by gift-wrap id, which says nothing about
  // whose messages they are — so they must not outlive the identity that could
  // read them. See #61.
  clearDecryptedDMCache();
  // The previous identity's published DM relays widened the AUTH scope; the new
  // identity must not inherit that. Repopulated on the next DM fetch. See #49.
  setOwnDMRelayUrls([]);
}

export interface SavedAccount {
  pubkey: string;
  npub: string;
  name?: string;
  picture?: string;
  loginType?: "nsec" | "pubkey" | "remote-signer";
  signerPayload?: string;
}

// In-memory signer cache — survives account switches within a session.
// Keyed by pubkey hex. NOT persisted to localStorage; rebuilt on next login.
// This means the keychain is only ever consulted at startup (restoreSession),
// not on every switch, eliminating the "read-only after switch" class of bugs.
const _signerCache = new Map<string, NDKPrivateKeySigner>();
const _nip46SignerCache = new Map<string, NDKNip46Signer>();

/**
 * NDK rejects a failed NIP-46 `connect` with the raw `error` field, which is
 * `undefined` whenever the bunker replied without one — so an unguarded message
 * reads "undefined" to the user.
 */
function nip46RestoreError(err: unknown): string {
  const reason = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return `Remote signer didn't reconnect${reason ? `: ${reason}` : ""} — you're read-only until it does.`;
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

export type FollowsStatus = "idle" | "loading" | "loaded" | "unknown";

// The newest contact list known for the active account in this session, either
// fetched from a relay or published by us. It is the only thing a follow or
// unfollow may be applied to. Keyed by pubkey so one account's list can never
// become the base for another's after an account switch.
let _contactBase: { pubkey: string; list: ContactListSnapshot } | null = null;
// Which account `follows` currently describes.
let _followsOwner: string | null = null;
// The account whose relays have confirmed, in this session, that it has no
// contact list at all. Only then may a first follow start a new one.
let _noListConfirmedFor: string | null = null;
// Follow and unfollow run one at a time. Two changes built from the same list
// and published one after the other would each drop the other's edit.
let _followChain: Promise<void> = Promise.resolve();
let _followsRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _followsRetryCount = 0;
/** Automatic retries after the relays could not tell us; "Try again" restarts the ladder. */
const FOLLOWS_RETRY_DELAYS_MS = [4000, 10000, 30000];

// The last contact list this device saw for each account, kept across restarts.
// It makes the list available at once on startup, and it is the reason a relay
// outage cannot shrink it: if the relays return nothing, or cannot tell, the
// app still knows what the list was and builds on that.
const CONTACT_LIST_CACHE_PREFIX = "wrystr_contact_list_";

function loadCachedContactList(pubkey: string): ContactListSnapshot | null {
  try {
    return parseStoredContactList(localStorage.getItem(CONTACT_LIST_CACHE_PREFIX + pubkey));
  } catch {
    return null;
  }
}

function saveCachedContactList(pubkey: string, list: ContactListSnapshot): void {
  try {
    localStorage.setItem(CONTACT_LIST_CACHE_PREFIX + pubkey, JSON.stringify(list));
  } catch {
    // Storage full or unavailable: the cache is a safety net, never a requirement.
  }
}

function clearFollowsRetry(): void {
  if (_followsRetryTimer) clearTimeout(_followsRetryTimer);
  _followsRetryTimer = null;
}

/** Forget everything about the previous account's contact list. */
function forgetContactList(): void {
  clearFollowsRetry();
  _followsRetryCount = 0;
  _contactBase = null;
  _followsOwner = null;
  _noListConfirmedFor = null;
}

/**
 * Point the follow state at `pubkey`, starting from what this device remembers
 * about that account and nothing else. Whatever was on screen belonged to the
 * previous account and is dropped here, before any relay is asked.
 */
function beginFollowsFor(pubkey: string): void {
  _followsOwner = pubkey;
  _followsRetryCount = 0;
  _noListConfirmedFor = null;
  const cached = loadCachedContactList(pubkey);
  _contactBase = cached ? { pubkey, list: cached } : null;
  useUserStore.setState(
    cached
      ? { follows: contactPubkeys(cached.tags), followsStatus: "loaded" }
      : { follows: [], followsStatus: "loading" },
  );
}

interface UserState {
  pubkey: string | null;
  npub: string | null;
  profile: any | null;
  follows: string[];
  /**
   * Whether `follows` reflects a contact list that actually loaded. An empty
   * `follows` means "follows nobody" only when this is "loaded"; "unknown"
   * means the relays did not all answer and none returned a list.
   */
  followsStatus: FollowsStatus;
  loggedIn: boolean;
  loginError: string | null;
  accounts: SavedAccount[];

  loginWithNsec: (nsec: string) => Promise<void>;
  loginWithPubkey: (pubkey: string) => Promise<void>;
  loginWithRemoteSigner: (bunkerUri: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => Promise<void>;
  switchAccount: (pubkey: string) => Promise<void>;
  removeAccount: (pubkey: string) => void;
  fetchOwnProfile: () => Promise<void>;
  fetchFollows: () => Promise<void>;
  follow: (pubkey: string) => Promise<void>;
  unfollow: (pubkey: string) => Promise<void>;
}

/** Returns true iff the active account can sign events (has a signer attached). */
export function useCanSign(): boolean {
  return useUserStore((s) => {
    if (!s.loggedIn || !s.pubkey) return false;
    const account = s.accounts.find((a) => a.pubkey === s.pubkey);
    return account?.loginType !== "pubkey";
  });
}

export const useUserStore = create<UserState>((set, get) => ({
  pubkey: null,
  npub: null,
  profile: null,
  follows: [],
  followsStatus: "idle",
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

      // Store nsec in OS keychain. If that fails the key lives only in this
      // session: the next launch finds no keychain entry and the user is
      // signed out. For someone who created the account here and chose to
      // back up later, that would be the end of the account, so it must be
      // said out loud, not left in a development-only log.
      invoke<void>("store_nsec", { pubkey, nsec: nsecInput }).catch((err) => {
        debug.warn("Failed to store nsec in OS keychain:", err);
        useToastStore.getState().addToast(
          "Vega couldn't save your secret key to this computer's keychain. You will be signed out when Vega closes. Copy your key now from Settings, under Identity.",
          "warning",
          20000,
        );
      });

      // Load per-account NWC wallet
      useLightningStore.getState().loadNwcForAccount(pubkey);

      // Fetch profile, follows, mute list, and notifications
      get().fetchOwnProfile();
      get().fetchFollows();
      useMuteStore.getState().fetchMuteList(pubkey);
      useNotificationsStore.getState().fetchNotifications(pubkey);
      startNotificationPoller(pubkey);
      usePodcastStore.getState().setActiveAccount(pubkey);
      usePodcastStore.getState().hydrateSubscriptions(pubkey);

      // Navigate to feed and refresh so the new account's content loads
      useUIStore.getState().setView("feed");
      useFeedStore.getState().loadFeed();
    } catch (err) {
      debug.warn("Secret key login failed:", err);
      set({ loginError: explainSecretKeyError(nsecInput) });
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
      usePodcastStore.getState().setActiveAccount(pubkey);
      usePodcastStore.getState().hydrateSubscriptions(pubkey);

      useUIStore.getState().setView("feed");
      useFeedStore.getState().loadFeed();
    } catch (err) {
      debug.warn("Public key login failed:", err);
      set({ loginError: explainPublicKeyError(pubkeyInput) });
    }
  },

  loginWithRemoteSigner: async (bunkerUri: string) => {
    try {
      set({ loginError: null });

      const ndk = getNDK();
      const uri = bunkerUri.trim();
      const signer = NDKNip46Signer.bunker(ndk, uri, pendingClientKeyFor(uri));
      rememberPendingClientKey(uri, signer.localSigner.privateKey);
      acceptSecretEchoAsAck(signer);

      const user = await connectWithTimeout(signer);

      ndk.signer = signer;
      const pubkey = user.pubkey;
      const npub = nip19.npubEncode(pubkey);

      _nip46SignerCache.set(pubkey, signer);

      // The client key now lives in the account's signerPayload; drop the scratch copy.
      forgetPendingClientKey();

      const signerPayload = signer.toPayload();
      const accounts = upsertAccount(get().accounts, { pubkey, npub, loginType: "remote-signer", signerPayload });
      persistAccounts(accounts);

      set({ pubkey, npub, loggedIn: true, loginError: null, accounts });

      localStorage.setItem("wrystr_pubkey", pubkey);
      localStorage.setItem("wrystr_login_type", "remote-signer");

      useLightningStore.getState().loadNwcForAccount(pubkey);
      get().fetchOwnProfile();
      get().fetchFollows();
      useMuteStore.getState().fetchMuteList(pubkey);
      useNotificationsStore.getState().fetchNotifications(pubkey);
      startNotificationPoller(pubkey);
      usePodcastStore.getState().setActiveAccount(pubkey);
      usePodcastStore.getState().hydrateSubscriptions(pubkey);

      useUIStore.getState().setView("feed");
      useFeedStore.getState().loadFeed();
    } catch (err) {
      // NDK rejects the connect promise with the raw `error` field, which is
      // undefined whenever the bunker replied without one — don't print
      // "undefined", and don't pass the bunker's own wording straight through
      // when we can say something the user can act on. See
      // explainBunkerConnectError.
      set({ loginError: explainBunkerConnectError(err) });
    }
  },

  logout: () => {
    stopNotificationPoller();
    const ndk = getNDK();
    ndk.signer = undefined;
    // See switchAccount: an authenticated relay session outlives the signer.
    dropAuthenticatedSessions();
    // Don't delete the keychain entry — keep the account available for instant switch-back.
    localStorage.removeItem("wrystr_pubkey");
    localStorage.removeItem("wrystr_login_type");
    forgetContactList();
    set({ pubkey: null, npub: null, profile: null, follows: [], followsStatus: "idle", loggedIn: false, loginError: null });
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
        debug.warn(`Failed to load nsec for ${acct.npub} from keychain:`, err);
      }
    }

    // Restore NIP-46 signers from saved payloads
    for (const acct of accounts) {
      if (acct.loginType !== "remote-signer" || !acct.signerPayload || _nip46SignerCache.has(acct.pubkey)) continue;
      try {
        const signer = await NDKNip46Signer.fromPayload(acct.signerPayload, getNDK());
        // fromPayload restores the bunker:// secret, so the reconnect below
        // re-sends it and bunkers that echo it back need the same normalization
        // fresh login gets. Without this, restart is permanently read-only (#47).
        acceptSecretEchoAsAck(signer);
        _nip46SignerCache.set(acct.pubkey, signer);
      } catch (err) {
        debug.warn(`Failed to restore NIP-46 session for ${acct.npub}:`, err);
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

    if (savedLoginType === "remote-signer") {
      const cachedSigner = _nip46SignerCache.get(savedPubkey);
      if (cachedSigner) {
        try {
          await connectWithTimeout(cachedSigner);
          getNDK().signer = cachedSigner;
          const npub = nip19.npubEncode(savedPubkey);
          set({ pubkey: savedPubkey, npub, loggedIn: true, loginError: null });
          localStorage.setItem("wrystr_pubkey", savedPubkey);
          localStorage.setItem("wrystr_login_type", "remote-signer");
          useLightningStore.getState().loadNwcForAccount(savedPubkey);
          get().fetchOwnProfile();
          get().fetchFollows();
          useMuteStore.getState().fetchMuteList(savedPubkey);
          useNotificationsStore.getState().fetchNotifications(savedPubkey);
          startNotificationPoller(savedPubkey);
        usePodcastStore.getState().setActiveAccount(savedPubkey);
        usePodcastStore.getState().hydrateSubscriptions(savedPubkey);
        } catch (err) {
          // Stay on the account but read-only rather than silently looking
          // logged out — and say why, so the user isn't left guessing at a
          // sidebar that quietly dropped half its items (#47).
          debug.warn("Failed to restore NIP-46 session:", err);
          const npub = nip19.npubEncode(savedPubkey);
          set({ pubkey: savedPubkey, npub, loggedIn: false, loginError: nip46RestoreError(err) });
          useToastStore.getState().addToast(nip46RestoreError(err), "warning", 8000);
        }
      }
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
        usePodcastStore.getState().setActiveAccount(savedPubkey);
        usePodcastStore.getState().hydrateSubscriptions(savedPubkey);
      }
      // No keychain entry → stay logged out, user re-enters nsec once.
    }
  },

  switchAccount: async (pubkey: string) => {
    // Clear signer immediately — no window where old account could sign
    getNDK().signer = undefined;
    // Clearing the signer is not enough once NIP-42 is in play. AUTH binds an
    // identity to the *connection*, not to a signature we are about to make, so
    // a relay that authenticated us as the previous account keeps serving this
    // one under that identity — invisibly, and on a relay with
    // `restrictReadToInvolvedPubkey` the new account's inbox just reads empty.
    dropAuthenticatedSessions();

    // Fast path: NIP-46 cached signer
    const cachedNip46 = _nip46SignerCache.get(pubkey);
    if (cachedNip46) {
      try {
        await connectWithTimeout(cachedNip46);
        getNDK().signer = cachedNip46;
        const account = get().accounts.find((a) => a.pubkey === pubkey);
        const npub = account?.npub ?? nip19.npubEncode(pubkey);
        set({ pubkey, npub, loggedIn: true, loginError: null });
        localStorage.setItem("wrystr_pubkey", pubkey);
        localStorage.setItem("wrystr_login_type", "remote-signer");
        useLightningStore.getState().loadNwcForAccount(pubkey);
        get().fetchOwnProfile();
        get().fetchFollows();
        useMuteStore.getState().fetchMuteList(pubkey);
        startNotificationPoller(pubkey);
      usePodcastStore.getState().setActiveAccount(pubkey);
      usePodcastStore.getState().hydrateSubscriptions(pubkey);
        useUIStore.getState().setView("feed");
        return;
      } catch (err) {
        debug.warn("NIP-46 signer reconnect failed during switch:", err);
      }
    }

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
      usePodcastStore.getState().setActiveAccount(pubkey);
      usePodcastStore.getState().hydrateSubscriptions(pubkey);
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
      debug.warn("Keychain load failed during account switch:", err);
    }
    if (!succeeded) {
      const account = get().accounts.find((a) => a.pubkey === pubkey);
      if (account?.loginType === "pubkey") {
        // Deliberately read-only (npub) account — correct behavior
        await get().loginWithPubkey(pubkey);
      } else {
        // Either an nsec account whose keychain entry was lost, or a
        // remote-signer account whose bunker didn't answer. Update state to
        // reflect the target account (logged out) so the UI shows the correct
        // account with a login prompt, rather than staying stuck on the previous.
        //
        // Preserve the account's real login type: hardcoding "nsec" here sent
        // the *next* startup down the nsec branch, which has no bunker signer to
        // restore, so a single failed reconnect made the account permanently
        // read-only until it was re-added from a new bunker:// URI (#47).
        const loginType = account?.loginType ?? "nsec";
        const npub = account?.npub ?? nip19.npubEncode(pubkey);
        const failedReconnect = loginType === "remote-signer";
        set({
          pubkey,
          npub,
          loggedIn: false,
          loginError: failedReconnect ? nip46RestoreError(null) : null,
          profile: null,
          follows: [],
          followsStatus: "idle",
        });
        localStorage.setItem("wrystr_pubkey", pubkey);
        localStorage.setItem("wrystr_login_type", loginType);
        if (failedReconnect) {
          useToastStore.getState().addToast(nip46RestoreError(null), "warning", 8000);
        }
        usePodcastStore.getState().setActiveAccount(pubkey);
      }
    }
    // Always land on feed to avoid stale UI from previous account's view
    useUIStore.getState().setView("feed");
  },

  removeAccount: (pubkey: string) => {
    try { localStorage.removeItem(CONTACT_LIST_CACHE_PREFIX + pubkey); } catch { /* nothing to remove */ }
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
      forgetContactList();
      set({ pubkey: null, npub: null, profile: null, follows: [], followsStatus: "idle", loggedIn: false, loginError: null });
    }
  },

  fetchOwnProfile: async () => {
    const { pubkey } = get();
    if (!pubkey) return;

    // Instant: load from SQLite cache so name/picture show immediately
    if (!get().profile) {
      try {
        const cached = await dbLoadProfile(pubkey);
        if (cached && !get().profile) {
          const parsed = JSON.parse(cached);
          set({ profile: parsed });
          const name = parsed?.displayName || parsed?.name;
          const picture = parsed?.picture;
          if (name) {
            const accounts = upsertAccount(get().accounts, { pubkey, npub: get().npub!, name, picture });
            persistAccounts(accounts);
            set({ accounts });
          }
        }
      } catch { /* cache miss is fine */ }
    }

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
    clearFollowsRetry();

    // A different account: nothing we hold applies to it. Switch at once rather
    // than leave the previous account's follows on screen (and in reach of a
    // Follow click) while this one loads.
    if (_followsOwner !== pubkey) {
      beginFollowsFor(pubkey);
    } else if (get().followsStatus !== "loaded") {
      set({ followsStatus: "loading" });
    }

    const adopt = (list: ContactListSnapshot) => {
      if (get().pubkey !== pubkey) return;
      const known = _contactBase?.pubkey === pubkey ? _contactBase.list : null;
      const newest = newerContactList(known, list)!;
      _contactBase = { pubkey, list: newest };
      saveCachedContactList(pubkey, newest);
      set({ follows: contactPubkeys(newest.tags), followsStatus: "loaded" });
    };

    let result: ContactListResult;
    try {
      result = await fetchContactList(pubkey, { onFound: adopt });
    } catch {
      result = { status: "unknown" };
    }
    if (get().pubkey !== pubkey) return; // the account changed while we waited

    if (result.status === "found") {
      adopt(result.list);
      _followsRetryCount = 0;
    } else if (_contactBase?.pubkey === pubkey) {
      // We already hold a list, from earlier in this session or from this
      // device's cache. Relays that are quiet, or that have lost it, are no
      // reason to throw it away; the next follow or unfollow republishes it.
    } else if (result.status === "none") {
      _noListConfirmedFor = pubkey;
      set({ follows: [], followsStatus: "loaded" });
      _followsRetryCount = 0;
    } else {
      // Could not tell. Say so, and keep asking for a while: this must never
      // be shown, or acted on, as "follows nobody".
      set({ followsStatus: "unknown" });
      const delay = FOLLOWS_RETRY_DELAYS_MS[_followsRetryCount];
      if (delay !== undefined) {
        _followsRetryCount++;
        _followsRetryTimer = setTimeout(() => {
          _followsRetryTimer = null;
          if (get().pubkey === pubkey) void get().fetchFollows();
        }, delay);
      }
    }
  },

  follow: (pubkey: string) => changeFollow({ add: pubkey }),

  unfollow: (pubkey: string) => changeFollow({ remove: pubkey }),
}));

/**
 * Queue one follow or unfollow.
 *
 * The button answers at once when there is a loaded list to answer from; the
 * real work runs in `applyFollowChange`, one change at a time, and corrects the
 * display if it turns out differently.
 */
function changeFollow(change: { add: string } | { remove: string }): Promise<void> {
  const { getState: get, setState: set } = useUserStore;
  // Runtime guard — UI should already prevent this, but belt-and-suspenders
  if (!getNDK().signer) return Promise.resolve();
  const me = get().pubkey;
  if (!me) return Promise.resolve();

  // Reached before fetchFollows ran for this account (every login path calls
  // it, but nothing guarantees it won the race with a click): whatever the
  // store shows belongs to someone else.
  if (_followsOwner !== me) beginFollowsFor(me);

  if (get().followsStatus === "loaded") {
    const shown = get().follows;
    if ("add" in change) {
      if (!shown.includes(change.add)) set({ follows: [...shown, change.add] });
    } else {
      set({ follows: shown.filter((pk) => pk !== change.remove) });
    }
  }

  const run = _followChain.then(() => applyFollowChange(me, change));
  _followChain = run.catch(() => undefined);
  return run;
}

/**
 * Apply one follow or unfollow to the user's contact list and publish it.
 *
 * A kind 3 is replaceable: publishing one *replaces* the previous list for
 * every client the user owns. So the new list is never built from what happens
 * to be on screen. It is built from the newest list the relays hold right now,
 * merged with anything newer this device knows, and if neither exists and the
 * relays have not confirmed there is no list, nothing is published at all.
 * Before this, a list that had failed to load looked exactly like an empty one,
 * and a single Follow click overwrote it.
 */
async function applyFollowChange(me: string, change: { add: string } | { remove: string }): Promise<void> {
  const { getState: get, setState: set } = useUserStore;
  if (get().pubkey !== me || !getNDK().signer) return; // the account changed while this waited its turn

  const adding = "add" in change;
  const target = adding ? change.add : change.remove;
  const known = _contactBase?.pubkey === me ? _contactBase.list : null;

  // Nothing to do — judged against the list itself, not the display, which
  // already shows the change.
  if (known && contactPubkeys(known.tags).includes(target) === adding) {
    set({ follows: contactPubkeys(known.tags) });
    return;
  }
  if (!known && !adding && _noListConfirmedFor === me) return;

  let result: ContactListResult;
  try {
    // A list we already hold makes a slow relay tolerable, so wait less for it.
    result = await fetchContactList(me, known ? { timeoutMs: 3000 } : {});
  } catch {
    result = { status: "unknown" };
  }
  if (get().pubkey !== me) return; // the account changed while we waited

  if (result.status === "none" && !known) _noListConfirmedFor = me;
  const base = result.status === "found" ? newerContactList(known, result.list) : known;
  const mayStartNewList = _noListConfirmedFor === me;

  if (!base && !mayStartNewList) {
    set({ follows: [], followsStatus: "unknown" });
    useToastStore.getState().addToast(
      "Couldn't load your follow list, so nothing was changed. Check your relays and try again.",
      "warning",
      8000,
    );
    return;
  }

  const tags = nextContactTags(base?.tags ?? [], change);
  const content = base?.content ?? "";
  const next: ContactListSnapshot = { tags, content, createdAt: Math.floor(Date.now() / 1000) };
  _contactBase = { pubkey: me, list: next };
  set({ follows: contactPubkeys(tags), followsStatus: "loaded" });

  try {
    await publishContactList(tags, content);
    saveCachedContactList(me, next);
  } catch {
    if (get().pubkey === me) {
      // Back to the list as the relays have it, which may itself be newer than
      // what this device knew before the attempt.
      _contactBase = base ? { pubkey: me, list: base } : null;
      if (base) saveCachedContactList(me, base);
      set({ follows: base ? contactPubkeys(base.tags) : [], followsStatus: "loaded" });
    }
    useToastStore.getState().addToast("Couldn't publish your follow list. Nothing was changed.", "warning", 8000);
  }
}
