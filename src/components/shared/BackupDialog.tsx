import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { readSecretKey, copySecretKey, type SecretKey } from "../../stores/user";

/**
 * Back up the secret key of an account that chose "later" at sign-up.
 *
 * Opened from the reminder banner. The key is read from the keychain (or
 * this session, when the keychain did not take it), shown masked, and
 * copied with one button. A copy that worked ends the reminder; the dialog
 * says so and stays, so what was copied can be pasted before it is closed.
 */
export function BackupDialog({ pubkey, onClose }: { pubkey: string; onClose: () => void }) {
  const [secret, setSecret] = useState<SecretKey | null | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Another account's key must not stay on screen if the account changes
  // while this is open: everything starts again for the new one.
  useEffect(() => {
    let current = true;
    setSecret(undefined);
    setRevealed(false);
    setCopied(false);
    readSecretKey(pubkey).then((key) => { if (current) setSecret(key); });
    return () => { current = false; };
  }, [pubkey]);

  // Quiet: the button says it was copied; a toast as well would say it twice.
  const copy = async () => {
    if (await copySecretKey(pubkey, { quiet: true })) setCopied(true);
  };

  return (
    <Dialog title="Back up your secret key" onClose={onClose} size="md">
      <div className="p-4">
        <p className="text-text-muted text-body leading-relaxed mb-3">
          Your secret key is the only way into this account. If this computer is lost or wiped and you have no copy, the account is gone for good. Paste it into a password manager, then come back and close this.
        </p>
        {secret === undefined ? (
          <p className="text-text-dim text-caption mb-3">Reading the key…</p>
        ) : secret === null ? (
          <p role="alert" className="text-danger text-caption mb-3">No key for this account is on this computer.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 py-2 border border-danger/40 rounded-lg mb-2">
              <span title={revealed ? secret.nsec : undefined} className={`font-mono text-caption truncate flex-1 ${revealed ? "text-text select-all" : "text-text-dim"}`}>
                {revealed ? secret.nsec : "•".repeat(48)}
              </span>
              <button onClick={() => setRevealed((v) => !v)} className="text-caption text-text-dim hover:text-text transition-colors shrink-0">
                {revealed ? "hide" : "reveal"}
              </button>
            </div>
            <Button wrap className="w-full mb-3" onClick={copy} aria-label="Copy secret key">
              {copied ? <Check /> : <Copy />}{copied ? "Copied. Paste it into your password manager now." : "Copy secret key"}
            </Button>
            {secret.stored === false && (
              <p role="alert" className="text-danger text-caption mb-3">
                This key is not saved in this computer's keychain. It is gone when Vega closes, and you will be signed out. Copy it now.
              </p>
            )}
          </>
        )}
        {copied
          ? <Button variant="primary" className="w-full" onClick={onClose}>Done</Button>
          : <Button variant="ghost" className="w-full" onClick={onClose}>Not now</Button>}
      </div>
    </Dialog>
  );
}
