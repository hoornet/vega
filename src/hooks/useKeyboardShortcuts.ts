import { useEffect } from "react";
import { useUIStore } from "../stores/ui";
import { useFeedStore } from "../stores/feed";
import { escapeAction } from "../lib/escapeKey";

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

      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
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
              dialogOpen: document.querySelector('[role="dialog"][aria-modal="true"]') !== null,
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
