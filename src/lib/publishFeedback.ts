import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { useToastStore } from "../stores/toast";
import { useUIStore } from "../stores/ui";
import { explainPublishError } from "./publishErrors";
import { currentAccount, stillAccount } from "./currentAccount";

interface Tell<T> {
  /** Said when it worked. Leave it out where the result shows on screen by itself (a reply that appears in the thread). */
  done?: string;
  /** What became of the user's work if it failed: "Your reply is still in the box." */
  kept: string;
  /** For a result that is a note of its own: the success toast offers to open it. */
  view?: (result: T) => NDKEvent;
  /** What was being done, where "publish" is the wrong word. */
  verb?: string;
}

export type Told<T> = { ok: true; value: T } | { ok: false };

/**
 * Publish something, and say how it went: a failure always, in plain words;
 * a success when asked to (see "Toasts, and saying what happened" in
 * CLAUDE.md for when that is).
 *
 * Four handlers had a `try` with no `catch`, or a `catch` that ignored the
 * error: replies in a thread, a comment on an article, and the relay list.
 * The button came back and nothing said the thing had not gone out.
 */
export async function tellPublish<T>(run: () => Promise<T>, { done, kept, view, verb }: Tell<T>): Promise<Told<T>> {
  // Before the await: a publish takes seconds, and what comes back after an
  // account switch is not the new account's to hear, success or failure.
  const me = currentAccount();
  let value: T;
  try {
    value = await run();
  } catch (err) {
    if (stillAccount(me)) useToastStore.getState().addToast(explainPublishError(err, kept, verb), "error");
    return { ok: false };
  }
  if (done && stillAccount(me)) {
    const note = view?.(value);
    useToastStore.getState().addToast(
      done,
      "success",
      // Keyed by the note: two comments in a row are two toasts, each opening its own.
      note ? { key: `posted:${note.id}`, action: { label: "View", run: () => useUIStore.getState().openThread(note) } } : undefined,
    );
  }
  return { ok: true, value };
}
