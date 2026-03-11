import { create } from "zustand";
import { NDKEvent, NDKUser, NDKZapper, LnPayCb } from "@nostr-dev-kit/ndk";
import { getNDK } from "../lib/nostr";
import { payInvoiceViaNWC, isValidNwcUri } from "../lib/lightning/nwc";

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

interface LightningState {
  nwcUri: string | null;
  setNwcUri: (uri: string, pubkey?: string) => void;
  clearNwcUri: (pubkey?: string) => void;
  loadNwcForAccount: (pubkey: string) => void;
  zap: (target: ZapTargetSpec, amountSats: number, comment?: string) => Promise<void>;
}

export const useLightningStore = create<LightningState>(() => ({
  nwcUri: localStorage.getItem(NWC_STORAGE_KEY),

  setNwcUri: (uri: string, pubkey?: string) => {
    if (!isValidNwcUri(uri)) throw new Error("Invalid NWC URI");
    localStorage.setItem(NWC_STORAGE_KEY, uri);
    if (pubkey) localStorage.setItem(nwcKeyForAccount(pubkey), uri);
    useLightningStore.setState({ nwcUri: uri });
  },

  clearNwcUri: (pubkey?: string) => {
    localStorage.removeItem(NWC_STORAGE_KEY);
    if (pubkey) localStorage.removeItem(nwcKeyForAccount(pubkey));
    useLightningStore.setState({ nwcUri: null });
  },

  loadNwcForAccount: (pubkey: string) => {
    const uri = localStorage.getItem(nwcKeyForAccount(pubkey));
    localStorage.setItem(NWC_STORAGE_KEY, uri ?? "");
    if (!uri) localStorage.removeItem(NWC_STORAGE_KEY);
    useLightningStore.setState({ nwcUri: uri });
  },

  zap: async (targetSpec: ZapTargetSpec, amountSats: number, comment?: string) => {
    const { nwcUri } = useLightningStore.getState();
    if (!nwcUri) throw new Error("No wallet connected. Add an NWC connection in Settings.");

    const ndk = getNDK();
    if (!ndk.signer) throw new Error("Not logged in");

    let target: NDKEvent | NDKUser;
    if (targetSpec.type === "note") {
      target = targetSpec.event;
    } else {
      target = ndk.getUser({ pubkey: targetSpec.pubkey });
    }

    const lnPay: LnPayCb = async ({ pr }) => {
      const preimage = await payInvoiceViaNWC(nwcUri, pr);
      return { preimage };
    };

    const zapper = new NDKZapper(target, amountSats * 1000, "msat", {
      comment,
      lnPay,
      ndk,
    });

    return new Promise((resolve, reject) => {
      zapper.on("complete", (results) => {
        const errors = Array.from(results.values()).filter((r) => r instanceof Error);
        if (errors.length > 0) {
          reject(errors[0]);
        } else {
          resolve();
        }
      });

      zapper.zap().catch(reject);
    });
  },
}));
