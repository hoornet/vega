import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  Rss, BookOpen, Image as ImageIcon, Mic2, Search, Bookmark, Mail, Bell,
  Users, Zap, Radio, Wifi, Settings, Heart, PenLine,
} from "lucide-react";
import { useUIStore, type View } from "../../stores/ui";
import { useCanSign } from "../../stores/user";
import { useNotificationsStore } from "../../stores/notifications";
import { useDraftStore } from "../../stores/drafts";
import { useBookmarkStore } from "../../stores/bookmark";
import { AccountSwitcher } from "./AccountSwitcher";
import pkg from "../../../package.json";

// Items marked `requiresSigner: true` are hidden in read-only mode
// because they're account-bound and have no useful content without a signer.
interface NavItem {
  id: View;
  label: string;
  icon: ReactNode;
  requiresSigner?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "feed", label: "Feed", icon: <Rss size={15} /> },
  { id: "articles", label: "Articles", icon: <BookOpen size={15} /> },
  { id: "media", label: "Media", icon: <ImageIcon size={15} /> },
  { id: "podcasts", label: "Podcasts", icon: <Mic2 size={15} /> },
  { id: "search", label: "Search", icon: <Search size={15} /> },
  { id: "bookmarks", label: "Bookmarks", icon: <Bookmark size={15} />, requiresSigner: true },
  { id: "dm", label: "Messages", icon: <Mail size={15} />, requiresSigner: true },
  { id: "notifications", label: "Notifications", icon: <Bell size={15} />, requiresSigner: true },
  { id: "follows", label: "People", icon: <Users size={15} /> },
  { id: "zaps", label: "Zaps", icon: <Zap size={15} />, requiresSigner: true },
  { id: "v4v", label: "Value 4 Value", icon: <Radio size={15} />, requiresSigner: true },
  { id: "relays", label: "Relays", icon: <Wifi size={15} /> },
  { id: "settings", label: "Settings", icon: <Settings size={15} /> },
  { id: "about", label: "Support", icon: <Heart size={15} /> },
];

export function Sidebar() {
  const { currentView, setView, sidebarCollapsed, toggleSidebar } = useUIStore();
  const canSign = useCanSign();
  const { unreadCount: notifUnread, dmUnreadCount, newFollowersCount } = useNotificationsStore();
  const draftCount = useDraftStore((s) => s.drafts.length);
  const bookmarkUnread = useBookmarkStore((s) => s.unreadArticleCount());
  const visibleNav = NAV_ITEMS.filter((item) => !("requiresSigner" in item && item.requiresSigner) || canSign);

  const c = sidebarCollapsed;

  // Resizable width when expanded (issue #6), persisted to localStorage.
  const SIDEBAR_WIDTH_KEY = "wrystr_sidebar_width";
  const MIN_WIDTH = 160;
  const MAX_WIDTH = 360;
  const DEFAULT_WIDTH = 192; // matches the old w-48
  const asideRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? "", 10);
    return Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const left = asideRef.current?.getBoundingClientRect().left ?? 0;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - left)));
    };
    const onUp = () => setDragging(false);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }, [width]);

  return (
    <aside
      ref={asideRef}
      style={c ? undefined : { width }}
      className={`relative h-full border-r border-border bg-bg flex flex-col shrink-0 ${
        dragging ? "" : "transition-all duration-150"
      } ${c ? "w-12" : ""}`}
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
            <span className="relative w-4 flex items-center justify-center shrink-0">
              <PenLine size={15} />
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
              <span className="relative w-4 flex items-center justify-center shrink-0">
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

      {/* Resize handle — drag to set sidebar width (expanded only) */}
      {!c && (
        <div
          onMouseDown={(e) => { e.preventDefault(); setDragging(true); }}
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          title="Drag to resize • double-click to reset"
          role="separator"
          aria-orientation="vertical"
          className={`absolute top-0 right-0 h-full w-1 cursor-col-resize transition-colors ${
            dragging ? "bg-accent/50" : "hover:bg-accent/40"
          }`}
        />
      )}

    </aside>
  );
}
