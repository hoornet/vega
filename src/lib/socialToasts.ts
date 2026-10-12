import { useUserStore } from "../stores/user";
import { useMuteStore } from "../stores/mute";
import { useToastStore } from "../stores/toast";
import { forThisAccount } from "./toastActions";
import { currentAccount, stillAccount } from "./currentAccount";
import { clipText, endSentence } from "./utils";

// Follow and mute from a place that shows no result of its own.
//
// In a note's menu the item is pressed, the menu closes, and nothing on
// screen has changed: no button turned into "Following", and a muted
// person's notes simply vanish. These say what happened and offer the way
// back. A button that changes where you pressed it (the Follow button, the
// profile's Mute) needs neither and calls the stores directly.

/** A display name is someone else's text, of any length. In a sentence of ours it gets a limit. */
const shortName = (name: string) => clipText(name.trim(), 40);

/** "Following Alice." but "Following 1a2b3c4d…", not "…." */
const sentence = endSentence;

/**
 * Follow or unfollow, then say so, with Undo. Goes by what the store says
 * happened, never by looking at the list afterwards. A change that failed has
 * been reported by the store. One that was dropped because the account
 * changed is not ours to announce.
 */
export async function setFollowing(pubkey: string, name: string, follow: boolean, { undo = true } = {}): Promise<void> {
  const me = currentAccount(); // before the await: see `forThisAccount`
  const user = useUserStore.getState();
  const outcome = await (follow ? user.follow(pubkey) : user.unfollow(pubkey));
  if (outcome !== "done" || !stillAccount(me)) return;
  const who = shortName(name);
  useToastStore.getState().addToast(sentence(follow ? `Following ${who}` : `Unfollowed ${who}`), "success", {
    // Per person: two people with one display name are two toasts, each with its own Undo.
    key: `follow:${pubkey}`,
    action: undo ? forThisAccount("Undo", () => void setFollowing(pubkey, name, !follow, { undo: false }), me) : undefined,
  });
}

/**
 * Mute or unmute, then say so, with Undo. Muting takes effect on this device
 * at once whatever the relays do. A list that could not be published is
 * reported by the mute store.
 */
export function setMuted(pubkey: string, name: string, muted: boolean, { undo = true } = {}): void {
  const store = useMuteStore.getState();
  void (muted ? store.mute(pubkey) : store.unmute(pubkey));
  const who = shortName(name);
  useToastStore.getState().addToast(sentence(muted ? `Muted ${who}` : `Unmuted ${who}`), "success", {
    key: `mute:${pubkey}`,
    action: undo ? forThisAccount("Undo", () => setMuted(pubkey, name, !muted, { undo: false })) : undefined,
  });
}
