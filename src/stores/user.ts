import { create } from "zustand";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { getNDK } from "../lib/nostr";
import { nip19 } from "@nostr-dev-kit/ndk";

interface UserState {
  pubkey: string | null;
  npub: string | null;
  profile: any | null;
  follows: string[];
  loggedIn: boolean;
  loginError: string | null;

  loginWithNsec: (nsec: string) => Promise<void>;
  loginWithPubkey: (pubkey: string) => Promise<void>;
  logout: () => void;
  fetchOwnProfile: () => Promise<void>;
  fetchFollows: () => Promise<void>;
}

export const useUserStore = create<UserState>((set, get) => ({
  pubkey: null,
  npub: null,
  profile: null,
  follows: [],
  loggedIn: false,
  loginError: null,

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

      set({ pubkey, npub, loggedIn: true, loginError: null });

      // Store login (pubkey only, never the nsec)
      localStorage.setItem("wrystr_pubkey", pubkey);
      localStorage.setItem("wrystr_login_type", "nsec");

      // Fetch profile and follows
      get().fetchOwnProfile();
      get().fetchFollows();
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
      set({ pubkey, npub, loggedIn: true, loginError: null });

      localStorage.setItem("wrystr_pubkey", pubkey);
      localStorage.setItem("wrystr_login_type", "pubkey");

      get().fetchOwnProfile();
      get().fetchFollows();
    } catch (err) {
      set({ loginError: `Login failed: ${err}` });
    }
  },

  logout: () => {
    const ndk = getNDK();
    ndk.signer = undefined;
    localStorage.removeItem("wrystr_pubkey");
    localStorage.removeItem("wrystr_login_type");
    set({ pubkey: null, npub: null, profile: null, follows: [], loggedIn: false, loginError: null });
  },

  fetchOwnProfile: async () => {
    const { pubkey } = get();
    if (!pubkey) return;

    try {
      const ndk = getNDK();
      const user = ndk.getUser({ pubkey });
      await user.fetchProfile();
      set({ profile: user.profile });
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
}));
