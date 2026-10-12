import type { ReactNode } from "react";
import { Button } from "./Button";
import type { LoadOutcome } from "../../lib/listLoad";

// What a list shows when it has no rows: loading, really empty, could not be
// reached, or failed. One component, so the four are told apart everywhere and
// in the same words.
//
// Before the October 2026 UI review a list that could not load said the same
// thing as a list with nothing in it. See `lib/listLoad.ts`.

export type ListStateKind = "loading" | "empty" | "unreachable" | "error";

/** What to show for a list with no rows, given how its load ended: a load that finished means it is empty. */
export function emptyOr(status: "loading" | "loaded" | "unreachable" | "error"): ListStateKind {
  return status === "loaded" ? "empty" : status;
}

/**
 * What a list shows when it has no rows on screen. `held` is how many rows it
 * holds that this view could show, before the user's own filters (mutes, the
 * script filter): with rows held, the filters removed them and the list is
 * empty for this user. Rows the view never shows must not be counted: the
 * notification store also holds follower events, and counting those made an
 * unanswered fetch read "No mentions yet."
 *
 * A list that has not been asked yet is loading, not empty.
 */
export function stateWithoutRows(loading: boolean, held: number, outcome: LoadOutcome): ListStateKind {
  if (loading) return "loading";
  if (held > 0 || outcome === "answered") return "empty";
  return outcome === "pending" ? "loading" : outcome;
}

/** A load that ended without an answer: the rows on screen, if any, are from before. */
export function didNotLoad(outcome: LoadOutcome): outcome is "unreachable" | "error" {
  return outcome === "unreachable" || outcome === "error";
}

/**
 * What a list that needs the follow list shows when that list has nobody in
 * it. Only "loaded" means the account follows nobody: see the contact list
 * section of CLAUDE.md.
 */
export function followListState(followsStatus: "idle" | "loading" | "loaded" | "unknown"): ListStateKind {
  return followsStatus === "loaded" ? "empty" : followsStatus === "unknown" ? "unreachable" : "loading";
}

interface ListStateProps {
  state: ListStateKind;
  /** While loading. A sentence ("Loading notes…"), or a skeleton as `loading`. */
  loadingLabel?: string;
  /** Shown instead of the loading sentence: a skeleton of the rows to come. */
  loading?: ReactNode;
  /** The sentence for a list that a relay confirmed is empty. */
  empty: ReactNode;
  /** A quieter line under it: what to do about it. */
  emptyHint?: ReactNode;
  /** A control under an empty list (a button to find people, to write something). */
  emptyAction?: ReactNode;
  /** What was being loaded, for the "could not reach" sentence: "your bookmarks", "this thread". */
  what?: string;
  /** Said instead of "Couldn't reach your relays…", where the relays asked are not the user's (search). */
  unreachable?: string;
  /** The failure, when `state` is "error". */
  error?: string;
  onRetry?: () => void;
}

export function ListState({ state, loadingLabel = "Loading…", loading, empty, emptyHint, emptyAction, what, unreachable, error, onRetry }: ListStateProps) {
  if (state === "loading") {
    if (loading) return <div role="status" aria-label={loadingLabel}>{loading}</div>;
    return <p role="status" className="px-4 py-8 text-center text-body text-text-muted">{loadingLabel}</p>;
  }

  if (state === "empty") {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-body text-text-muted">{empty}</p>
        {emptyHint ? <p className="mt-1 text-caption text-text-dim">{emptyHint}</p> : null}
        {emptyAction ? <div className="mt-3 flex justify-center">{emptyAction}</div> : null}
      </div>
    );
  }

  // Could not be reached, or failed. Never the empty sentence: that would say
  // the list has nothing in it, which nobody has told us.
  return (
    <div role="alert" className="px-4 py-10 text-center">
      <p className="text-body text-text">
        {state === "unreachable"
          ? unreachable ?? `Couldn't reach your relays${what ? `, so ${what} can't be loaded` : ""}.`
          : `Couldn't load ${what ?? "this"}.`}
      </p>
      <p className="mt-1 text-caption text-text-muted">
        {state === "unreachable" ? "Check your connection, then try again." : error ?? "Something went wrong."}
      </p>
      {onRetry ? <div className="mt-3 flex justify-center"><Button onClick={onRetry}>Try again</Button></div> : null}
    </div>
  );
}
