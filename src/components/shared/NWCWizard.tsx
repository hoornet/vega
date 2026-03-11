import { useState } from "react";
import { useLightningStore } from "../../stores/lightning";
import { useUserStore } from "../../stores/user";
import { isValidNwcUri, parseNwcUri } from "../../lib/lightning/nwc";

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
      "Copy the Nostr Wallet Connect URI",
      "Paste it below",
    ],
    detect: (r) => r.includes("albyhub") || (r.includes("getalby") && r.includes("hub")),
  },
  {
    id: "alby",
    name: "Alby Extension",
    tagline: "Browser extension",
    setupUrl: "https://getalby.com/apps/new",
    steps: [
      "Go to getalby.com/apps/new",
      "Create a new app connection",
      "Copy the Nostr Wallet Connect URI",
      "Paste it below",
    ],
    detect: (r) => r.includes("getalby") && !r.includes("albyhub"),
  },
  {
    id: "mutiny",
    name: "Mutiny",
    tagline: "Web-based wallet",
    setupUrl: "https://app.mutinywallet.com/#/settings/connections",
    steps: [
      "Open Mutiny Wallet",
      "Go to Settings → Nostr Wallet Connect",
      "Create a new connection",
      "Copy the URI and paste it below",
    ],
    detect: (r) => r.includes("mutiny"),
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
      "Copy the URI and paste it below",
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
    "Generate a new NWC connection URI",
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

function ConnectedState({ nwcUri, onDisconnect }: { nwcUri: string; onDisconnect: () => void }) {
  const wallet = detectWallet(nwcUri);
  let relay = "";
  try {
    relay = parseNwcUri(nwcUri).relayUrl;
    const u = new URL(relay);
    relay = u.hostname;
  } catch { /* keep raw */ }

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 border border-border mb-2">
        <span className="text-zap text-[11px]">⚡</span>
        <div className="flex-1 min-w-0">
          <span className="text-text text-[12px]">{wallet.name} connected</span>
          {relay && <span className="text-text-dim text-[10px] ml-2">via {relay}</span>}
        </div>
        <button
          onClick={onDisconnect}
          className="text-[10px] text-text-dim hover:text-danger transition-colors shrink-0"
        >
          disconnect
        </button>
      </div>
      <p className="text-text-dim text-[10px] px-1">
        Your NWC connection is active. You can zap notes and profiles.
      </p>
    </div>
  );
}

// ── Wallet card ───────────────────────────────────────────────────────────────

function WalletCard({ wallet, onSelect }: { wallet: WalletDef; onSelect: () => void }) {
  return (
    <div className="border border-border p-3 hover:border-accent/50 hover:bg-bg-hover transition-colors">
      <div className="font-medium text-text text-[12px] mb-0.5">{wallet.name}</div>
      <div className="text-text-dim text-[10px] mb-2">{wallet.tagline}</div>
      <div className="flex gap-2">
        {wallet.setupUrl && (
          <a
            href={wallet.setupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] px-2 py-1 border border-border text-text-dim hover:text-accent hover:border-accent/40 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            open ↗
          </a>
        )}
        <button
          onClick={onSelect}
          className="text-[10px] px-2 py-1 border border-accent/60 text-accent hover:bg-accent hover:text-white transition-colors"
        >
          connect →
        </button>
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
  const { setNwcUri } = useLightningStore();
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
        ? "URI is incomplete — missing relay or secret parameter"
        : "Should start with nostr+walletconnect://"
      : null;

  const handleConnect = () => {
    const uri = input.trim();
    if (!isValidNwcUri(uri)) {
      setError("Invalid NWC URI — check and try again");
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
      <button
        onClick={onBack}
        className="text-text-dim hover:text-text text-[11px] transition-colors mb-3 block"
      >
        ← {wallet.name}
      </button>

      {/* Step-by-step instructions */}
      <ol className="space-y-1 mb-4">
        {wallet.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px]">
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
        className="w-full bg-bg border border-border px-3 py-2 text-text text-[11px] font-mono resize-none focus:outline-none focus:border-accent/50 placeholder:text-text-dim mb-1.5"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
      />

      {/* Inline validation feedback */}
      {formatError && (
        <p className="text-danger text-[10px] mb-1.5">{formatError}</p>
      )}
      {valid && (
        <p className="text-success text-[10px] mb-1.5">
          ✓ Valid — relay: {parsedRelay}
        </p>
      )}
      {error && <p className="text-danger text-[11px] mb-2">{error}</p>}

      <button
        onClick={handleConnect}
        disabled={!valid}
        className="px-4 py-1.5 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        connect wallet
      </button>
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
      <p className="text-text-muted text-[12px] mb-3">
        Choose your Lightning wallet to get a Nostr Wallet Connect (NWC) URI.
      </p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {WALLETS.map((w) => (
          <WalletCard
            key={w.id}
            wallet={w}
            onSelect={() => { setSelectedWallet(w); setStep("paste"); }}
          />
        ))}
      </div>
      <button
        onClick={() => { setSelectedWallet(GENERIC); setStep("paste"); }}
        className="text-text-dim hover:text-text text-[11px] transition-colors"
      >
        I already have a connection string →
      </button>
    </div>
  );
}
