import { useUIStore } from "../../stores/ui";
import { useCanSign } from "../../stores/user";
import { useNotificationsStore } from "../../stores/notifications";
import { useDraftStore } from "../../stores/drafts";
import { useBookmarkStore } from "../../stores/bookmark";
import { AccountSwitcher } from "./AccountSwitcher";
import pkg from "../../../package.json";

// Items marked `requiresSigner: true` are hidden in read-only mode
// because they're account-bound and have no useful content without a signer.
const NAV_ITEMS = [
  { id: "feed" as const, label: "Feed", icon: "◈" },
  { id: "articles" as const, label: "Articles", icon: "☰" },
  { id: "media" as const, label: "Media", icon: "▶" },
  { id: "podcasts" as const, label: "Podcasts", icon: "🎙" },
  { id: "search" as const, label: "Search", icon: "⌕" },
  { id: "bookmarks" as const, label: "Bookmarks", icon: "★", requiresSigner: true },
  { id: "dm" as const, label: "Messages", icon: "✉", requiresSigner: true },
  { id: "notifications" as const, label: "Notifications", icon: "🔔", requiresSigner: true },
  { id: "follows" as const, label: "People", icon: "👥" },
  { id: "zaps" as const, label: "Zaps", icon: "⚡", requiresSigner: true },
  { id: "v4v" as const, label: "Value 4 Value", icon: "📡", requiresSigner: true },
  { id: "relays" as const, label: "Relays", icon: "⟐" },
  { id: "settings" as const, label: "Settings", icon: "⚙" },
  { id: "about" as const, label: "Support", icon: "♥" },
] as const;

export function Sidebar() {
  const { currentView, setView, sidebarCollapsed, toggleSidebar } = useUIStore();
  const canSign = useCanSign();
  const { unreadCount: notifUnread, dmUnreadCount, newFollowersCount } = useNotificationsStore();
  const draftCount = useDraftStore((s) => s.drafts.length);
  const bookmarkUnread = useBookmarkStore((s) => s.unreadArticleCount());
  const visibleNav = NAV_ITEMS.filter((item) => !("requiresSigner" in item && item.requiresSigner) || canSign);

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
            aria-label="Expand sidebar"
            className="w-full flex items-center justify-center text-text-dim hover:text-accent transition-colors"
          >
            <span className="text-[13px]">›</span>
          </button>
        ) : (
          /* Expanded: brand on left, collapse chevron on right */
          <>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-[0.2em] text-text select-none">VEGA</span>
              <span className="text-text-dim text-[9px] font-mono opacity-50">v{pkg.version}</span>
            </div>
            <button
              onClick={toggleSidebar}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
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
        {canSign && (
          <button
            onClick={() => setView("article-editor")}
            title="Write article"
            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] transition-colors mb-1 ${
              currentView === "article-editor"
                ? "text-accent bg-accent/8"
                : "text-text-muted hover:text-text hover:bg-bg-hover"
            }`}
          >
            <span className="relative w-4 text-center text-[14px]">
              ✦
              {c && draftCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />
              )}
            </span>
            {!c && <span>Write Article</span>}
            {!c && draftCount > 0 && (
              <span className="ml-auto text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-sm">{draftCount}</span>
            )}
          </button>
        )}

        {visibleNav.map((item) => {
          const badge = item.id === "dm" ? dmUnreadCount : item.id === "notifications" ? notifUnread : item.id === "bookmarks" ? bookmarkUnread : item.id === "follows" ? newFollowersCount : 0;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              title={c ? item.label : undefined}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] transition-colors ${
                currentView === item.id
                  ? "text-accent bg-accent/10"
                  : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
            >
              <span className="relative w-4 text-center text-[14px]">
                {item.icon}
                {badge > 0 && c && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />
                )}
              </span>
              {!c && <span>{item.label}</span>}
              {!c && badge > 0 && (
                <span className="ml-auto text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-sm">{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Account switcher (full) — expanded only, always visible at bottom */}
      {!c && (
        <div className="shrink-0">
          <AccountSwitcher />
        </div>
      )}

    </aside>
  );
}
