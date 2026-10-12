import { useState } from "react";
import { useCanSign, useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { useBackupStore } from "../../stores/backup";
import { nameOf } from "../../lib/utils";
import { Button } from "./Button";
import { LoginModal } from "./LoginModal";
import { BackupDialog } from "./BackupDialog";

/**
 * Who is looking, when they cannot post, and the way to an account.
 *
 * Nobody signed in: an offer, not a warning. It used to say "Read-only mode",
 * naming a mode the user never chose, in warning amber, and the only way on
 * was a small "Login" button whose dialog opened on "Paste your nsec".
 * Signed in with a public key only: say whose view it is and what a key adds.
 */
export function IdentityBanner() {
  const canSign = useCanSign();
  const pubkey = useUserStore((s) => s.pubkey);
  const loggedIn = useUserStore((s) => s.loggedIn);
  const restoring = useUserStore((s) => s.restoring);
  const accounts = useUserStore((s) => s.accounts);
  const openSignup = useUIStore((s) => s.openSignup);
  const [showLogin, setShowLogin] = useState(false);
  if (canSign) return null;
  // Who is signed in is not known until the saved session is restored, which
  // can take seconds with a remote signer. An offer to make an account, to
  // someone who has one, would be wrong for that long.
  if (restoring) return null;
  const account = accounts.find((a) => a.pubkey === pubkey);
  // A remote signer that did not answer is said elsewhere, with its reason.
  if (pubkey && loggedIn === false && account?.loginType === "remote-signer") return null;
  const name = pubkey ? nameOf(account, pubkey) : null;
  const text = pubkey
    ? account?.loginType === "pubkey"
      ? `Viewing as ${name}, read-only. Sign in with your key to post, reply and zap.`
      // An account made here whose key is not on this computer (no keychain, or the entry is gone).
      : `Viewing as ${name}, read-only: the key for this account is not on this computer. Sign in with your key to post, reply and zap.`
    : accounts.length > 0
      ? "You're signed out. Sign in to post, follow and reply."
      : "You're looking around. Create an account to post, follow and reply.";
  return (
    <div className="flex items-center justify-center gap-3 flex-wrap px-4 py-1.5 bg-accent/10 border-b border-accent/30 text-caption shrink-0">
      <span className="text-text">{text}</span>
      {pubkey || accounts.length > 0 ? (
        <Button size="sm" variant="primary" onClick={() => setShowLogin(true)}>Sign in</Button>
      ) : (
        <>
          <Button size="sm" variant="primary" onClick={() => openSignup("create")}>Create account</Button>
          <Button size="sm" onClick={() => openSignup("login")}>I have a key</Button>
        </>
      )}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  );
}

/**
 * The reminder for an account that chose "later" at the backup step. It stays
 * until the key has been copied once, here or from Settings → Account.
 */
export function BackupBanner() {
  const pubkey = useUserStore((s) => s.pubkey);
  const canSign = useCanSign();
  const pending = useBackupStore((s) => s.pending);
  const [open, setOpen] = useState(false);
  // An account whose key is not on this computer has nothing here to back
  // up; the identity banner says so instead.
  if (!pubkey || !canSign) return null;
  // The dialog outlives the banner: a copy that worked ends the reminder,
  // and the dialog must still be there to say so and be closed.
  return (
    <>
      {pending.includes(pubkey) && (
        <div className="flex items-center justify-center gap-3 flex-wrap px-4 py-1.5 bg-warning/10 border-b border-warning/30 text-caption shrink-0">
          <span className="text-text">Your secret key is not backed up. If this computer is lost, so is your account.</span>
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>Back up now</Button>
        </div>
      )}
      {open && <BackupDialog pubkey={pubkey} onClose={() => setOpen(false)} />}
    </>
  );
}

