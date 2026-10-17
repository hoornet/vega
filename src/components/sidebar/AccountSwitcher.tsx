import { useCallback, useRef, useState, useEffect } from "react";
import { useUserStore, SavedAccount, readSecretKey } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { useNotificationsStore } from "../../stores/notifications";
import { ChevronsUpDown, LogIn, UserRound, Users, Zap } from "lucide-react";
import { LoginModal } from "../shared/LoginModal";
import { shortenPubkey } from "../../lib/utils";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import { usePopoverDismiss, type DismissReason } from "../../hooks/usePopoverDismiss";
import { Button } from "../shared/Button";
import { copyText } from "../../lib/clipboard";

function Avatar({ account, size = "w-6 h-6", textSize = "text-[10px]" }: { account: SavedAccount; size?: string; textSize?: string }) {
  const initial = (account.name || account.npub || "?").charAt(0).toUpperCase();
  // A picture that fails to load falls back to the initial. It used to hide
  // the <img>, which left a button with nothing in it and no size: collapsed,
  // the only account control was gone.
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [account.picture]);
  if (account.picture && !failed) {
    return (
      <img
        src={account.picture}
        alt={`${account.name || "Account"} avatar`}
        className={`${size} rounded-full object-cover shrink-0`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={`${size} rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim ${textSize} shrink-0`}>
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
export function RemoveAccountConfirm({ account, name, onCancel, onConfirm }: {
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
    // Two things can fail, and they are not the same. The key may not be on
    // this computer at all, or the clipboard may refuse it. Both used to read
    // "Couldn't read the key. Copy it from Settings.", which was wrong about
    // a clipboard failure. The key is looked for in the keychain and then in
    // this session: an account the keychain never took still has one here.
    const key = await readSecretKey(account.pubkey);
    if (!key) { setCopyState("failed"); return; }
    setCopyState((await copyText(key.nsec)) ? "copied" : "idle");
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
          {copyState === "copied" ? "Copied. Paste it somewhere safe." : copyState === "failed" ? "No key for this account is on this computer." : "Copy secret key first"}
        </Button>
      )}
      <Button variant="primary" tone="danger" className="w-full mb-1.5" onClick={onConfirm}>Remove account</Button>
      <Button variant="ghost" autoFocus className="w-full" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

/**
 * The account when the sidebar is collapsed: the avatar alone, opening your
 * profile. Collapsed, the account used to be gone altogether, and with it
 * your profile, switching and signing out.
 */
export function CollapsedAccount() {
  const { accounts, pubkey } = useUserStore();
  const { toggleSidebar } = useUIStore();
  const newFollowers = useNotificationsStore((s) => s.newFollowersCount);
  const [showLogin, setShowLogin] = useState(false);
  const current = accounts.find((a) => a.pubkey === pubkey) ?? null;
  return (
    <div className="border-t border-border-subtle shrink-0 py-2 flex justify-center">
      {current ? (
        // The avatar expands the sidebar, where the account row and its menu
        // (profile, People, Zap history, switching, signing out) are. A dot says
        // there are new followers, which the menu's People item counts.
        <button type="button" onClick={toggleSidebar} title={`${current.name || shortenPubkey(current.npub)}: expand for the account menu`} aria-label="Account: expand the sidebar for the account menu" className="relative w-8 h-8 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <Avatar account={current} size="w-8 h-8" textSize="text-ui" />
          {newFollowers > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent border border-bg-raised" aria-hidden />}
        </button>
      ) : (
        <>
          <Button square variant="ghost" onClick={() => setShowLogin(true)} aria-label="Log in" title="Log in"><LogIn /></Button>
          {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
        </>
      )}
    </div>
  );
}

export function AccountSwitcher() {
  const { accounts, pubkey, loggedIn, switchAccount, removeAccount, logout } = useUserStore();
  const { openProfile, openView } = useUIStore();
  const newFollowers = useNotificationsStore((s) => s.newFollowersCount);
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

  // The menu closes on Escape and on a click outside it, like every other
  // menu. It used to stay open until its own arrow was pressed again, across
  // navigation. Not while the removal confirmation is up: there Escape backs
  // out of the confirmation and nothing else (see RemoveAccountConfirm), and a
  // stray click must not dismiss a question about deleting a key.
  const menuRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLButtonElement>(null);
  // Closed from the keyboard, focus goes back to the arrow that opened it.
  // Otherwise the focused item unmounts and focus falls to the page.
  const closeMenu = useCallback((reason: DismissReason) => {
    setOpen(false);
    if (reason === "escape") arrowRef.current?.focus();
  }, []);
  usePopoverDismiss(menuRef, open && !confirmTarget, closeMenu);

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
      <div ref={menuRef} className="border-t border-border-subtle shrink-0">
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
            {/* Your places. People and Zap history left the sidebar's list for here; Back returns from them. */}
            <button type="button" onClick={() => { setOpen(false); openProfile(pubkey); }} className="w-full flex items-center gap-2 px-3 py-2 text-text-muted hover:text-text hover:bg-text/8 text-ui transition-colors">
              <UserRound size={16} strokeWidth={1.75} className="w-6 shrink-0" /><span>Profile</span>
            </button>
            <button type="button" onClick={() => { setOpen(false); openView("follows"); }} className="w-full flex items-center gap-2 px-3 py-2 text-text-muted hover:text-text hover:bg-text/8 text-ui transition-colors">
              <Users size={16} strokeWidth={1.75} className="w-6 shrink-0" /><span>People</span>
              {newFollowers > 0 && <span className="ml-auto text-micro bg-accent text-accent-text px-1.5 py-0.5 rounded-sm" aria-label={`${newFollowers} new followers`}>{newFollowers}</span>}
            </button>
            <button type="button" onClick={() => { setOpen(false); openView("zaps"); }} className="w-full flex items-center gap-2 px-3 py-2 text-text-muted hover:text-text hover:bg-text/8 text-ui transition-colors">
              <Zap size={16} strokeWidth={1.75} className="w-6 shrink-0" /><span>Zap history</span>
            </button>
            <div className="border-t border-border-subtle mx-3 my-1" />
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
              onClick={() => { setOpen(false); openProfile(pubkey); }}
            >
              {/* 32px and semibold at the UI size: the 44px avatar beside a body-size name was the heaviest thing in the chrome. */}
              <Avatar account={current} size="w-8 h-8" textSize="text-ui" />
              <span className={`text-ui font-semibold truncate flex-1 ${loggedIn ? "text-text" : "text-text-muted"}`}>{displayName(current)}</span>
            </div>
            <Button
              square size="sm" variant="ghost"
              onClick={() => { setConfirmRemove(null); setOpen((v) => !v); }}
              ref={arrowRef}
              title="Switch account"
              aria-label={newFollowers > 0 ? `Switch account (${newFollowers} new followers)` : "Switch account"}
              aria-expanded={open}
              className="relative"
            >
              <ChevronsUpDown />
              {/* New followers are counted on the menu's People item; the dot says to look. */}
              {!open && newFollowers > 0 && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent" aria-hidden />}
            </Button>
          </div>
        </div>
      </div>

      {/* "Add account" is gone when the dialog closes, so focus is sent back to the arrow. */}
      {showAddLogin && <LoginModal onClose={() => setShowAddLogin(false)} returnFocus={arrowRef} />}
    </>
  );
}
