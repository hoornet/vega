import { useState, type RefObject } from "react";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { Tabs } from "./Tabs";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface LoginModalProps {
  onClose: () => void;
  /** Where focus goes when this closes, if what opened it will be gone by then (a menu item). */
  returnFocus?: RefObject<HTMLElement | null>;
}

export function LoginModal({ onClose, returnFocus }: LoginModalProps) {
  const [tab, setTab] = useState<"nsec" | "pubkey" | "bunker">("nsec");
  const openSignup = useUIStore((s) => s.openSignup);
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
    <Dialog title="Sign in" onClose={onClose} returnFocus={returnFocus}>
      <Tabs
        label="How to sign in"
        tabs={[
          { id: "nsec", label: "Secret key" },
          { id: "pubkey", label: "Read-only" },
          { id: "bunker", label: "Remote signer" },
        ]}
        value={tab}
        onChange={(t) => { setTab(t); setInput(""); }}
      />

      {/* Content */}
      <div className="p-4">
        {(
          <>
            <label className="block text-text-muted text-caption mb-1.5">
              {tab === "nsec"
                ? "Paste your secret key (nsec)"
                : tab === "pubkey"
                  ? "Paste a public key (npub) to browse as that account"
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
                Browse as that account. You can read, but not post, reply or zap.
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
                ? (tab === "bunker" ? "Connecting…" : "Signing in…")
                : tab === "nsec" ? "Sign in" : tab === "pubkey" ? "View as read-only" : "Connect"}
            </Button>
          </>
        )}
        {/* One way to make an account: the sign-up flow, not a fourth tab
            with an unmasked key and no name. */}
        <p className="text-text-muted text-caption text-center mt-4">
          New to Nostr?{" "}
          <button type="button" className="text-accent hover:text-accent-hover transition-colors" onClick={() => { onClose(); openSignup("create"); }}>
            Create an account
          </button>
        </p>
      </div>
    </Dialog>
  );
}
