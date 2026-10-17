import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  Home, Bell, Mail, Bookmark, Search, BookOpen, Image as ImageIcon, Mic2,
  Settings, Wifi, CircleHelp, Heart, PenLine, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { useUIStore, type View } from "../../stores/ui";
import { useCanSign } from "../../stores/user";
import { useNotificationsStore } from "../../stores/notifications";
import { useDraftStore } from "../../stores/drafts";
import { useBookmarkStore } from "../../stores/bookmark";
import { AccountSwitcher, CollapsedAccount } from "./AccountSwitcher";
import { Button } from "../shared/Button";

// The sidebar, restructured after the October 2026 UI review. It was fifteen
// equal rows mixing destinations, ledgers (People, Zaps, Value 4 Value),
// settings screens and an action; Notifications and Messages sat eighth and
// ninth under Media and Podcasts; collapsed, the account row was gone and
// with it your profile, switching and signing out. Now: a Write button, four
// places you go back to, four places you explore, a footer of four tools, and
// the account. People and Zap history are in the account menu, Value 4 Value
// is reached from Podcasts, and the version string is in Settings.

interface NavItem {
  id: View;
  label: string;
  icon: ReactNode;
  /** Hidden in read-only mode: account-bound, nothing to show without a signer. */
  requiresSigner?: boolean;
}

const ICON = { size: 18, strokeWidth: 1.75 } as const;

/** Where you come back to. */
const PRIMARY: NavItem[] = [
  { id: "feed", label: "Home", icon: <Home {...ICON} /> },
  { id: "notifications", label: "Notifications", icon: <Bell {...ICON} />, requiresSigner: true },
  { id: "dm", label: "Messages", icon: <Mail {...ICON} />, requiresSigner: true },
  { id: "bookmarks", label: "Bookmarks", icon: <Bookmark {...ICON} />, requiresSigner: true },
];
/** Where you go to find things. */
const EXPLORE: NavItem[] = [
  { id: "search", label: "Search", icon: <Search {...ICON} /> },
  { id: "articles", label: "Articles", icon: <BookOpen {...ICON} /> },
  { id: "media", label: "Media", icon: <ImageIcon {...ICON} /> },
  { id: "podcasts", label: "Podcasts", icon: <Mic2 {...ICON} /> },
];
/** The tools, as icons at the bottom. */
const FOOTER: { id: View | "help"; label: string; icon: ReactNode }[] = [
  { id: "settings", label: "Settings", icon: <Settings /> },
  { id: "relays", label: "Relays", icon: <Wifi /> },
  { id: "help", label: "Keyboard shortcuts", icon: <CircleHelp /> },
  { id: "about", label: "Support", icon: <Heart /> },
];

export function Sidebar() {
  const { currentView, setView, sidebarCollapsed, toggleSidebar, showHelp, toggleHelp } = useUIStore();
  const canSign = useCanSign();
  const { unreadCount: notifUnread, dmUnreadCount } = useNotificationsStore();
  const draftCount = useDraftStore((s) => s.drafts.length);
  const bookmarkUnread = useBookmarkStore((s) => s.unreadArticleCount());
  const shown = (items: NavItem[]) => items.filter((item) => !item.requiresSigner || canSign);

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

  const badgeFor = (id: View) => (id === "dm" ? dmUnreadCount : id === "notifications" ? notifUnread : id === "bookmarks" ? bookmarkUnread : 0);

  const row = (item: NavItem) => {
    const badge = badgeFor(item.id);
    const active = currentView === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setView(item.id)}
        title={c ? item.label : undefined}
        aria-label={c ? (badge > 0 ? `${item.label}, ${badge} unread` : item.label) : undefined}
        aria-current={active ? "page" : undefined}
        className={`w-full text-left h-9 px-3 flex items-center gap-2.5 text-ui transition-colors ${
          active ? "text-accent bg-accent/10" : "text-text-muted hover:text-text hover:bg-text/8"
        }`}
      >
        <span className="relative w-5 flex items-center justify-center shrink-0">
          {item.icon}
          {badge > 0 && c && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />}
        </span>
        {!c && <span className="truncate">{item.label}</span>}
        {!c && badge > 0 && (
          <span className="ml-auto text-micro bg-accent text-accent-text px-1.5 py-0.5 rounded-sm">{badge}<span className="sr-only"> unread</span></span>
        )}
      </button>
    );
  };

  return (
    <aside
      ref={asideRef}
      style={c ? undefined : { width }}
      className={`relative h-full border-r border-border-subtle bg-bg-raised flex flex-col shrink-0 ${
        dragging ? "" : "transition-all duration-150"
      } ${c ? "w-12" : ""}`}
    >
      {/* Header: the wordmark and the collapse control, as tall as a view's header (48px plus its border), so the dividers line up. The version is in Settings and Support, not in the brand position. */}
      <div className={`h-12 box-content border-b border-border-subtle px-2 flex items-center shrink-0 ${c ? "justify-center" : "justify-between"}`}>
        {!c && <span className="pl-1 text-ui font-bold tracking-[0.2em] text-text select-none">VEGA</span>}
        <Button square size="sm" variant="ghost" onClick={toggleSidebar} aria-label={c ? "Expand sidebar" : "Collapse sidebar"} title={c ? "Expand sidebar" : "Collapse sidebar"}>
          {c ? <ChevronsRight /> : <ChevronsLeft />}
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 flex flex-col" aria-label="Main">
        {/* Write: an action, not a destination. */}
        {canSign && (
          <div className={`px-2 pb-2 ${c ? "flex justify-center" : ""}`}>
            {c ? (
              <Button square onClick={() => setView("article-editor")} current={currentView === "article-editor"} aria-label={draftCount > 0 ? `Write (${draftCount} drafts)` : "Write"} title="Write an article" className="relative">
                <PenLine />
                {draftCount > 0 && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />}
              </Button>
            ) : (
              <Button className="w-full" onClick={() => setView("article-editor")} current={currentView === "article-editor"}>
                <PenLine />Write
                {/* Beside the label, not at the far edge: at the edge it pushed the label off centre when a draft appeared. */}
                {draftCount > 0 && <span className="text-micro bg-accent text-accent-text px-1.5 py-0.5 rounded-sm">{draftCount}<span className="sr-only"> drafts</span></span>}
              </Button>
            )}
          </div>
        )}

        {shown(PRIMARY).map(row)}
        <div className="border-t border-border-subtle mx-3 my-2" role="separator" />
        {shown(EXPLORE).map(row)}
      </nav>

      {/* The tools: Settings, Relays, Help, Support. A group, not a toolbar: there is no arrow-key movement between them. */}
      <div className={`border-t border-border-subtle shrink-0 py-1.5 ${c ? "flex flex-col items-center gap-1" : "px-2 flex items-center justify-around"}`} role="group" aria-label="Tools">
        {FOOTER.map(({ id, label, icon }) => (
          // Help is a toggle (pressed while the dialog is open); the views are places (current).
          id === "help"
            ? <Button key={id} square variant="ghost" pressed={showHelp} onClick={toggleHelp} aria-label={label} title={label}>{icon}</Button>
            : <Button key={id} square variant="ghost" current={currentView === id} onClick={() => setView(id)} aria-label={label} title={label}>{icon}</Button>
        ))}
      </div>

      {/* The account: the full row and menu when expanded, the avatar alone when collapsed. */}
      {c ? <CollapsedAccount /> : (
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
