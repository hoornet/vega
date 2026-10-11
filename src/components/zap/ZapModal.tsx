import { useState } from "react";
import { useLightningStore, ZapTargetSpec } from "../../stores/lightning";
import { useUIStore } from "../../stores/ui";
import { useCanSign } from "../../stores/user";
import { LoginModal } from "../shared/LoginModal";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import { BodyPortal } from "../shared/BodyPortal";
import { Button } from "../shared/Button";
import { ArrowRight, Zap } from "lucide-react";

const AMOUNT_PRESETS = [21, 100, 500, 1000, 5000];

type ZapState = "idle" | "paying" | "success" | "error";

interface ZapModalProps {
  target: ZapTargetSpec;
  recipientName: string;
  onClose: () => void;
}

export function ZapModal({ target, recipientName, onClose }: ZapModalProps) {
  useEscapeToClose(onClose);
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
    <BodyPortal>
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`Zap ${recipientName}`}
      onClick={handleBackdrop}
    >
      <div className="bg-bg border border-border w-80 shadow-2xl rounded-lg">
        {/* Header */}
        <div className="border-b border-border-subtle px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-text text-title font-medium">⚡ Zap {recipientName}</div>
            {!nwcUri && <div className="text-danger text-caption mt-0.5">No wallet connected</div>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-text-dim hover:text-text text-[11px] transition-colors">✕</button>
        </div>

        {/* Sign-in required state */}
        {!canSign && (
          <div className="px-4 py-5 text-center">
            <p className="text-text-dim text-body mb-3">
              Sign in with a private key or remote signer to send zaps.
            </p>
            <Button variant="primary" onClick={() => setShowLogin(true)}>Sign in</Button>
          </div>
        )}

        {/* No wallet state */}
        {canSign && !nwcUri && (
          <div className="px-4 py-5 text-center">
            <p className="text-text-dim text-body mb-3">
              Connect a Lightning wallet using a Nostr Wallet Connect (NWC) URI to send zaps.
            </p>
            <Button variant="primary" onClick={() => { onClose(); setView("settings"); }}>Go to settings<ArrowRight /></Button>
          </div>
        )}

        {/* Zap form */}
        {canSign && nwcUri && state === "idle" && (
          <div className="px-4 py-4 space-y-4">
            {/* Amount presets */}
            <div>
              <div className="text-text-dim text-micro uppercase tracking-widest mb-2">Amount (sats)</div>
              <div className="grid grid-cols-5 gap-1.5 mb-2">
                {AMOUNT_PRESETS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => { setAmountSats(amt); setUseCustom(false); }}
                    className={`py-1.5 text-ui border transition-colors ${
                      !useCustom && amountSats === amt
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-text-muted hover:border-accent/40 hover:text-text"
                    } rounded-sm`}
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
                className={`w-full bg-bg border px-3 py-1.5 text-text text-ui focus:outline-none transition-colors ${
                  useCustom ? "border-accent" : "border-border-strong"
                } rounded-lg`}
              />
            </div>

            {/* Comment */}
            <div>
              <div className="text-text-dim text-micro uppercase tracking-widest mb-2">Comment (optional)</div>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Great post!"
                maxLength={140}
                className="w-full bg-bg border border-border-strong px-3 py-1.5 text-text text-ui focus:outline-none focus:border-accent rounded-lg"
              />
            </div>

            {/* Zap button */}
            <Button variant="primary" tone="zap" size="lg" className="w-full" onClick={handleZap} disabled={effectiveAmount <= 0}>
              <Zap />Zap {effectiveAmount > 0 ? `${effectiveAmount} sats` : ""}
            </Button>
          </div>
        )}

        {/* Paying state */}
        {canSign && nwcUri && state === "paying" && (
          <div className="px-4 py-8 text-center">
            <div className="text-zap text-2xl mb-2">⚡</div>
            <p className="text-text-dim text-body">Sending {effectiveAmount} sats…</p>
          </div>
        )}

        {/* Success state */}
        {state === "success" && (
          <div className="px-4 py-8 text-center">
            <div className="text-zap text-2xl mb-2">⚡</div>
            <p className="text-text text-body font-medium">Zapped!</p>
            <p className="text-text-dim text-caption mt-1">{effectiveAmount} sats sent to {recipientName}</p>
          </div>
        )}

        {/* Error state */}
        {state === "error" && (
          <div className="px-4 py-5 space-y-3">
            <p className="text-danger text-body">{errorMsg}</p>
            <Button className="w-full" onClick={() => setState("idle")}>Try again</Button>
          </div>
        )}
      </div>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
    </BodyPortal>
  );
}
