import { useState, type RefObject } from "react";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../../stores/user";
import { Tabs } from "./Tabs";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Check, Copy } from "lucide-react";
import { copyText } from "../../lib/clipboard";

interface LoginModalProps {
  onClose: () => void;
  /** Where focus goes when this closes, if what opened it will be gone by then (a menu item). */
  returnFocus?: RefObject<HTMLElement | null>;
}

function NewAccountTab({ onClose }: { onClose: () => void }) {
  const { loginWithNsec, loginError } = useUserStore();
  const [signer] = useState(() => NDKPrivateKeySigner.generate());
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [logging, setLogging] = useState(false);

  const nsec = signer.nsec;

  // "Copied" only once it has been: this is the secret key, and believing it
  // was copied when it was not is how a key gets lost.
  const handleCopy = async () => {
    if (!(await copyText(nsec))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleConfirm = async () => {
    if (!confirmed) return;
    setLogging(true);
    await loginWithNsec(nsec);
    if (!useUserStore.getState().loginError) {
      onClose();
    }
    setLogging(false);
  };

  return (
    <div>
      <p className="text-text-muted text-body mb-3">
        A new private key has been generated for you. Save it somewhere safe — it cannot be recovered.
      </p>

      <div className="bg-bg border border-border px-3 py-2 font-mono text-caption text-text break-all mb-2 rounded-lg"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
      >
        {nsec}
      </div>

      <Button className="mb-4" onClick={handleCopy}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy key"}</Button>

      <label className="flex items-start gap-2 cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 shrink-0"
        />
        <span className="text-text-muted text-body">
          I've saved my private key in a safe place
        </span>
      </label>

      {loginError && (
        <p className="text-danger text-caption mb-2">{loginError}</p>
      )}

      <Button variant="primary" size="lg" className="w-full" onClick={handleConfirm} disabled={!confirmed} busy={logging}>
        {logging ? "Logging in…" : "create account"}
      </Button>
    </div>
  );
}

export function LoginModal({ onClose, returnFocus }: LoginModalProps) {
  const [tab, setTab] = useState<"nsec" | "pubkey" | "bunker" | "new">("nsec");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const { loginWithNsec, loginWithPubkey, loginWithRemoteSigner, loginError } = useUserStore();

  const handleLogin = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);

    if (tab === "nsec") {
      await loginWithNsec(input.trim());
    } else if (tab === "pubkey") {
      await loginWithPubkey(input.trim());
    } else if (tab === "bunker") {
      await loginWithRemoteSigner(input.trim());
    }

    setLoading(false);
    // Close if no error
    if (!useUserStore.getState().loginError) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <Dialog title="Login" onClose={onClose} returnFocus={returnFocus}>
      <Tabs
        label="How to log in"
        tabs={[
          { id: "nsec", label: "Private key" },
          { id: "pubkey", label: "Read-only" },
          { id: "bunker", label: "Remote signer" },
          { id: "new", label: "New account" },
        ]}
        value={tab}
        onChange={(t) => { setTab(t); setInput(""); }}
      />

      {/* Content */}
      <div className="p-4">
        {tab === "new" ? (
          <NewAccountTab onClose={onClose} />
        ) : (
          <>
            <label className="block text-text-muted text-caption mb-1.5">
              {tab === "nsec"
                ? "Paste your nsec or hex private key"
                : tab === "pubkey"
                  ? "Paste your npub or hex public key"
                  : "Paste your bunker:// URI"}
            </label>
            <input
              type={tab === "nsec" ? "password" : "text"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={tab === "nsec" ? "nsec1…" : tab === "pubkey" ? "npub1…" : "bunker://…"}
              className="w-full bg-bg border border-border-strong px-3 py-2 text-text text-ui font-mono placeholder:text-text-dim focus:outline-none focus:border-accent rounded-lg"
            />

            {tab === "nsec" && (
              <p className="text-text-dim text-caption mt-1.5">
                Your key stays local. Never sent to any server.
              </p>
            )}

            {tab === "pubkey" && (
              <p className="text-text-dim text-caption mt-1.5">
                Read-only mode — you can browse but not post or zap.
              </p>
            )}

            {tab === "bunker" && (
              <p className="text-text-dim text-caption mt-1.5">
                Connect to nsecBunker, Amber, or similar. Your keys never leave the signer.
              </p>
            )}

            {loginError && (
              <p className="text-danger text-caption mt-2">{loginError}</p>
            )}

            <Button variant="primary" size="lg" className="w-full mt-3" onClick={handleLogin} disabled={!input.trim()} busy={loading}>
              {loading
                ? (tab === "bunker" ? "Connecting…" : "Logging in…")
                : tab === "nsec" ? "Login" : tab === "pubkey" ? "View as read-only" : "Connect"}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
