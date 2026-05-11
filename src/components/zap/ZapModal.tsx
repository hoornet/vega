import { useState } from "react";
import { useLightningStore, ZapTargetSpec } from "../../stores/lightning";
import { useUIStore } from "../../stores/ui";
import { useCanSign } from "../../stores/user";
import { LoginModal } from "../shared/LoginModal";

const AMOUNT_PRESETS = [21, 100, 500, 1000, 5000];

type ZapState = "idle" | "paying" | "success" | "error";

interface ZapModalProps {
  target: ZapTargetSpec;
  recipientName: string;
  onClose: () => void;
}

export function ZapModal({ target, recipientName, onClose }: ZapModalProps) {
  const canSign = useCanSign();
  const { nwcUri, zap } = useLightningStore();
  const { setView } = useUIStore();
  const [amountSats, setAmountSats] = useState(21);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<ZapState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [showLogin, setShowLogin] = useState(false);

  const effectiveAmount = useCustom ? (parseInt(customAmount) || 0) : amountSats;

  const handleZap = async () => {
    if (effectiveAmount <= 0) return;
    setState("paying");
    setErrorMsg("");
    try {
      await zap(target, effectiveAmount, comment.trim() || undefined);
      setState("success");
      setTimeout(onClose, 1500);
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`Zap ${recipientName}`}
      onClick={handleBackdrop}
    >
      <div className="bg-bg border border-border w-80 shadow-2xl">
        {/* Header */}
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-text text-[13px] font-medium">⚡ Zap {recipientName}</div>
            {!nwcUri && <div className="text-danger text-[10px] mt-0.5">No wallet connected</div>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-text-dim hover:text-text text-[11px] transition-colors">✕</button>
        </div>

        {/* Sign-in required state */}
        {!canSign && (
          <div className="px-4 py-5 text-center">
            <p className="text-text-dim text-[12px] mb-3">
              Sign in with a private key or remote signer to send zaps.
            </p>
            <button
              onClick={() => setShowLogin(true)}
              className="px-4 py-1.5 text-[11px] border border-accent/60 text-accent hover:bg-accent hover:text-accent-text transition-colors"
            >
              Sign in
            </button>
          </div>
        )}

        {/* No wallet state */}
        {canSign && !nwcUri && (
          <div className="px-4 py-5 text-center">
            <p className="text-text-dim text-[12px] mb-3">
              Connect a Lightning wallet using a Nostr Wallet Connect (NWC) URI to send zaps.
            </p>
            <button
              onClick={() => { onClose(); setView("settings"); }}
              className="px-4 py-1.5 text-[11px] border border-accent/60 text-accent hover:bg-accent hover:text-accent-text transition-colors"
            >
              Go to settings →
            </button>
          </div>
        )}

        {/* Zap form */}
        {canSign && nwcUri && state === "idle" && (
          <div className="px-4 py-4 space-y-4">
            {/* Amount presets */}
            <div>
              <div className="text-text-dim text-[10px] uppercase tracking-widest mb-2">Amount (sats)</div>
              <div className="grid grid-cols-5 gap-1.5 mb-2">
                {AMOUNT_PRESETS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => { setAmountSats(amt); setUseCustom(false); }}
                    className={`py-1.5 text-[11px] border transition-colors ${
                      !useCustom && amountSats === amt
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-text-muted hover:border-accent/40 hover:text-text"
                    }`}
                  >
                    {amt}
                  </button>
                ))}
              </div>
              <input
                value={customAmount}
                onChange={(e) => { setCustomAmount(e.target.value.replace(/\D/g, "")); setUseCustom(true); }}
                onFocus={() => setUseCustom(true)}
                placeholder="custom amount…"
                className={`w-full bg-bg border px-3 py-1.5 text-text text-[12px] focus:outline-none transition-colors ${
                  useCustom ? "border-accent/60" : "border-border"
                }`}
              />
            </div>

            {/* Comment */}
            <div>
              <div className="text-text-dim text-[10px] uppercase tracking-widest mb-2">Comment (optional)</div>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Great post!"
                maxLength={140}
                className="w-full bg-bg border border-border px-3 py-1.5 text-text text-[12px] focus:outline-none focus:border-accent/50"
              />
            </div>

            {/* Zap button */}
            <button
              onClick={handleZap}
              disabled={effectiveAmount <= 0}
              className="w-full py-2 text-[12px] font-medium bg-zap hover:bg-zap/90 text-zap-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ⚡ Zap {effectiveAmount > 0 ? `${effectiveAmount} sats` : ""}
            </button>
          </div>
        )}

        {/* Paying state */}
        {canSign && nwcUri && state === "paying" && (
          <div className="px-4 py-8 text-center">
            <div className="text-zap text-2xl mb-2">⚡</div>
            <p className="text-text-dim text-[12px]">Sending {effectiveAmount} sats…</p>
          </div>
        )}

        {/* Success state */}
        {state === "success" && (
          <div className="px-4 py-8 text-center">
            <div className="text-zap text-2xl mb-2">⚡</div>
            <p className="text-text text-[13px] font-medium">Zapped!</p>
            <p className="text-text-dim text-[11px] mt-1">{effectiveAmount} sats sent to {recipientName}</p>
          </div>
        )}

        {/* Error state */}
        {state === "error" && (
          <div className="px-4 py-5 space-y-3">
            <p className="text-danger text-[12px]">{errorMsg}</p>
            <button
              onClick={() => setState("idle")}
              className="w-full py-1.5 text-[11px] border border-border text-text-muted hover:text-text transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  );
}
