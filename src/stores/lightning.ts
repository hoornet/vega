import { create } from "zustand";
import { NDKEvent, NDKUser, NDKZapper } from "@nostr-dev-kit/ndk";
import { getNDK } from "../lib/nostr";
import { isValidNwcUri, probeWallet } from "../lib/lightning/nwc";
import { zapPayment, zapFailure, zapTookTooLong } from "../lib/lightning/zap";
import { withinTime } from "../lib/timeLimit";

const NWC_STORAGE_KEY = "wrystr_nwc_uri";
const nwcKeyForAccount = (pubkey: string) => `wrystr_nwc_${pubkey}`;

interface ZapTarget {
  type: "note";
  event: NDKEvent;
  recipientPubkey: string;
  recipientLud16?: string;
}

interface ZapProfileTarget {
  type: "profile";
  pubkey: string;
  lud16?: string;
}

export type ZapTargetSpec = ZapTarget | ZapProfileTarget;

/** Whether the connected wallet has answered: "unknown" until asked, "checking" while asked, then its word ("refused": it does not know this code). */
export type WalletStatus = "unknown" | "checking" | "ok" | "refused" | "unreachable";
/** Checks are numbered: only the newest one's answer is kept, so a slow "Not reached" cannot overwrite a fast "Connected". */
let checks = 0;

interface LightningState {
  nwcUri: string | null;
  /** The wallet's answer to a cheap question, for this session. A stored string is not a reachable wallet. */
  walletStatus: WalletStatus;
  /** Asks the wallet; resolves to what it said. */
  checkWallet: () => Promise<WalletStatus>;
  setNwcUri: (uri: string, pubkey?: string) => void;
  clearNwcUri: (pubkey?: string) => void;
  /** An account removed from this computer takes its wallet connection with it: that string can spend money. */
  forgetAccount: (pubkey: string, wasActive: boolean) => void;
  loadNwcForAccount: (pubkey: string) => void;
  zap: (target: ZapTargetSpec, amountSats: number, comment?: string) => Promise<void>;
}

export const useLightningStore = create<LightningState>(() => ({
  nwcUri: localStorage.getItem(NWC_STORAGE_KEY),
  walletStatus: "unknown",

  checkWallet: async (): Promise<WalletStatus> => {
    const nwcUri: string | null = useLightningStore.getState().nwcUri;
    if (!nwcUri) return "unknown";
    const no = ++checks;
    useLightningStore.setState({ walletStatus: "checking" });
    const status: WalletStatus = await withinTime(probeWallet(nwcUri), 25000, "probe").catch((): WalletStatus => "unreachable");
    // Only for the code that was asked about, and only from the newest check: the wallet may have been
    // changed or removed meanwhile, and two checks can end in either order.
    if (no === checks && useLightningStore.getState().nwcUri === nwcUri) useLightningStore.setState({ walletStatus: status });
    return status;
  },

  setNwcUri: (uri: string, pubkey?: string) => {
    if (!isValidNwcUri(uri)) throw new Error("Invalid NWC URI");
    localStorage.setItem(NWC_STORAGE_KEY, uri);
    if (pubkey) localStorage.setItem(nwcKeyForAccount(pubkey), uri);
    useLightningStore.setState({ nwcUri: uri, walletStatus: "unknown" });
  },

  clearNwcUri: (pubkey?: string) => {
    localStorage.removeItem(NWC_STORAGE_KEY);
    if (pubkey) localStorage.removeItem(nwcKeyForAccount(pubkey));
    useLightningStore.setState({ nwcUri: null, walletStatus: "unknown" });
  },

  forgetAccount: (pubkey: string, wasActive: boolean) => {
    localStorage.removeItem(nwcKeyForAccount(pubkey));
    if (wasActive) {
      localStorage.removeItem(NWC_STORAGE_KEY);
      useLightningStore.setState({ nwcUri: null, walletStatus: "unknown" });
    }
  },

  // Another account's code is another wallet: its word is unknown until asked. Left as it was, one
  // account's "Connected" was shown for the next, or a check cut short left "Checking…" for good.
  loadNwcForAccount: (pubkey: string) => {
    const uri = localStorage.getItem(nwcKeyForAccount(pubkey));
    localStorage.setItem(NWC_STORAGE_KEY, uri ?? "");
    if (!uri) localStorage.removeItem(NWC_STORAGE_KEY);
    useLightningStore.setState((s) => ({ nwcUri: uri, walletStatus: uri === s.nwcUri ? s.walletStatus : "unknown" }));
  },

  zap: async (targetSpec: ZapTargetSpec, amountSats: number, comment?: string) => {
    const { nwcUri } = useLightningStore.getState();
    if (!nwcUri) throw new Error("No wallet connected. Connect one in Settings.");

    const ndk = getNDK();
    if (!ndk.signer) throw new Error("Not logged in");

    let target: NDKEvent | NDKUser;
    if (targetSpec.type === "note") {
      target = targetSpec.event;
    } else {
      target = ndk.getUser({ pubkey: targetSpec.pubkey });
    }

    // Pays only an invoice for the amount asked for: the recipient's server picks what it says.
    const payment = zapPayment(nwcUri);
    const zapper = new NDKZapper(target, amountSats * 1000, "msat", {
      comment,
      lnPay: payment.lnPay,
      ndk,
    });
    // Where NDK says why a recipient could not be paid before the payment step was reached.
    const notices: string[] = [];
    zapper.on("notice", (message) => notices.push(message));

    return new Promise((resolve, reject) => {
      // NDK goes on after this: a wallet already asked may still pay, and one not asked yet is not.
      const timeout = setTimeout(() => reject(zapTookTooLong(payment)), 45000);

      zapper.on("complete", (results) => {
        clearTimeout(timeout);
        const failure = zapFailure(Array.from(results.values()), payment.failures, notices);
        if (failure) reject(failure);
        else resolve();
      });

      zapper.zap().then(() => {
        // zap() resolved but "complete" event handles the result
      }).catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  },
}));
