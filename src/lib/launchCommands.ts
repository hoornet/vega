import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUIStore } from "../stores/ui";
import { debug } from "./debug";
import { MODAL_SELECTOR } from "./escapeKey";

/**
 * How long `vega --compose` waits for a compose box that is not there yet. On a cold start the box
 * mounts once the session is restored, and a remote signer is given up to half a minute for that.
 */
export const COMPOSE_HOLD_MS = 60_000;

/**
 * What a launch of Vega asked for (`src-tauri/src/launch.rs`): `vega --compose` is
 * "compose". A second launch hands its command line to the running Vega and exits, so this
 * is how a bar button, a keybinding or a script asks Vega for something.
 */
export type LaunchCommand = "compose";

export function runLaunchCommand(command: LaunchCommand): void {
  switch (command) {
    case "compose":
      // An open dialog is what needs the user: the window comes forward and nothing moves behind
      // the dialog, as the `n` shortcut is held back (useKeyboardShortcuts).
      if (document.querySelector(MODAL_SELECTOR)) return;
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
