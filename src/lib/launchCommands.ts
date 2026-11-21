import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUIStore } from "../stores/ui";
import { useToastStore, goToView } from "../stores/toast";
import { debug } from "./debug";
import { MODAL_SELECTOR } from "./escapeKey";
import { unsentTextNotice } from "./unsentText";
import { readNostrReference, openNostrReference } from "./nostrLinks";

/**
 * How long `vega --compose` waits for a compose box that is not there yet. On a cold start the box
 * mounts once the session is restored, and a remote signer is given up to half a minute for that.
 */
export const COMPOSE_HOLD_MS = 60_000;

/**
 * What a launch of Vega asked for (`src-tauri/src/launch.rs`): `vega --compose` is
 * "compose", and a `nostr:` link is `{ open: "nostr:…" }`. A second launch hands its command
 * line to the running Vega and exits, so this is how a bar button, a keybinding, a script or a
 * link clicked in another app asks Vega for something.
 */
export type LaunchCommand = "compose" | { open: string };

/** The toast that stands for one link, from "Opening…" to what became of it. */
const LINK_TOAST = "launch:link";

let ready = false;
let waitingLink: string | null = null;
let latestLink = 0;

/**
 * Says that the app is past onboarding, and opens the link that was waiting for it, if any. Until
 * then a link waits, the newest one: someone may install Vega because they clicked a `nostr:` link,
 * and should land on what they clicked once they have a key. App calls this.
 */
export function launchCommandsReady(): void {
  ready = true;
  const link = waitingLink;
  waitingLink = null;
  if (link) openLinkFromOutside(link);
}

/**
 * Opens a `nostr:` link handed over from outside: what it names, never more (`openNostrReference`).
 * An open dialog and text not sent yet hold it, as they hold `--compose`, with a toast that says
 * so, since the click happened in another window. A newer link wins over a lookup still running.
 */
export function openLinkFromOutside(link: string): void {
  if (!ready) {
    waitingLink = link;
    return;
  }
  const toasts = useToastStore.getState();
  if (document.querySelector(MODAL_SELECTOR)) {
    toasts.addToast("A dialog is open, so Vega didn't open the link. Close it, then open the link again.", "info", { key: LINK_TOAST });
    return;
  }
  const notice = unsentTextNotice("the link");
  if (notice) {
    toasts.addToast(notice, "info", { autoCloseMs: 6000, key: LINK_TOAST });
    return;
  }
  const reference = readNostrReference(link);
  if (!reference) {
    toasts.addToast("Vega can't open that link. It opens links to people, notes and articles.", "error", { key: LINK_TOAST });
    return;
  }
  const mine = ++latestLink;
  const stillWanted = () => mine === latestLink;
  if (reference.kind !== "profile") toasts.addToast("Opening the link…", "info", { autoCloseMs: 15_000, key: LINK_TOAST });
  openNostrReference(reference, stillWanted)
    .then((outcome) => {
      if (outcome.status === "superseded") return;
      if (outcome.status === "opened") {
        useToastStore.getState().removeByKey(LINK_TOAST);
        return;
      }
      const where = outcome.hintsUnasked
        ? " The link names other relays, which Vega asks only with Relay reach on."
        : "";
      useToastStore.getState().addToast(
        `Couldn't find that ${outcome.what} on your relays.${where}`,
        "error",
        { key: LINK_TOAST, ...(outcome.hintsUnasked ? { action: { label: "Relays", run: goToView("relays") } } : {}) },
      );
    })
    .catch((err) => {
      debug.warn("[launch] could not open a link:", err);
      if (stillWanted()) useToastStore.getState().addToast("Couldn't open that link.", "error", { key: LINK_TOAST });
    });
}

export function runLaunchCommand(command: LaunchCommand): void {
  if (typeof command === "object") {
    if (typeof command.open === "string") openLinkFromOutside(command.open);
    return;
  }
  switch (command) {
    case "compose":
      // An open dialog is what needs the user: the window comes forward and nothing moves behind
      // the dialog, as the `n` shortcut is held back (useKeyboardShortcuts).
      if (document.querySelector(MODAL_SELECTOR)) return;
      // So does text not sent yet in a view the feed would replace: leaving would lose it, and the
      // request came from another window, where nobody could see it (src/lib/unsentText.ts).
      {
        const notice = unsentTextNotice();
        if (notice) {
          useToastStore.getState().addToast(notice, "info", { autoCloseMs: 6000, key: "launch:compose-held" });
          return;
        }
      }
      useUIStore.getState().requestComposeWhenReady(COMPOSE_HOLD_MS);
      break;
  }
}

/**
 * Runs what launches of Vega ask for: this launch's own command line, and every later
 * launch's. Rust keeps the commands in a queue and says when one arrives
 * (`launch-command`); the queue is taken at the start, again once the listener is in place
 * (a command that arrived in between was announced to nobody), and on every event.
 *
 * A command that was taken is run even if the listener has been stopped by then: running a
 * request twice (StrictMode mounts twice) is harmless, losing it is not.
 *
 * Returns a function that stops listening.
 */
export function listenForLaunchCommands(run: (command: LaunchCommand) => void = runLaunchCommand): () => void {
  let stopped = false;
  let unlisten: (() => void) | null = null;
  const take = () => {
    invoke<LaunchCommand[]>("take_launch_commands")
      .then((commands) => { for (const command of commands ?? []) run(command); })
      .catch((err) => debug.warn("[launch] could not take the launch commands:", err));
  };
  listen("launch-command", take)
    .then((stop) => {
      if (stopped) stop();
      else { unlisten = stop; take(); }
    })
    // The browser dev harness has no event bridge.
    .catch((err) => debug.warn("[launch] no launch-command events:", err));
  take();
  return () => {
    stopped = true;
    unlisten?.();
  };
}
