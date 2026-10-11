import { create } from "zustand";

/**
 * Reposts made in this session, per account.
 *
 * The "reposted" mark used to live in the action row's own state. Feed rows
 * are virtualised, so scrolling a note out of view and back forgot it, and the
 * note could be reposted a second time. The same goes for a repost still on
 * its way to the relays, so those are recorded too.
 *
 * Keyed by the account that reposted: after switching accounts the other
 * account's reposts must not show as yours.
 */
type RepostState = "pending" | "done";

interface RepostedState {
  byKey: Record<string, RepostState>;
  /** Claim a repost. False when this account already reposted the note or is doing so. */
  begin: (pubkey: string, eventId: string) => boolean;
  /** Settle a claimed repost: keep it when it was published, drop it when it was not. */
  finish: (pubkey: string, eventId: string, published: boolean) => void;
}

export const repostKey = (pubkey: string | null, eventId: string): string => `${pubkey ?? ""}:${eventId}`;

export const useRepostedStore = create<RepostedState>((set, get) => ({
  byKey: {},
  begin: (pubkey, eventId) => {
    const key = repostKey(pubkey, eventId);
    if (get().byKey[key]) return false;
    set((s) => ({ byKey: { ...s.byKey, [key]: "pending" } }));
    return true;
  },
  finish: (pubkey, eventId, published) => {
    const key = repostKey(pubkey, eventId);
    set((s) => {
      const byKey = { ...s.byKey };
      if (published) byKey[key] = "done";
      else delete byKey[key];
      return { byKey };
    });
  },
}));
