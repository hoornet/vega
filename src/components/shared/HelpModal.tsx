import { Dialog } from "./Dialog";

const SHORTCUTS = [
  { key: "n", desc: "New note / focus compose" },
  { key: "/", desc: "Search" },
  { key: "j", desc: "Next note in feed" },
  { key: "k", desc: "Previous note in feed" },
  { key: "Esc", desc: "Go back, or close what is open" },
  { key: "?", desc: "This help" },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" size="sm" onClose={onClose}>
      <div className="px-4 py-4 space-y-2">
        {SHORTCUTS.map(({ key, desc }) => (
          <div key={key} className="flex items-center gap-3">
            <kbd className="bg-bg border border-border text-text text-micro font-mono px-2 py-0.5 min-w-[2.5rem] text-center shrink-0 rounded-sm">
              {key}
            </kbd>
            <span className="text-text-muted text-body">{desc}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
