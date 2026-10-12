import { currentAccount, stillAccount } from "./currentAccount";
import { useToastStore, type ToastAction } from "../stores/toast";

/**
 * An action for a toast that only runs for one account: the one signed in
 * when the thing it is about was done.
 *
 * The signature is the current account's, whoever asked. "Undo" pressed
 * after a switch unfollowed for the wrong person, and "Try again" on a
 * failed repost reposted as them.
 *
 * **Read the account before anything is awaited, and pass it in.** A publish
 * takes seconds, and the account can change meanwhile: read afterwards, the
 * "current" account is the new one, and the toast would hand it an Undo for
 * what the old one did. If the account has changed by the time the result is
 * in, raise no toast at all (`stillAccount`): it was not this account's.
 *
 * Toasts made with this are dropped when the account changes
 * (`dropAccountToasts`). The check at press time covers what that cannot.
 */
export function forThisAccount(label: string, run: () => void, account: string | null = currentAccount()): ToastAction {
  return {
    label,
    forAccount: true,
    run: () => {
      if (stillAccount(account)) run();
      else useToastStore.getState().addToast("That was for another account, so nothing was done.", "info");
    },
  };
}
