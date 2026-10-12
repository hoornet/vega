import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useToastStore, type ToastType } from "../../stores/toast";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import { BodyPortal } from "./BodyPortal";
import { Button } from "./Button";

// Colour alone does not tell a failure from a confirmation: each kind has its
// own icon, and a word for someone who cannot see either.
const KIND: Record<ToastType, { stripe: string; icon: typeof Info; tint: string; word: string }> = {
  info: { stripe: "bg-accent", icon: Info, tint: "text-accent", word: "Note" },
  success: { stripe: "bg-success", icon: CircleCheck, tint: "text-success", word: "Done" },
  warning: { stripe: "bg-warning", icon: TriangleAlert, tint: "text-warning", word: "Warning" },
  error: { stripe: "bg-danger", icon: CircleAlert, tint: "text-danger", word: "Error" },
};

/** Zero-width, so the same words said twice are still a change, which is what gets read out. */
const AGAIN = "​";
const sayAfter = (previous: string, next: string) => (previous === next ? next + AGAIN : next);

/**
 * The stack of toasts, bottom right. See `stores/toast.ts` for what belongs in one.
 *
 * Rendered at `<body>`, inside the text-size zoom, and above any dialog: a
 * failure raised while a dialog is open used to sit dimmed under its backdrop,
 * and toast text did not grow with the text size.
 */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const holdToast = useToastStore((s) => s.holdToast);
  const releaseToast = useToastStore((s) => s.releaseToast);
  const holdAll = useToastStore((s) => s.holdAll);
  const releaseAll = useToastStore((s) => s.releaseAll);
  const stack = useRef<HTMLDivElement>(null);
  // Where focus was before it came into the stack, to give it back.
  const cameFrom = useRef<HTMLElement | null>(null);
  // The toast focus was in when the user went to another window, if they did.
  const awayFrom = useRef<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = toasts.find((t) => t.id === focusedId);

  // ── What a screen reader hears ──────────────────────────────────────────
  // Each toast is written to a live region once, when it arrives or is said
  // again, and the text is never worked out from what is left on screen:
  // derived that way, an older toast was read out a second time whenever a
  // newer one went away. A failure interrupts, the rest waits its turn.
  const [live, setLive] = useState({ polite: "", assertive: "" });
  const announced = useRef(new Map<string, number>());
  useEffect(() => {
    // Collected, not overwritten: two toasts raised in one go (two warnings
    // from one read of the inbox) arrive in one render, and only the second
    // used to be written.
    const polite: string[] = [];
    const assertive: string[] = [];
    for (const toast of toasts) {
      if (announced.current.get(toast.id) === toast.said) continue;
      announced.current.set(toast.id, toast.said);
      (toast.type === "error" ? assertive : polite).push(`${KIND[toast.type].word}: ${toast.message}`);
    }
    for (const id of announced.current.keys()) if (!toasts.some((t) => t.id === id)) announced.current.delete(id);
    if (polite.length === 0 && assertive.length === 0) return;
    setLive((was) => ({
      polite: polite.length === 0 ? was.polite : sayAfter(was.polite, polite.join(" ")),
      assertive: assertive.length === 0 ? was.assertive : sayAfter(was.assertive, assertive.join(" ")),
    }));
  }, [toasts]);

  // ── The pointer ─────────────────────────────────────────────────────────
  // Over any toast, every clock stops, not just that toast's. The oldest is
  // at the bottom: if it left, the ones above would drop a slot under the
  // pointer, and the press meant for "Undo" would land on its neighbour or on
  // the page. An element removed under the pointer sends no "leave", so the
  // hold ends when the pointer is next seen outside the stack: moving, or
  // pressing, which is all a touch screen reports.
  const [pointerIn, setPointerIn] = useState(false);
  // React reports "left to nowhere" (out of the window, or onto something it
  // does not manage) as the window itself, which is not a node: `contains`
  // throws on it.
  const inStack = (target: EventTarget | null) => target instanceof Node && (stack.current?.contains(target) ?? false);
  // The store is told here, where the pointer is seen, and not from an
  // effect on the state. An enter and a leave handled before React renders
  // again never show up as state at all: a hold taken in a handler and let
  // go in an effect would then be kept for good. And the store lets go by
  // itself when the last toast leaves, so the next one may appear under a
  // pointer this component still believes is inside.
  const pointerEntered = () => { setPointerIn(true); holdAll("pointer"); };
  const pointerLeft = useCallback(() => { setPointerIn(false); releaseAll("pointer"); }, [releaseAll]);
  useEffect(() => {
    if (!pointerIn) return;
    const seen = (e: PointerEvent) => { if (!inStack(e.target)) pointerLeft(); };
    document.addEventListener("pointermove", seen, { passive: true });
    document.addEventListener("pointerdown", seen, { passive: true });
    return () => {
      document.removeEventListener("pointermove", seen);
      document.removeEventListener("pointerdown", seen);
    };
  }, [pointerIn, pointerLeft]);
  // Unmounted with the pointer inside: nothing is left to see it go.
  useEffect(() => () => releaseAll("pointer"), [releaseAll]);

  // ── The keyboard ────────────────────────────────────────────────────────
  /** Give focus back to where it was before it came into the stack. */
  const giveFocusBack = () => {
    setFocusedId(null);
    if (cameFrom.current?.isConnected) cameFrom.current.focus();
    // Nowhere to go back to: out of the toast all the same. Left on its
    // button, the next Escape would be the app's, and go back a view with
    // focus still showing in the toast.
    else if (document.activeElement instanceof HTMLElement && inStack(document.activeElement)) document.activeElement.blur();
  };

  /** Remove a toast. If focus was in it, focus goes back to where it came from, not to the page. */
  const close = (id: string) => {
    const hadFocus = stack.current?.querySelector(`[data-toast="${id}"]`)?.contains(document.activeElement) ?? false;
    removeToast(id);
    if (hadFocus) giveFocusBack();
  };

  // Escape with focus in a toast dismisses that toast. Without this the press
  // went on to the app and navigated back. One that stays until dismissed
  // only gives focus back: a stray Escape must not put away the key warning.
  // The layer exists only while the focused toast does. One removed by the
  // store with focus inside (an account change) used to leave a layer behind
  // that swallowed every later Escape.
  useEscapeToClose(() => {
    if (!focused) return;
    if (focused.autoCloseMs === null) giveFocusBack();
    else close(focused.id);
  }, focused !== undefined);

  return (
    <BodyPortal>
      {/* In the page from the start, with only their text changing, which is
          what gets announced reliably: a node inserted with its text already
          in it often is not. The buttons are not in here, so they are not
          read out as part of the message. */}
      <div role="status" aria-live="polite" className="sr-only">{live.polite}</div>
      <div role="alert" aria-live="assertive" className="sr-only">{live.assertive}</div>

      {/* The stack takes no clicks itself: only the toasts do. A new toast
          goes on top. With the player bar showing, the stack starts above it,
          and above a view's own bottom bar when the view has one and says so
          (`useToastFloor`: the message box, whose Send is in this corner).
          It is a named region only while there is something in it. */}
      <div
        ref={stack}
        data-toast-stack
        role={toasts.length > 0 ? "region" : undefined}
        aria-label={toasts.length > 0 ? "Messages from Vega" : undefined}
        className="fixed bottom-[calc(1rem+var(--toast-floor,0px))] right-4 z-[60] flex flex-col-reverse items-end gap-2 pointer-events-none [body:has([data-player-bar])_&]:bottom-[calc(4.5rem+var(--toast-floor,0px))]"
      >
        {toasts.map((toast) => {
          const kind = KIND[toast.type];
          const Icon = kind.icon;
          const messageId = `toast-${toast.id}`;
          return (
            <div
              key={toast.id}
              data-toast={toast.id}
              onPointerEnter={pointerEntered}
              onPointerLeave={(e) => { if (!inStack(e.relatedTarget)) pointerLeft(); }}
              // Focus holds this toast alone, and for its own reason: the
              // pointer leaving must not start the clock while focus is inside.
              onFocus={(e) => {
                // Coming in from outside the stack: that is where focus goes
                // back to. From nowhere (F6 with nothing focused) there is
                // nowhere, and an element remembered from an earlier visit
                // would be the wrong place, and scroll the page to itself.
                // Back from another window into the toast it left is not
                // "from nowhere" either: where it came from still stands.
                const from = e.relatedTarget;
                const back = from === null && awayFrom.current === toast.id;
                awayFrom.current = null;
                if (!back && !inStack(from)) cameFrom.current = from instanceof HTMLElement ? from : null;
                setFocusedId(toast.id);
                holdToast(toast.id, "focus");
              }}
              onBlur={(e) => {
                if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return; // still inside this toast
                // To nowhere, and the window has lost the keyboard: the user
                // went to another window, not to another place in this one.
                if (e.relatedTarget === null && !document.hasFocus()) awayFrom.current = toast.id;
                setFocusedId((id) => (id === toast.id ? null : id));
                releaseToast(toast.id, "focus");
              }}
              className="pointer-events-auto flex items-stretch min-w-60 max-w-md bg-bg-raised border border-border shadow-lg toast-enter rounded-lg overflow-hidden"
            >
              <div aria-hidden className={`w-1 shrink-0 ${kind.stripe}`} />
              <div className="flex flex-1 items-start gap-1 py-1.5 pl-2.5 pr-1.5">
                <Icon aria-hidden size={16} strokeWidth={1.75} className={`mt-1.5 shrink-0 ${kind.tint}`} />
                <p id={messageId} className="flex-1 py-1 pl-1 text-body text-text break-words">
                  <span className="sr-only">{kind.word}: </span>
                  {toast.message}
                </p>
                {toast.action && (
                  <Button
                    size="sm"
                    aria-describedby={messageId}
                    onClick={() => {
                      const { run, keepOpen } = toast.action ?? {};
                      // Removed first: the action may raise a toast with the same key (a retry that fails again).
                      if (!keepOpen) close(toast.id);
                      run?.();
                    }}
                  >
                    {toast.action.label}
                  </Button>
                )}
                <Button variant="ghost" size="sm" aria-label="Dismiss" aria-describedby={messageId} onClick={() => close(toast.id)}>
                  <X />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </BodyPortal>
  );
}
