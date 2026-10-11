import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUserStore, SavedAccount } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { LoginModal } from "../shared/LoginModal";
import { shortenPubkey } from "../../lib/utils";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import { Button } from "../shared/Button";

function Avatar({ account, size = "w-6 h-6", textSize = "text-[10px]" }: { account: SavedAccount; size?: string; textSize?: string }) {
  const initial = (account.name || account.npub || "?").charAt(0).toUpperCase();
  if (account.picture) {
    return (
      <img
        src={account.picture}
        alt={`${account.name || "Account"} avatar`}
        className={`${size} rounded-full object-cover shrink-0`}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div className={`${size} rounded-full bg-accent/20 flex items-center justify-center text-accent ${textSize} shrink-0`}>
      {initial}
    </div>
  );
}

/**
 * Removing an account deletes its secret key from the OS keychain. For anyone
 * who created the account in Vega and has not saved the key elsewhere, that is
 * the only copy, so this used to be permanent identity loss on one click of a
 * 10px link that sat beside "Sign out". Now it says what will happen, offers
 * the key first, and needs a second, deliberate click.
 */
function RemoveAccountConfirm({ account, name, onCancel, onConfirm }: {
  account: SavedAccount;
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const holdsKey = account.loginType === "nsec";
  // Escape backs out of the dangerous action, and does only that: without
  // this it reached the app-wide handler and could navigate back while the
  // confirmation stayed open.
  useEscapeToClose(onCancel);

  const copyKey = async () => {
    try {
      const nsec = await invoke<string | null>("load_nsec", { pubkey: account.pubkey });
      if (!nsec) throw new Error("no key stored");
      await navigator.clipboard.writeText(nsec);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div role="alertdialog" aria-label={`Remove ${name} from this computer`} className="px-3 py-3 border-b border-border-subtle">
      <p className="text-text text-body font-medium mb-1.5 break-words">Remove {name} from this computer?</p>
      <p className="text-text-muted text-caption leading-relaxed mb-3">
        {holdsKey
          ? "This deletes the secret key stored on this computer. Without a copy of it you can never sign in to this account again."
          : account.loginType === "remote-signer"
            ? "This forgets the connection to your remote signer. You can add the account again with a new bunker address."
            : "This account is read-only here. You can add it again any time."}
      </p>
      {holdsKey && (
        <Button wrap className="w-full mb-1.5" onClick={copyKey}>
          {copyState === "copied" ? "Copied. Paste it somewhere safe." : copyState === "failed" ? "Couldn't read the key. Copy it from Settings." : "Copy secret key first"}
        </Button>
      )}
      <Button variant="primary" tone="danger" className="w-full mb-1.5" onClick={onConfirm}>Remove account</Button>
      <Button variant="ghost" autoFocus className="w-full" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

export function AccountSwitcher() {
  const { accounts, pubkey, loggedIn, switchAccount, removeAccount, logout } = useUserStore();
  const { openProfile } = useUIStore();
  const [open, setOpen] = useState(false);
  const [showAddLogin, setShowAddLogin] = useState(false);
  // The account awaiting a second click before it is removed, if any.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const current = accounts.find((a) => a.pubkey === pubkey) ?? null;
  const others = accounts.filter((a) => a.pubkey !== pubkey);

  const displayName = (a: SavedAccount) =>
    a.name || shortenPubkey(a.npub);

  const handleSwitch = async (targetPubkey: string) => {
    setOpen(false);
    await switchAccount(targetPubkey);
  };

  // Asking to remove never removes: it opens the confirmation.
  const askRemove = (e: React.MouseEvent, targetPubkey: string) => {
    e.stopPropagation();
    setConfirmRemove(targetPubkey);
  };

  const confirmTarget = confirmRemove ? accounts.find((a) => a.pubkey === confirmRemove) ?? null : null;

  const handleAddAccount = () => {
    setOpen(false);
    setShowAddLogin(true);
  };

  // Not logged in
  if (!pubkey || !current) {
    return (
      <>
        <div className="border-t border-border-subtle px-3 py-2">
          {accounts.length > 0 && (
            <div className="mb-1.5">
              {accounts.map((a) => (
                <button
                  key={a.pubkey}
                  onClick={() => handleSwitch(a.pubkey)}
                  className="w-full flex items-center gap-2 px-1 py-1 text-left hover:bg-text/8 transition-colors"
                >
                  <Avatar account={a} />
                  <span className="text-text-muted text-ui truncate flex-1">{displayName(a)}</span>
                </button>
              ))}
              <div className="border-t border-border-subtle my-1" />
            </div>
          )}
          <Button className="w-full" onClick={() => setShowAddLogin(true)}>Login</Button>
        </div>
        {showAddLogin && <LoginModal onClose={() => setShowAddLogin(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="border-t border-border-subtle shrink-0">
        {/* Dropdown — other accounts + actions */}
        {open && confirmTarget && (
          <RemoveAccountConfirm
            account={confirmTarget}
            name={displayName(confirmTarget)}
            onCancel={() => setConfirmRemove(null)}
            onConfirm={() => {
              const target = confirmTarget.pubkey;
              setConfirmRemove(null);
              setOpen(false);
              removeAccount(target);
            }}
          />
        )}
        {open && !confirmTarget && (
          <div className="border-b border-border-subtle">
            {others.map((a) => (
              <div
                key={a.pubkey}
                className="flex items-center gap-2 px-3 py-2 hover:bg-text/8 cursor-pointer group transition-colors"
                onClick={() => handleSwitch(a.pubkey)}
              >
                <Avatar account={a} />
                <span className="text-text-muted text-ui truncate flex-1">{displayName(a)}</span>
                {a.loginType === "remote-signer" && (
                  <span className="text-caption text-text-dim" title="Remote signer (NIP-46)">NIP-46</span>
                )}
                <button
                  onClick={(e) => askRemove(e, a.pubkey)}
                  className="text-text-dim hover:text-danger text-[11px] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  title="Remove account from this computer…"
                  aria-label={`Remove ${displayName(a)} from this computer`}
                >
                  ×
                </button>
              </div>
            ))}

            <button
              onClick={handleAddAccount}
              className="w-full flex items-center gap-2 px-3 py-2 text-text-dim hover:text-accent hover:bg-text/8 text-ui transition-colors"
            >
              <span className="w-6 text-center text-[12px]">+</span>
              <span>Add account</span>
            </button>

            <div className="border-t border-border-subtle mx-3 my-1" />

            <button
              onClick={() => { setOpen(false); logout(); }}
              title="Sign out. The account stays on this computer for quick switching."
              className="w-full px-3 py-1.5 text-left text-text-muted hover:text-text hover:bg-text/8 text-ui transition-colors"
            >
              {/* The hint is what tells this apart from removing the key. It
                  has its own line: beside the label it was cut off at the
                  sidebar's default width. */}
              <span className="block">Sign out</span>
              <span className="block text-text-dim text-caption">keeps this account here</span>
            </button>
            <button
              onClick={(e) => askRemove(e, pubkey)}
              className="w-full px-3 py-1.5 text-left leading-snug text-text-dim hover:text-danger hover:bg-text/8 text-ui transition-colors"
            >
              Remove from this computer…
            </button>
          </div>
        )}

        {/* Active account row */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => openProfile(pubkey)}
            >
              <Avatar account={current} size={loggedIn ? "w-11 h-11" : "w-8 h-8"} textSize={loggedIn ? "text-[16px]" : "text-[12px]"} />
              <span className={`font-medium truncate flex-1 ${loggedIn ? "text-body text-text" : "text-ui text-text-muted"}`}>{displayName(current)}</span>
            </div>
            <button
              onClick={() => { setConfirmRemove(null); setOpen((v) => !v); }}
              className="text-text-dim hover:text-text text-[14px] transition-colors px-1"
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
