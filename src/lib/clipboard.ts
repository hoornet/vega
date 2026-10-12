import { useToastStore } from "../stores/toast";

/**
 * Copy text, and say so when it could not be copied.
 *
 * Returns whether it worked, for a caller that shows its own "Copied" beside
 * the button. Pass `done` where nothing beside the button changes, and it is
 * said in a toast.
 *
 * Thirteen places copied something, each in its own way. Three showed
 * "Copied" without waiting to see whether it had been, one of them for a
 * secret key. Five said nothing when it failed, four of them for a key. One
 * said nothing either way, and one blamed a failed copy on the keychain.
 */
export async function copyText(text: string, done?: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    if (done) useToastStore.getState().addToast(done, "success", 2500);
    return true;
  } catch {
    useToastStore.getState().addToast("Couldn't copy to the clipboard.", "error");
    return false;
  }
}
