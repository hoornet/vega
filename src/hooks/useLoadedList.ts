import { useCallback, useEffect, useState, type DependencyList } from "react";
import { loadList, type ListLoadOptions } from "../lib/listLoad";

export type ListStatus = "loading" | "loaded" | "unreachable" | "error";

interface LoadedList<T> {
  status: ListStatus;
  items: T[];
  /** Set when `status` is "error". */
  message?: string;
  /** Load again, from the start. */
  reload: () => void;
}

interface Options extends Pick<ListLoadOptions, "retryEmptyAfterMs"> {
  /** Pass false to hold off (a tab that is not showing, a list that needs an account). */
  enabled?: boolean;
}

interface Loaded<T> {
  /** What this was loaded for: the deps and the attempt, as they were when the load began. */
  loadedFor: DependencyList | null;
  status: ListStatus;
  items: T[];
  message?: string;
}

const sameDeps = (a: DependencyList, b: DependencyList) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

/**
 * Load a list when `deps` change, and say how it ended: see `lib/listLoad.ts`.
 * `fetch` is read from the render in which `deps` changed.
 *
 * What it returns always belongs to the current `deps`. A result is kept with
 * the deps it was loaded for and compared during render, so the first render
 * with new deps already reads "loading" with no rows. Clearing the rows from
 * the effect instead would leave one render showing the old rows as "loaded"
 * under the new subject: one person's notes under the next person's name.
 */
export function useLoadedList<T>(fetch: () => Promise<T[]>, deps: DependencyList, { retryEmptyAfterMs, enabled = true }: Options = {}): LoadedList<T> {
  const [state, setState] = useState<Loaded<T>>({ loadedFor: null, status: "loading", items: [] });
  const [attempt, setAttempt] = useState(0);
  const wanted: DependencyList = [...deps, attempt];

  useEffect(() => {
    // Held off: nothing has been asked, so nothing is known.
    if (!enabled) return;
    let cancelled = false;
    void loadList(fetch, { retryEmptyAfterMs, cancelled: () => cancelled }).then((result) => {
      if (cancelled) return;
      if (result.status === "loaded") setState({ loadedFor: wanted, status: "loaded", items: result.items });
      else if (result.status === "error") setState({ loadedFor: wanted, status: "error", items: [], message: result.message });
      else setState({ loadedFor: wanted, status: "unreachable", items: [] });
    });
    return () => { cancelled = true; };
    // `fetch` is deliberately left out: it is a new function on every render.
  }, [...wanted, enabled]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const current = enabled && state.loadedFor !== null && sameDeps(state.loadedFor, wanted);
  return current
    ? { status: state.status, items: state.items, message: state.message, reload }
    : { status: "loading", items: EMPTY as T[], reload };
}

const EMPTY: never[] = [];
