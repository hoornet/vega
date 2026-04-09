import { useState, useEffect } from "react";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../../stores/user";

type Step = "welcome" | "create" | "backup" | "login";

interface OnboardingFlowProps {
  onComplete: () => void;
}

// ─── Shared layout ───────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen bg-bg flex items-center justify-center">
      <div className="w-full max-w-md px-8">
        <div className="text-text-dim text-[10px] font-bold tracking-[0.3em] uppercase mb-8">VEGA</div>
        {children}
      </div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h1 className="text-text text-xl font-medium mb-3 leading-snug">{children}</h1>;
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="text-text-dim text-[13px] leading-relaxed mb-6">{children}</p>;
}

// ─── Step: Welcome ───────────────────────────────────────────────────────────

function WelcomeStep({ onCreateNew, onHaveKey }: { onCreateNew: () => void; onHaveKey: () => void }) {
  return (
    <Shell>
      <Heading>Welcome to Vega.</Heading>
      <Body>
        Vega is a Nostr client — a social platform where you own your identity,
        your content, and your social graph. No company can delete your account or
        censor your posts.
      </Body>
      <Body>
        To get started, you need a key pair. Think of it like a username and password
        combined into one — except you control it completely.
      </Body>
      <div className="space-y-3">
        <button
          onClick={onCreateNew}
          className="w-full py-2.5 text-[13px] font-medium bg-accent hover:bg-accent-hover text-accent-text transition-colors"
        >
          Create a new identity
        </button>
        <button
          onClick={onHaveKey}
          className="w-full py-2.5 text-[13px] border border-border text-text-muted hover:text-text hover:border-accent/40 transition-colors"
        >
          I already have a key
        </button>
      </div>
    </Shell>
  );
}

// ─── Step: Create key ────────────────────────────────────────────────────────

function CreateStep({ onNext }: { onNext: (signer: NDKPrivateKeySigner) => void }) {
  const [signer] = useState(() => NDKPrivateKeySigner.generate());
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(signer.npub).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Shell>
      <Heading>Your identity is ready.</Heading>
      <Body>
        We generated a unique key pair for you. Your <strong className="text-text">public key</strong> is
        your identity on Nostr — like a username, but cryptographically yours. Share it freely.
      </Body>

      <div className="border border-border mb-2">
        <div className="px-3 py-1.5 border-b border-border">
          <span className="text-text-dim text-[10px] uppercase tracking-widest">Your public key (npub)</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <span title={signer.npub} className="text-text font-mono text-[11px] truncate flex-1 select-all">{signer.npub}</span>
          <button
            onClick={handleCopy}
            aria-label="Copy public key"
            className="text-[10px] text-text-dim hover:text-accent transition-colors shrink-0"
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
      </div>
      <p className="text-text-dim text-[11px] mb-6">Safe to share with anyone. This is how people find you on Nostr.</p>

      <button
        onClick={() => onNext(signer)}
        className="w-full py-2.5 text-[13px] font-medium bg-accent hover:bg-accent-hover text-accent-text transition-colors"
      >
        Next: back up your secret key →
      </button>
    </Shell>
  );
}

// ─── Step: Backup nsec ───────────────────────────────────────────────────────

function BackupStep({ signer, onComplete }: { signer: NDKPrivateKeySigner; onComplete: () => void }) {
  const { loginWithNsec, loginError } = useUserStore();
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(signer.nsec).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  };

  const handleStart = async () => {
    if (!confirmed) return;
    setSaving(true);
    await loginWithNsec(signer.nsec);
    setSaving(false);
    onComplete();
  };

  return (
    <Shell>
      <Heading>Save your secret key.</Heading>
      <Body>
        Your <strong className="text-text">secret key</strong> is the only way to recover your
        account. Save it in a password manager, notes app, or write it down. Vega never
        stores it — if you lose it, your account is gone.
      </Body>

      <div className="border border-danger/40 mb-2">
        <div className="px-3 py-1.5 border-b border-danger/40 bg-danger/5">
          <span className="text-danger text-[10px] uppercase tracking-widest">Secret key (nsec) — keep private</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <span title={revealed ? signer.nsec : undefined} className={`font-mono text-[11px] truncate flex-1 ${revealed ? "text-text select-all" : "text-text-dim"}`}>
            {revealed ? signer.nsec : "••••••••••••••••••••••••••••••••••••••••••••••••"}
          </span>
          <button
            onClick={() => setRevealed(!revealed)}
            className="text-[10px] text-text-dim hover:text-text transition-colors shrink-0"
          >
            {revealed ? "hide" : "reveal"}
          </button>
          <button
            onClick={handleCopy}
            aria-label="Copy secret key"
            className="text-[10px] text-text-dim hover:text-danger transition-colors shrink-0"
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
      </div>
      <p className="text-text-dim text-[11px] mb-6">
        Never share this with anyone. Anyone who has it controls your account.
      </p>

      <label className="flex items-start gap-3 mb-5 cursor-pointer group">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 accent-accent w-4 h-4 shrink-0"
        />
        <span className="text-text-dim text-[12px] group-hover:text-text transition-colors">
          I've saved my secret key in a safe place and understand that losing it means losing access to my account.
        </span>
      </label>

      {loginError && <p className="text-danger text-[11px] mb-3">{loginError}</p>}

      <button
        onClick={handleStart}
        disabled={!confirmed || saving}
        className="w-full py-2.5 text-[13px] font-medium bg-accent hover:bg-accent-hover text-accent-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {saving ? "Setting up…" : "Start using Vega"}
      </button>
    </Shell>
  );
}

// ─── Step: Login with existing key ───────────────────────────────────────────

function LoginStep({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const { loginWithNsec, loginWithPubkey, loginWithRemoteSigner, loginError, loggedIn } = useUserStore();
  const [mode, setMode] = useState<"nsec" | "npub" | "bunker">("nsec");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (loggedIn) onComplete();
  }, [loggedIn]);

  const handleLogin = async () => {
    if (!value.trim() || loading) return;
    setLoading(true);
    if (mode === "nsec") {
      await loginWithNsec(value.trim());
    } else if (mode === "bunker") {
      await loginWithRemoteSigner(value.trim());
    } else {
      await loginWithPubkey(value.trim());
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  const tabLabel = (m: "nsec" | "npub" | "bunker") =>
    m === "nsec" ? "Secret key" : m === "npub" ? "Public key" : "Remote signer";

  return (
    <Shell>
      <Heading>Log in with your key.</Heading>

      <div role="tablist" className="flex border border-border mb-4">
        {(["nsec", "npub", "bunker"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setValue(""); }}
            className={`flex-1 py-2 text-[11px] transition-colors ${
              mode === m ? "bg-accent/10 text-accent" : "text-text-dim hover:text-text"
            }`}
          >
            {tabLabel(m)}
          </button>
        ))}
      </div>

      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={mode === "nsec" ? "nsec1…" : mode === "npub" ? "npub1…" : "bunker://…"}
        aria-label={mode === "nsec" ? "Secret key" : mode === "npub" ? "Public key" : "Bunker URI"}
        autoFocus
        className="w-full bg-bg border border-border px-3 py-2 text-text text-[12px] font-mono focus:outline-none focus:border-accent/50 placeholder:text-text-dim mb-2"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
      />

      {mode === "npub" && (
        <p className="text-text-dim text-[11px] mb-4">Read-only mode — you can browse but not post, react, or zap.</p>
      )}
      {mode === "bunker" && (
        <p className="text-text-dim text-[11px] mb-4">Connect to nsecBunker, Amber, or similar. Paste your bunker:// URI.</p>
      )}

      {loginError && <p className="text-danger text-[11px] mb-3">{loginError}</p>}

      <div className="space-y-2">
        <button
          onClick={handleLogin}
          disabled={!value.trim() || loading}
          className="w-full py-2.5 text-[13px] font-medium bg-accent hover:bg-accent-hover text-accent-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {loading ? (mode === "bunker" ? "Connecting…" : "Logging in…") : "Log in"}
        </button>
        <button
          onClick={onBack}
          className="w-full py-2 text-[12px] text-text-dim hover:text-text transition-colors"
        >
          ← Back
        </button>
      </div>
    </Shell>
  );
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [generatedSigner, setGeneratedSigner] = useState<NDKPrivateKeySigner | null>(null);

  if (step === "welcome") {
    return (
      <WelcomeStep
        onCreateNew={() => setStep("create")}
        onHaveKey={() => setStep("login")}
      />
    );
  }

  if (step === "create") {
    return (
      <CreateStep
        onNext={(signer) => {
          setGeneratedSigner(signer);
          setStep("backup");
        }}
      />
    );
  }

  if (step === "backup" && generatedSigner) {
    return <BackupStep signer={generatedSigner} onComplete={onComplete} />;
  }

  if (step === "login") {
    return <LoginStep onBack={() => setStep("welcome")} onComplete={onComplete} />;
  }

  return null;
}
