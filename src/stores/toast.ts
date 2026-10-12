import { create } from "zustand";
import { useUIStore, type View } from "./ui";

// Short messages in the corner of the window: what just happened, when
// nothing else on screen says it.
//
// - "success" and "info": something worked, or something to know.
// - "warning": something is degraded and it is not about what you just did
//   (the connection dropped, a relay refused Vega's sign-in).
// - "error": the thing you just did did not happen. Read out at once by a
//   screen reader, and kept on screen longest.
//
// A toast may carry one action (Undo, Try again, View). A message that asks
// for a decision does not belong here, because a toast disappears. The one
// exception is `sticky`, for something that must not be missed and has
// nowhere else to live.

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastAction {
  label: string;
  run: () => void;
  /** Leave the toast up after the action runs, for one that may need pressing again. */
  keepOpen?: boolean;
  /**
   * The action is about what one account did (Undo, Try again). Set by
   * `forThisAccount`. Such a toast is dropped when the account changes.
   */
  forAccount?: boolean;
}

export interface Toast {
  id: string;
  /** What makes it "the same toast again". The message, unless a key was given. */
  key: string;
  message: string;
  type: ToastType;
  /** How long it stays, or null for one that stays until it is dismissed. */
  autoCloseMs: number | null;
  action?: ToastAction;
  /** Goes up each time it is said: once when raised, again each time it is said anew. For reading it out. */
  said: number;
}

export interface ToastOptions {
  /** How long it stays. Left out, it follows from the type and whether there is an action. */
  autoCloseMs?: number;
  /** Stays until dismissed. For what must not be missed. */
  sticky?: boolean;
  action?: ToastAction;
  /**
   * Two toasts with one key are one toast. Give a key to a toast with an
   * action whose message is not unique: two failed reposts say the same
   * words, and merged on the words, "Try again" would retry only one.
   */
  key?: string;
}

/** Why a clock is stopped. It runs only when there is no reason left. */
export type HoldReason = "pointer" | "focus";

interface ToastState {
  toasts: Toast[];
  /** The third argument is a duration in ms, or options. */
  addToast: (message: string, type: ToastType, options?: number | ToastOptions) => void;
  removeToast: (id: string) => void;
  /** Stop one toast's clock: focus is inside it. */
  holdToast: (id: string, reason: HoldReason) => void;
  /** That reason is over. With none left, the clock starts again from the beginning. */
  releaseToast: (id: string, reason: HoldReason) => void;
  /** Stop every clock: the pointer is somewhere in the stack. */
  holdAll: (reason: HoldReason) => void;
  releaseAll: (reason: HoldReason) => void;
  /**
   * Drop every toast whose action was about one account (`forAccount`).
   * Called when the account changes: "Undo" and "Try again" were about what
   * the other account did.
   */
  dropAccountToasts: () => void;
  /** Take down the toast with this key, if it is showing: what it said is no longer so. */
  removeByKey: (key: string) => void;
}

const MAX_TOASTS = 5;

/** A failure takes longer to read than a confirmation, and matters more. */
const DEFAULT_MS: Record<ToastType, number> = { success: 4000, info: 4000, warning: 6000, error: 8000 };
/** With something to press, there has to be time to read it and get there. */
const ACTION_MIN_MS = 8000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const holds = new Map<string, Set<HoldReason>>();
/** Reasons that hold the whole stack. The pointer over any toast: if a lower one left, the rest would move under it. */
const stackHolds = new Set<HoldReason>();
/** The window cannot be seen at all. */
let hidden = typeof document !== "undefined" && document.hidden;
/** Another window has the keyboard. This one may well still be in view. */
let blurred = false;

function stopTimer(id: string) {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
}

function forget(id: string) {
  stopTimer(id);
  holds.delete(id);
}

const isHeld = (id: string) => stackHolds.size > 0 || (holds.get(id)?.size ?? 0) > 0;
const isSticky = (toast: Toast) => toast.autoCloseMs === null;
/** What must not come and go unseen: a failure, and anything with a button. */
const matters = (toast: Toast) => toast.type === "error" || toast.action !== undefined;

/**
 * Which toast goes when there are too many. Never one that stays until
 * dismissed: it is there because it must not be missed, and five ordinary
 * toasts pushed the keychain warning out. Then by how little is lost: a
 * plain message before a failure or one with a button, a free one before
 * one somebody is reading, the oldest first.
 */
function spareIndex(toasts: Toast[], keep: string | null): number {
  const candidates = toasts.map((t, i) => ({ t, i })).filter(({ t }) => t.id !== keep && !isSticky(t));
  const pick =
    candidates.find(({ t }) => !matters(t) && !isHeld(t.id)) ??
    candidates.find(({ t }) => !isHeld(t.id)) ??
    candidates.find(({ t }) => !matters(t)) ??
    candidates[0];
  return pick ? pick.i : -1;
}

/**
 * Whether a toast waits for someone to be looking. A window nobody can see:
 * everything waits. A window that only lost the keyboard may be in full view
 * (a tile beside a terminal), so there only what matters waits, and "Link
 * copied." does not sit for an hour.
 */
const waitsFor = (toast: Toast, isHidden: boolean, isBlurred: boolean) => isHidden || (isBlurred && matters(toast));

/** Down to five, dropping what `spareIndex` picks. With nothing that may go (five sticky ones) it stays longer. */
function trimmed(toasts: Toast[], keep: string | null): Toast[] {
  const kept = [...toasts];
  while (kept.length > MAX_TOASTS) {
    const spare = spareIndex(kept, keep);
    if (spare === -1) break;
    const [gone] = kept.splice(spare, 1);
    forget(gone.id);
  }
  return kept;
}

export const useToastStore = create<ToastState>((set, get) => {
  /** Start a toast's clock from the beginning, unless something says it must wait. */
  const startTimer = (toast: Toast) => {
    stopTimer(toast.id);
    if (toast.autoCloseMs === null || isHeld(toast.id) || waitsFor(toast, hidden, blurred)) return;
    timers.set(toast.id, setTimeout(() => get().removeToast(toast.id), toast.autoCloseMs));
  };
  const restartAll = () => { for (const toast of get().toasts) startTimer(toast); };
  // The last one gone with the pointer still "in the stack": no toast is left
  // to report it leaving, and the next one would never start its clock.
  const letGoIfEmpty = () => { if (get().toasts.length === 0) stackHolds.clear(); };

  // A failure that comes and goes while the user is in another window was
  // never said. Its clock stops while nobody is looking and starts over when
  // they are back.
  const look = (next: { hidden?: boolean; blurred?: boolean }) => {
    const was = { hidden, blurred };
    hidden = next.hidden ?? hidden;
    blurred = next.blurred ?? blurred;
    // Only the toasts this changes anything for. Restarting them all gave a
    // plain "Link copied." a fresh four seconds every time the keyboard went
    // to another window and back, which with focus-follows-mouse is every
    // time the pointer crosses the edge.
    for (const toast of get().toasts) {
      if (waitsFor(toast, was.hidden, was.blurred) !== waitsFor(toast, hidden, blurred)) startTimer(toast);
    }
  };
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.addEventListener("blur", () => look({ blurred: true }));
    window.addEventListener("focus", () => look({ blurred: false }));
    document.addEventListener("visibilitychange", () => look({ hidden: document.hidden }));
    // A webview that never reports the keyboard coming back must not leave
    // toasts up for good: anyone pointing or typing here is looking.
    const here = () => { if (blurred) look({ blurred: false }); };
    document.addEventListener("pointerdown", here, { passive: true });
    document.addEventListener("pointermove", here, { passive: true });
    document.addEventListener("keydown", here, { passive: true });
  }

  return {
    toasts: [],

    addToast: (message, type, options) => {
      const given: ToastOptions = typeof options === "number" ? { autoCloseMs: options } : options ?? {};
      const autoCloseMs = given.sticky ? null : given.autoCloseMs ?? Math.max(DEFAULT_MS[type], given.action ? ACTION_MIN_MS : 0);
      const key = given.key ?? message;

      // Said again while it is still showing: one toast, not two. It takes the
      // newer words and action (its "Try again" must retry the newer attempt),
      // and its time starts over, unless someone is holding it.
      const showing = get().toasts.find((t) => t.key === key);
      if (showing) {
        const refreshed: Toast = { ...showing, message, type, autoCloseMs, action: given.action, said: showing.said + 1 };
        set((state) => ({ toasts: state.toasts.map((t) => (t.id === showing.id ? refreshed : t)) }));
        startTimer(refreshed);
        return;
      }

      const toast: Toast = { id: crypto.randomUUID(), key, message, type, autoCloseMs, action: given.action, said: 1 };
      const toasts = [...get().toasts, toast];
      // Over the limit, one goes: see `spareIndex` for which. Not while the
      // pointer is in the stack: one leaving moves the rest under it, which
      // is what that hold is there to prevent. They go when it has left.
      set({ toasts: stackHolds.size > 0 ? toasts : trimmed(toasts, toast.id) });
      startTimer(toast);
    },

    removeToast: (id) => {
      forget(id);
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      letGoIfEmpty();
    },

    holdToast: (id, reason) => {
      if (!get().toasts.some((t) => t.id === id)) return;
      holds.set(id, new Set(holds.get(id)).add(reason));
      stopTimer(id);
    },

    releaseToast: (id, reason) => {
      holds.get(id)?.delete(reason);
      const toast = get().toasts.find((t) => t.id === id);
      if (toast) startTimer(toast);
    },

    holdAll: (reason) => {
      stackHolds.add(reason);
      for (const toast of get().toasts) stopTimer(toast.id);
    },

    releaseAll: (reason) => {
      // Not held for this reason: nothing to let go, and no clock to start over.
      if (!stackHolds.delete(reason)) return;
      if (stackHolds.size === 0) set({ toasts: trimmed(get().toasts, null) });
      restartAll();
    },

    dropAccountToasts: () => {
      const goes = (t: Toast) => t.action?.forAccount === true;
      for (const toast of get().toasts) if (goes(toast)) forget(toast.id);
      set((state) => ({ toasts: state.toasts.filter((t) => !goes(t)) }));
      letGoIfEmpty();
    },

    removeByKey: (key) => {
      const showing = get().toasts.find((t) => t.key === key);
      if (showing) get().removeToast(showing.id);
    },
  };
});

/** For a toast's action: go to a view. Here so that the relay layer can offer "Relays" without knowing about navigation. */
export function openView(view: View): () => void {
  return () => useUIStore.getState().setView(view);
}
