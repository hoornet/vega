import { useEffect } from "react";
import { useUIStore } from "../stores/ui";
import { useFeedStore } from "../stores/feed";
import { escapeAction, shortcutBlocked, MODAL_SELECTOR } from "../lib/escapeKey";

/** The first button of the newest toast: its action if it has one, else Dismiss. */
function newestToastControl(): HTMLElement | null {
  // In the page oldest first, whatever order they are drawn in.
  return document.querySelector<HTMLElement>("[data-toast-stack] > [data-toast]:last-child button");
}

export function useKeyboardShortcuts() {
  const { currentView, setView, goBack, toggleHelp, showHelp, showDebugPanel, toggleDebugPanel } = useUIStore();
  const { focusedNoteIndex, setFocusedNoteIndex, notes } = useFeedStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+D works everywhere, even in text fields
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        toggleDebugPanel();
        return;
      }

      // F6 goes to the newest message in the corner, from anywhere, a dialog
      // or a text field included. Its "Undo" or "Try again" is otherwise
      // behind every control on the page in Tab order, with a few seconds to
      // get there.
      if (e.key === "F6") {
        const control = newestToastControl();
        if (control) {
          e.preventDefault();
          control.focus();
        }
        return;
      }

      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      const dialogOpen = document.querySelector(MODAL_SELECTOR) !== null;
      if (shortcutBlocked(e.key, dialogOpen)) return;
      switch (e.key) {
        case "n":
          setView("feed");
          setTimeout(() => (document.querySelector("[data-compose]") as HTMLTextAreaElement)?.focus(), 50);
          break;
        case "/":
          e.preventDefault();
          setView("search");
          setTimeout(() => (document.querySelector("[data-search-input]") as HTMLInputElement)?.focus(), 50);
          break;
        case "Escape":
          switch (
            escapeAction({
              showDebugPanel,
              showHelp,
              dialogOpen,
              stackDepth: useUIStore.getState().viewStack.length,
            })
          ) {
            case "close-debug-panel": toggleDebugPanel(); break;
            case "close-help": toggleHelp(); break;
            case "back": goBack(); break;
            case "nothing": break;
          }
          break;
        case "?":
          toggleHelp();
          break;
        case "j":
          if (currentView === "feed")
            setFocusedNoteIndex(Math.min(focusedNoteIndex + 1, notes.length - 1));
          break;
        case "k":
          if (currentView === "feed")
            setFocusedNoteIndex(Math.max(focusedNoteIndex - 1, 0));
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentView, focusedNoteIndex, notes.length, showDebugPanel, showHelp]);
}
