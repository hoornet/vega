import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { publishRepost } from "./nostr";
import { explainPublishError } from "./publishErrors";
import { forThisAccount } from "./toastActions";
import { stillAccount } from "./currentAccount";
import { useRepostedStore } from "../stores/reposted";
import { useToastStore } from "../stores/toast";

/**
 * Repost a note as `me`, and say so if it could not be done, with a way to
 * try again.
 *
 * Not in the action row, on purpose. A feed row scrolled out of the virtual
 * list is gone, and "Try again" on the toast would run that row's old
 * closure: its popover state, its focus call (which scrolled the feed back
 * to the note), and whatever account it was rendered for. Here it needs
 * only the account and the note. The claim is in `stores/reposted`, so a
 * note cannot be reposted twice by one account however this is reached.
 */
export async function repostNote(me: string, event: NDKEvent): Promise<void> {
  // The signature would be the current account's, whoever asked.
  if (!stillAccount(me)) return;
  const { begin, finish } = useRepostedStore.getState();
  if (!begin(me, event.id)) return;
  let published = false;
  try {
    await publishRepost(event);
    published = true;
  } catch (err) {
    // The account changed while it was on its way: this failure is not the new account's to hear.
    if (stillAccount(me)) {
      useToastStore.getState().addToast(explainPublishError(err, "Nothing was reposted."), "error", {
        // Per note: two failed reposts say the same words and must stay two toasts, each retrying its own.
        key: `repost:${event.id}`,
        action: forThisAccount("Try again", () => void repostNote(me, event), me),
      });
    }
  } finally {
    finish(me, event.id, published);
  }
}
