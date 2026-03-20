import { useState } from "react";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../../stores/user";

interface LoginModalProps {
  onClose: () => void;
}

function NewAccountTab({ onClose }: { onClose: () => void }) {
  const { loginWithNsec, loginError } = useUserStore();
  const [signer] = useState(() => NDKPrivateKeySigner.generate());
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [logging, setLogging] = useState(false);

  const nsec = signer.nsec;

  const handleCopy = () => {
    navigator.clipboard.writeText(nsec);
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
      <p className="text-text-muted text-[12px] mb-3">
        A new private key has been generated for you. Save it somewhere safe — it cannot be recovered.
      </p>

      <div className="bg-bg border border-border px-3 py-2 font-mono text-[11px] text-text break-all mb-2"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
      >
        {nsec}
      </div>

      <button
        onClick={handleCopy}
        className="text-[11px] px-3 py-1 border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors mb-4"
      >
        {copied ? "copied ✓" : "copy key"}
      </button>

      <label className="flex items-start gap-2 cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 shrink-0"
        />
        <span className="text-text-muted text-[12px]">
          I've saved my private key in a safe place
        </span>
      </label>

      {loginError && (
        <p className="text-danger text-[11px] mb-2">{loginError}</p>
      )}

      <button
        onClick={handleConfirm}
        disabled={!confirmed || logging}
        className="w-full px-4 py-2 text-[12px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {logging ? "logging in…" : "create account"}
      </button>
    </div>
  );
}

export function LoginModal({ onClose }: LoginModalProps) {
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
    if (e.key === "Escape") onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-bg-raised border border-border w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-text text-sm font-medium">Login</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {(["nsec", "pubkey", "bunker", "new"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setInput(""); }}
              className={`flex-1 px-3 py-2 text-[11px] transition-colors ${
                tab === t
                  ? "text-accent border-b-2 border-accent"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {t === "nsec" ? "Private key" : t === "pubkey" ? "Read-only" : t === "bunker" ? "Remote signer" : "New account"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4">
          {tab === "new" ? (
            <NewAccountTab onClose={onClose} />
          ) : (
            <>
              <label className="block text-text-muted text-[11px] mb-1.5">
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
                autoFocus
                className="w-full bg-bg border border-border px-3 py-2 text-text text-[13px] font-mono placeholder:text-text-dim focus:outline-none focus:border-accent/50"
              />

              {tab === "nsec" && (
                <p className="text-text-dim text-[10px] mt-1.5">
                  Your key stays local. Never sent to any server.
                </p>
              )}

              {tab === "pubkey" && (
                <p className="text-text-dim text-[10px] mt-1.5">
                  Read-only mode — you can browse but not post or zap.
                </p>
              )}

              {tab === "bunker" && (
                <p className="text-text-dim text-[10px] mt-1.5">
                  Connect to nsecBunker, Amber, or similar. Your keys never leave the signer.
                </p>
              )}

              {loginError && (
                <p className="text-danger text-[11px] mt-2">{loginError}</p>
              )}

              <button
                onClick={handleLogin}
                disabled={!input.trim() || loading}
                className="w-full mt-3 px-4 py-2 text-[12px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {loading
                  ? (tab === "bunker" ? "Connecting…" : "Logging in…")
                  : tab === "nsec" ? "Login" : tab === "pubkey" ? "View as read-only" : "Connect"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
