import { useState } from "react";
import { useUIStore } from "../../stores/ui";
import { useFeedStore } from "../../stores/feed";
import { useUserStore } from "../../stores/user";
import { LoginModal } from "../shared/LoginModal";
import { shortenPubkey } from "../../lib/utils";

const NAV_ITEMS = [
  { id: "feed" as const, label: "feed", icon: "◈" },
  { id: "search" as const, label: "search", icon: "⌕" },
  { id: "relays" as const, label: "relays", icon: "⟐" },
  { id: "settings" as const, label: "settings", icon: "⚙" },
] as const;

export function Sidebar() {
  const { currentView, setView, sidebarCollapsed, toggleSidebar, openProfile } = useUIStore();
  const { connected, notes } = useFeedStore();
  const { loggedIn, profile, npub, logout } = useUserStore();
  const [showLogin, setShowLogin] = useState(false);

  const userName = profile?.displayName || profile?.name || (npub ? shortenPubkey(npub) : null);
  const userAvatar = profile?.picture;

  return (
    <>
      <aside
        className={`h-full border-r border-border bg-bg flex flex-col transition-all duration-150 ${
          sidebarCollapsed ? "w-12" : "w-48"
        }`}
      >
        {/* Logo */}
        <div className="border-b border-border px-3 py-2.5 flex items-center justify-between shrink-0">
          <button
            onClick={toggleSidebar}
            className="text-text hover:text-accent transition-colors"
          >
            {sidebarCollapsed ? (
              <span className="text-sm font-bold">W</span>
            ) : (
              <span className="text-sm font-bold tracking-widest">WRYSTR</span>
            )}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {loggedIn && !sidebarCollapsed && (
            <button
              onClick={() => setView("article-editor")}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] transition-colors mb-1 ${
                currentView === "article-editor"
                  ? "text-accent bg-accent/8"
                  : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
            >
              <span className="w-4 text-center text-[14px]">✦</span>
              <span>write article</span>
            </button>
          )}
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] transition-colors ${
                currentView === item.id
                  ? "text-accent bg-accent/8"
                  : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
            >
              <span className="w-4 text-center text-[14px]">{item.icon}</span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* User / Login */}
        {!sidebarCollapsed && (
          <div className="border-t border-border shrink-0">
            {loggedIn ? (
              <div className="px-3 py-2">
                <div
                  className="flex items-center gap-2 mb-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => { const { pubkey } = useUserStore.getState(); if (pubkey) openProfile(pubkey); }}
                >
                  {userAvatar ? (
                    <img
                      src={userAvatar}
                      alt=""
                      className="w-6 h-6 rounded-sm object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-sm bg-accent/20 flex items-center justify-center text-accent text-[10px]">
                      {(userName || "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-text text-[11px] truncate flex-1">
                    {userName}
                  </span>
                </div>
                <button
                  onClick={logout}
                  className="text-text-dim hover:text-danger text-[10px] transition-colors"
                >
                  logout
                </button>
              </div>
            ) : (
              <div className="px-3 py-2">
                <button
                  onClick={() => setShowLogin(true)}
                  className="w-full px-2 py-1.5 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
                >
                  login
                </button>
              </div>
            )}
          </div>
        )}

        {/* Status footer */}
        {!sidebarCollapsed && (
          <div className="border-t border-border px-3 py-2 text-[10px] text-text-dim shrink-0">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-success" : "bg-danger"}`} />
              <span>{connected ? "online" : "offline"}</span>
            </div>
            <div className="mt-0.5">{notes.length} notes</div>
          </div>
        )}
      </aside>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
