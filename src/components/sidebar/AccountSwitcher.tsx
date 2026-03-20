import { useState } from "react";
import { useUserStore, SavedAccount } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { LoginModal } from "../shared/LoginModal";
import { shortenPubkey } from "../../lib/utils";

function Avatar({ account, size = "w-6 h-6", textSize = "text-[10px]" }: { account: SavedAccount; size?: string; textSize?: string }) {
  const initial = (account.name || account.npub || "?").charAt(0).toUpperCase();
  if (account.picture) {
    return (
      <img
        src={account.picture}
        alt=""
        className={`${size} rounded-sm object-cover shrink-0`}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div className={`${size} rounded-sm bg-accent/20 flex items-center justify-center text-accent ${textSize} shrink-0`}>
      {initial}
    </div>
  );
}

export function AccountSwitcher() {
  const { accounts, pubkey, loggedIn, switchAccount, removeAccount, logout } = useUserStore();
  const { openProfile } = useUIStore();
  const [open, setOpen] = useState(false);
  const [showAddLogin, setShowAddLogin] = useState(false);

  const current = accounts.find((a) => a.pubkey === pubkey) ?? null;
  const others = accounts.filter((a) => a.pubkey !== pubkey);

  const displayName = (a: SavedAccount) =>
    a.name || shortenPubkey(a.npub);

  const handleSwitch = async (targetPubkey: string) => {
    setOpen(false);
    await switchAccount(targetPubkey);
  };

  const handleRemove = (e: React.MouseEvent, targetPubkey: string) => {
    e.stopPropagation();
    removeAccount(targetPubkey);
  };

  const handleAddAccount = () => {
    setOpen(false);
    setShowAddLogin(true);
  };

  // Not logged in
  if (!pubkey || !current) {
    return (
      <>
        <div className="border-t border-border px-3 py-2">
          {accounts.length > 0 && (
            <div className="mb-1.5">
              {accounts.map((a) => (
                <button
                  key={a.pubkey}
                  onClick={() => handleSwitch(a.pubkey)}
                  className="w-full flex items-center gap-2 px-1 py-1 text-left hover:bg-bg-hover transition-colors"
                >
                  <Avatar account={a} />
                  <span className="text-text-muted text-[11px] truncate flex-1">{displayName(a)}</span>
                </button>
              ))}
              <div className="border-t border-border my-1" />
            </div>
          )}
          <button
            onClick={() => setShowAddLogin(true)}
            className="w-full px-2 py-1.5 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
          >
            login
          </button>
        </div>
        {showAddLogin && <LoginModal onClose={() => setShowAddLogin(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="border-t border-border shrink-0">
        {/* Dropdown — other accounts + actions */}
        {open && (
          <div className="border-b border-border">
            {others.map((a) => (
              <div
                key={a.pubkey}
                className="flex items-center gap-2 px-3 py-2 hover:bg-bg-hover cursor-pointer group transition-colors"
                onClick={() => handleSwitch(a.pubkey)}
              >
                <Avatar account={a} />
                <span className="text-text-muted text-[11px] truncate flex-1">{displayName(a)}</span>
                {a.loginType === "remote-signer" && (
                  <span className="text-[10px] text-text-dim" title="Remote signer (NIP-46)">NIP-46</span>
                )}
                <button
                  onClick={(e) => handleRemove(e, a.pubkey)}
                  className="text-text-dim hover:text-danger text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove account"
                >
                  ×
                </button>
              </div>
            ))}

            <button
              onClick={handleAddAccount}
              className="w-full flex items-center gap-2 px-3 py-2 text-text-dim hover:text-accent hover:bg-bg-hover text-[11px] transition-colors"
            >
              <span className="w-6 text-center text-[12px]">+</span>
              <span>add account</span>
            </button>

            <div className="border-t border-border mx-3 my-1" />

            <div className="flex items-center justify-between px-3 py-1.5">
              <button
                onClick={() => { setOpen(false); logout(); }}
                className="text-text-dim hover:text-danger text-[10px] transition-colors"
              >
                sign out
              </button>
              <button
                onClick={() => { setOpen(false); removeAccount(pubkey); }}
                className="text-text-dim hover:text-danger text-[10px] transition-colors"
              >
                remove
              </button>
            </div>
          </div>
        )}

        {/* Active account row */}
        <div className="px-3 py-2">
          {!loggedIn && (
            <button
              onClick={() => setShowAddLogin(true)}
              className="w-full mb-1.5 px-2 py-1 text-[10px] border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
            >
              re-login to sign
            </button>
          )}
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => openProfile(pubkey)}
            >
              <Avatar account={current} size="w-8 h-8" textSize="text-[12px]" />
              <span className={`text-[12px] font-medium truncate flex-1 ${loggedIn ? "text-text" : "text-text-muted"}`}>{displayName(current)}</span>
            </div>
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-text-dim hover:text-text text-[10px] transition-colors px-0.5"
              title="Switch account"
            >
              {open ? "▲" : "▼"}
            </button>
          </div>
        </div>
      </div>

      {showAddLogin && <LoginModal onClose={() => setShowAddLogin(false)} />}
    </>
  );
}
