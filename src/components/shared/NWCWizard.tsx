import { useEffect, useState } from "react";
import { useLightningStore } from "../../stores/lightning";
import { useUserStore } from "../../stores/user";
import { isValidNwcUri, parseNwcUri } from "../../lib/lightning/nwc";
import { Button, buttonClass } from "./Button";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";

// ── Wallet catalogue ─────────────────────────────────────────────────────────

interface WalletDef {
  id: string;
  name: string;
  tagline: string;
  setupUrl: string;
  steps: string[];
  detect: (relay: string) => boolean;
}

const WALLETS: WalletDef[] = [
  {
    id: "alby-hub",
    name: "Alby Hub",
    tagline: "Self-hosted · full control",
    setupUrl: "https://albyhub.com",
    steps: [
      "Open your Alby Hub dashboard",
      'Go to Connections → "Add connection"',
      "Copy the connection code",
      "Paste it below",
    ],
    detect: (r) => r.includes("albyhub") || (r.includes("getalby") && r.includes("hub")),
  },
  {
    id: "alby",
    name: "Alby Extension",
    tagline: "Browser extension",
    setupUrl: "https://getalby.com",
    steps: [
      "Go to getalby.com/apps/new",
      "Create a new app connection",
      "Copy the connection code",
      "Paste it below",
    ],
    detect: (r) => r.includes("getalby") && !r.includes("albyhub"),
  },
  {
    id: "phoenix",
    name: "Phoenix",
    tagline: "Mobile · self-custodial",
    setupUrl: "https://phoenix.acinq.co",
    steps: [
      "Open Phoenix on your phone",
      "Go to Settings → Nostr Wallet Connect",
      "Tap 'Link a new wallet'",
      "Copy the code and paste it below",
    ],
    detect: (r) => r.includes("phoenix") || r.includes("acinq"),
  },
];

const GENERIC: WalletDef = {
  id: "generic",
  name: "Other wallet",
  tagline: "",
  setupUrl: "",
  steps: [
    "Open your Lightning wallet",
    "Find the Nostr Wallet Connect section",
    "Create a new connection and copy its code",
    "Paste it below",
  ],
  detect: () => true,
};

function detectWallet(nwcUri: string): WalletDef {
  try {
    const { relayUrl } = parseNwcUri(nwcUri);
    return WALLETS.find((w) => w.detect(relayUrl)) ?? GENERIC;
  } catch {
    return GENERIC;
  }
}

// ── Connected state ───────────────────────────────────────────────────────────

/**
 * A wallet is "connected" when it has answered, not when a string was saved.
 * This used to say "Your NWC connection is active" the moment a well-formed
 * string was pasted, so a revoked or mistyped one looked fine until a zap
 * failed. The wallet is asked a cheap question (`checkWallet`) when this is
 * first shown and on Try again.
 */
function ConnectedState({ nwcUri, onDisconnect }: { nwcUri: string; onDisconnect: () => void }) {
  const status = useLightningStore((s) => s.walletStatus);
  const checkWallet = useLightningStore((s) => s.checkWallet);
  const wallet = detectWallet(nwcUri);
  const word = status === "ok" ? "Connected" : status === "refused" ? "Not recognised" : status === "unreachable" ? "Not reached" : "Checking…";
  const tone = status === "ok" ? "text-success" : status === "refused" || status === "unreachable" ? "text-danger" : "text-text-muted";
  let relay = "";
  try {
    relay = parseNwcUri(nwcUri).relayUrl;
    const u = new URL(relay);
    relay = u.hostname;
  } catch { /* keep raw */ }
  useEffect(() => { if (status === "unknown") void checkWallet(); }, [status, checkWallet]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border border-border mb-2 rounded-lg">
        <span className="text-zap" aria-hidden>⚡</span>
        <div className="flex-1 min-w-0">
          <span className="text-text text-body">{wallet.name}</span>
          {relay && <span className="text-text-dim text-caption ml-2">via {relay}</span>}
        </div>
        <span role="status" className={`text-caption ${tone}`}>{word}</span>
        {(status === "unreachable" || status === "refused") && <Button size="sm" onClick={() => void checkWallet()}>Try again</Button>}
        <Button variant="ghost" tone="danger" size="sm" onClick={onDisconnect}>Remove</Button>
      </div>
      <p className="text-text-muted text-caption px-1">
        {status === "ok"
          ? "Your wallet answered. You can zap notes and people, and stream sats to podcasts."
          : status === "refused"
            ? "The wallet does not recognise this code. It may have been removed in the wallet; paste a new one."
            : status === "unreachable"
              ? "Vega could not reach this wallet. If it is an app on your phone, open it and press Try again. If that does not help, remove the code and paste a new one."
              : "Asking the wallet whether this connection works…"}
      </p>
    </div>
  );
}

// ── Wallet card ───────────────────────────────────────────────────────────────

function WalletCard({ wallet, onSelect }: { wallet: WalletDef; onSelect: () => void }) {
  return (
    <div className="border border-border p-3 hover:border-accent/50 hover:bg-bg-hover transition-colors rounded-lg">
      <div className="font-medium text-text text-body mb-0.5">{wallet.name}</div>
      <div className="text-text-dim text-caption mb-2">{wallet.tagline}</div>
      <div className="flex gap-2">
        {wallet.setupUrl && (
          <a
            href={wallet.setupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass({ variant: "ghost", size: "sm" })}
            onClick={(e) => e.stopPropagation()}
          >
            Get this wallet<ExternalLink />
          </a>
        )}
        <Button size="sm" onClick={onSelect}>Show steps<ArrowRight /></Button>
      </div>
    </div>
  );
}

// ── Paste step ────────────────────────────────────────────────────────────────

function PasteStep({
  wallet,
  onBack,
  onConnected,
}: {
  wallet: WalletDef;
  onBack: () => void;
  onConnected: () => void;
}) {
  const setNwcUri = useLightningStore((s) => s.setNwcUri);
  const { pubkey } = useUserStore();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid = isValidNwcUri(input.trim());
  let parsedRelay = "";
  if (valid) {
    try {
      parsedRelay = new URL(parseNwcUri(input.trim()).relayUrl).hostname;
    } catch { /* keep raw */ }
  }

  const formatError =
    input.trim() && !valid
      ? input.trim().startsWith("nostr+walletconnect://")
        ? "This code is not complete: it should name a relay and a secret. Copy all of it."
        : "A connection code starts with nostr+walletconnect://"
      : null;

  // The code is saved and the connected row takes over: it asks the wallet and says whether it
  // answered, with Try again. The code is kept whatever the wallet says, so a wallet that is merely
  // slow is not lost.
  const handleConnect = () => {
    const uri = input.trim();
    if (!isValidNwcUri(uri)) {
      setError("That is not a connection code. Copy it again from the wallet.");
      return;
    }
    try {
      setNwcUri(uri, pubkey ?? undefined);
      onConnected();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-3"><ArrowLeft />All wallets</Button>
      <h3 className="text-body font-medium text-text mb-2">{wallet.id === "generic" ? "Connect your wallet" : `Connect ${wallet.name}`}</h3>

      {/* Step-by-step instructions */}
      <ol className="space-y-1 mb-4">
        {wallet.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-body">
            <span className="text-accent shrink-0 w-4 text-right">{i + 1}.</span>
            <span className="text-text-muted">{step}</span>
          </li>
        ))}
      </ol>

      {/* URI input */}
      <textarea
        value={input}
        onChange={(e) => { setInput(e.target.value); setError(null); }}
        placeholder="nostr+walletconnect://…"
        rows={3}
        autoFocus
        className="w-full bg-bg border border-border-strong px-3 py-2 text-text text-ui font-mono resize-none focus:outline-none focus:border-accent placeholder:text-text-dim mb-1.5 rounded-lg"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
      />

      {/* Inline validation feedback */}
      {formatError && (
        <p className="text-danger text-caption mb-1.5">{formatError}</p>
      )}
      {valid && (
        <p className="text-success text-caption mb-1.5">
          Looks right. Relay: {parsedRelay}
        </p>
      )}
      {error && <p className="text-danger text-caption mb-2">{error}</p>}
      <p className="text-text-muted text-caption mb-3">
        This code lets Vega spend from your wallet. Set a spending limit for it in the wallet, and treat it like a password.
      </p>

      <Button variant="primary" onClick={handleConnect} disabled={!valid}>Connect wallet</Button>
    </div>
  );
}

// ── Wizard root ───────────────────────────────────────────────────────────────

export function NWCWizard() {
  const { nwcUri, clearNwcUri } = useLightningStore();
  const { pubkey } = useUserStore();
  const [step, setStep] = useState<"choose" | "paste">("choose");
  const [selectedWallet, setSelectedWallet] = useState<WalletDef>(GENERIC);

  if (nwcUri) {
    return <ConnectedState nwcUri={nwcUri} onDisconnect={() => clearNwcUri(pubkey ?? undefined)} />;
  }

  if (step === "paste") {
    return (
      <PasteStep
        wallet={selectedWallet}
        onBack={() => setStep("choose")}
        onConnected={() => setStep("choose")}
      />
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {WALLETS.map((w) => (
          <WalletCard
            key={w.id}
            wallet={w}
            onSelect={() => { setSelectedWallet(w); setStep("paste"); }}
          />
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={() => { setSelectedWallet(GENERIC); setStep("paste"); }}>I already have a connection code<ArrowRight /></Button>
    </div>
  );
}
