const SHORTCUTS = [
  { key: "n", desc: "New note / focus compose" },
  { key: "/", desc: "Search" },
  { key: "j", desc: "Next note in feed" },
  { key: "k", desc: "Previous note in feed" },
  { key: "Esc", desc: "Go back, or close this" },
  { key: "?", desc: "This help" },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-bg border border-border shadow-xl p-6 w-72"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-text text-sm font-medium tracking-wide">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors text-[14px]"
          >
            ×
          </button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map(({ key, desc }) => (
            <div key={key} className="flex items-center gap-3">
              <kbd className="bg-bg-raised border border-border text-text text-[11px] font-mono px-2 py-0.5 min-w-[2.5rem] text-center shrink-0">
                {key}
              </kbd>
              <span className="text-text-dim text-[12px]">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
