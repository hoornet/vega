import { useUIStore } from "../../stores/ui";
import { useFeedStore } from "../../stores/feed";
import { useUserStore } from "../../stores/user";
import { getNDK } from "../../lib/nostr";
import { AccountSwitcher } from "./AccountSwitcher";

const NAV_ITEMS = [
  { id: "feed" as const, label: "feed", icon: "◈" },
  { id: "search" as const, label: "search", icon: "⌕" },
  { id: "dm" as const, label: "messages", icon: "✉" },
  { id: "zaps" as const, label: "zaps", icon: "⚡" },
  { id: "relays" as const, label: "relays", icon: "⟐" },
  { id: "settings" as const, label: "settings", icon: "⚙" },
  { id: "about" as const, label: "support", icon: "♥" },
] as const;

export function Sidebar() {
  const { currentView, setView, sidebarCollapsed, toggleSidebar } = useUIStore();
  const { connected, notes } = useFeedStore();
  const { loggedIn } = useUserStore();

  const c = sidebarCollapsed;

  return (
    <aside
      className={`h-full border-r border-border bg-bg flex flex-col transition-all duration-150 shrink-0 ${
        c ? "w-12" : "w-48"
      }`}
    >
      {/* Header / logo */}
      <div className="border-b border-border px-2 py-2.5 flex items-center justify-between shrink-0">
        {c ? (
          /* Collapsed: just the expand chevron, centred */
          <button
            onClick={toggleSidebar}
            title="Expand sidebar"
            className="w-full flex items-center justify-center text-text-dim hover:text-accent transition-colors"
          >
            <span className="text-[13px]">›</span>
          </button>
        ) : (
          /* Expanded: brand on left, collapse chevron on right */
          <>
            <span className="text-sm font-bold tracking-widest text-text select-none">WRYSTR</span>
            <button
              onClick={toggleSidebar}
              title="Collapse sidebar"
              className="text-text-dim hover:text-accent transition-colors px-1"
            >
              <span className="text-[13px]">‹</span>
            </button>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {/* Write article — show icon even when collapsed */}
        {loggedIn && !!getNDK().signer && (
          <button
            onClick={() => setView("article-editor")}
            title="Write article"
            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] transition-colors mb-1 ${
              currentView === "article-editor"
                ? "text-accent bg-accent/8"
                : "text-text-muted hover:text-text hover:bg-bg-hover"
            }`}
          >
            <span className="w-4 text-center text-[14px]">✦</span>
            {!c && <span>write article</span>}
          </button>
        )}

        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={c ? item.label : undefined}
            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] transition-colors ${
              currentView === item.id
                ? "text-accent bg-accent/8"
                : "text-text-muted hover:text-text hover:bg-bg-hover"
            }`}
          >
            <span className="w-4 text-center text-[14px]">{item.icon}</span>
            {!c && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Account switcher (full) — expanded only */}
      {!c && <AccountSwitcher />}

      {/* Footer — connection status */}
      <div className={`border-t border-border shrink-0 ${c ? "py-2 flex justify-center" : "px-3 py-2"}`}>
        {c ? (
          /* Collapsed: single dot */
          <span
            title={connected ? "Online" : "Offline"}
            className={`w-2 h-2 rounded-full inline-block ${connected ? "bg-success" : "bg-danger"}`}
          />
        ) : (
          /* Expanded: dot + label + note count */
          <div className="text-[10px] text-text-dim">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-success" : "bg-danger"}`} />
              <span>{connected ? "online" : "offline"}</span>
            </div>
            <div className="mt-0.5">{notes.length} notes</div>
          </div>
        )}
      </div>
    </aside>
  );
}
