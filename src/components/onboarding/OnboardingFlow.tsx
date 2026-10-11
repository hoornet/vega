import { useState, useEffect } from "react";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { setBrowseOnly } from "../../lib/browseOnly";
import { Button } from "../shared/Button";
import { ArrowLeft, ArrowRight } from "lucide-react";

type Step = "welcome" | "create" | "backup" | "interests" | "login";

interface OnboardingFlowProps {
  onComplete: () => void;
}

// ─── Shared layout ───────────────────────────────────────────────────────────

function Shell({
  children,
  step,
  totalSteps,
}: {
  children: React.ReactNode;
  step?: number;
  totalSteps?: number;
}) {
  return (
    <div className="h-screen w-screen bg-bg flex items-center justify-center">
      <div className="w-full max-w-md px-8">
        {/* Logo wordmark */}
        <div className="text-accent text-[18px] font-bold tracking-[0.25em] mb-2 select-none">VEGA</div>

        {/* Step dots — shown only for the linear create→backup→interests path */}
        {step !== undefined && totalSteps !== undefined && (
          <div className="flex gap-1.5 mb-8">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i < step ? "bg-accent w-4" : i === step ? "bg-accent w-6" : "bg-border w-4"
                }`}
              />
            ))}
          </div>
        )}
        {step === undefined && <div className="mb-8" />}

        {children}
      </div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h1 className="text-text text-heading font-medium mb-3 leading-snug">{children}</h1>;
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="text-text-dim text-body leading-relaxed mb-6">{children}</p>;
}

// ─── Interest topics ─────────────────────────────────────────────────────────

const INTEREST_TOPICS = [
  { emoji: "₿", label: "Bitcoin",      tag: "bitcoin" },
  { emoji: "⚡", label: "Nostr",        tag: "nostr" },
  { emoji: "💻", label: "Tech",         tag: "technology" },
  { emoji: "🔒", label: "Privacy",      tag: "privacy" },
  { emoji: "🎨", label: "Art",          tag: "art" },
  { emoji: "🎵", label: "Music",        tag: "music" },
  { emoji: "📷", label: "Photography",  tag: "photography" },
  { emoji: "🎮", label: "Gaming",       tag: "gaming" },
  { emoji: "🔬", label: "Science",      tag: "science" },
  { emoji: "📚", label: "Books",        tag: "books" },
  { emoji: "🐧", label: "Linux",        tag: "linux" },
  { emoji: "🤔", label: "Philosophy",   tag: "philosophy" },
  { emoji: "💰", label: "Finance",      tag: "finance" },
  { emoji: "🏃", label: "Health",       tag: "health" },
  { emoji: "🍕", label: "Food",         tag: "food" },
  { emoji: "✈️", label: "Travel",       tag: "travel" },
  { emoji: "⚽", label: "Sports",       tag: "sports" },
  { emoji: "📰", label: "News",         tag: "news" },
];

// ─── Step: Interests ─────────────────────────────────────────────────────────

function InterestsStep({ onComplete }: { onComplete: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (tag: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });

  const handleConfirm = () => {
    localStorage.setItem("wrystr_interests", JSON.stringify([...selected]));
    onComplete();
  };

  return (
    <Shell step={2} totalSteps={3}>
      <Heading>What are you into?</Heading>
      <Body>Pick a few topics — we'll suggest them as hashtags to explore.</Body>

      <div className="grid grid-cols-3 gap-2 mb-7">
        {INTEREST_TOPICS.map(({ emoji, label, tag }) => {
          const active = selected.has(tag);
          return (
            <button
              key={tag}
              onClick={() => toggle(tag)}
              className={`flex items-center gap-2 px-2 py-2 text-ui border transition-colors text-left ${
                active
                  ? "bg-accent/10 border-accent text-accent"
                  : "border-border text-text-dim hover:border-accent/40 hover:text-text"
              } rounded-sm`}
            >
              <span>{emoji}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <Button variant="primary" size="lg" className="w-full mb-2" onClick={handleConfirm}>Get started<ArrowRight /></Button>
      <Button variant="ghost" size="lg" className="w-full" onClick={handleConfirm}>Skip for now</Button>
    </Shell>
  );
}

// ─── Step: Welcome ───────────────────────────────────────────────────────────

function WelcomeStep({ onCreateNew, onHaveKey, onBrowse }: { onCreateNew: () => void; onHaveKey: () => void; onBrowse: () => void }) {
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
        <Button variant="primary" size="lg" className="w-full" onClick={onCreateNew}>Create a new identity</Button>
        <Button size="lg" className="w-full" onClick={onHaveKey}>I already have a key</Button>
        {/* Deliberately quieter than the two above: creating or restoring an
            identity stays the main path, this is the escape hatch. */}
        <Button variant="ghost" size="lg" className="w-full" onClick={onBrowse}>Look around first</Button>
      </div>
      <p className="text-text-dim text-caption mt-2 text-center">
        You can read Nostr without an identity. You'll need one to post, reply, or follow.
      </p>
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
    <Shell step={0} totalSteps={3}>
      <Heading>Your identity is ready.</Heading>
      <Body>
        We generated a unique key pair for you. Your <strong className="text-text">public key</strong> is
        your identity on Nostr — like a username, but cryptographically yours. Share it freely.
      </Body>

      <div className="border border-border mb-2 rounded-lg">
        <div className="px-3 py-1.5 border-b border-border-subtle">
          <span className="text-text-dim text-micro uppercase tracking-widest">Your public key (npub)</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <span title={signer.npub} className="text-text font-mono text-caption truncate flex-1 select-all">{signer.npub}</span>
          <button
            onClick={handleCopy}
            aria-label="Copy public key"
            className="text-caption text-text-dim hover:text-accent transition-colors shrink-0"
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
      </div>
      <p className="text-text-dim text-caption mb-6">Safe to share with anyone. This is how people find you on Nostr.</p>

      <Button variant="primary" size="lg" className="w-full" onClick={() => onNext(signer)}>Next: back up your secret key<ArrowRight /></Button>
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

  // "Back up later" escape hatch — runs the SAME login as confirming (this is
  // what saves the key to the keychain and signs in); it only skips the
  // checkbox gate. The key stays retrievable via Settings → Identity.
  const handleSkipBackup = async () => {
    setSaving(true);
    await loginWithNsec(signer.nsec);
    setSaving(false);
    onComplete();
  };

  return (
    <Shell step={1} totalSteps={3}>
      <Heading>Save your secret key.</Heading>
      <Body>
        Your <strong className="text-text">secret key</strong> is your password, and nobody can
        reset it — not us, not anyone. Vega keeps it in this computer's keychain so you stay
        signed in, but if this computer is lost or wiped and you have no copy, the account is
        gone for good. Save a copy in a password manager now.
      </Body>

      <div className="border border-danger/40 mb-2 rounded-lg overflow-hidden">
        <div className="px-3 py-1.5 border-b border-danger/40 bg-danger/5">
          <span className="text-danger text-micro uppercase tracking-widest">Secret key (nsec) — keep private</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <span title={revealed ? signer.nsec : undefined} className={`font-mono text-caption truncate flex-1 ${revealed ? "text-text select-all" : "text-text-dim"}`}>
            {revealed ? signer.nsec : "••••••••••••••••••••••••••••••••••••••••••••••••"}
          </span>
          <button
            onClick={() => setRevealed(!revealed)}
            className="text-caption text-text-dim hover:text-text transition-colors shrink-0"
          >
            {revealed ? "hide" : "reveal"}
          </button>
          <button
            onClick={handleCopy}
            aria-label="Copy secret key"
            className="text-caption text-text-dim hover:text-danger transition-colors shrink-0"
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
      </div>
      <p className="text-text-dim text-caption mb-6">
        Never share this with anyone. Anyone who has it controls your account.
      </p>

      <label className="flex items-start gap-3 mb-5 cursor-pointer group">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 accent-accent w-4 h-4 shrink-0"
        />
        <span className="text-text-dim text-body group-hover:text-text transition-colors">
          I've saved my secret key in a safe place and understand that losing it means losing access to my account.
        </span>
      </label>

      {loginError && <p className="text-danger text-caption mb-3">{loginError}</p>}

      <Button variant="primary" size="lg" className="w-full" onClick={handleStart} disabled={!confirmed} busy={saving}>
        {saving ? "Setting up…" : "Start using Vega"}
      </Button>
      <Button variant="ghost" size="lg" className="w-full mt-1" onClick={handleSkipBackup} busy={saving}>I'll back up my key later</Button>
      <p className="text-text-muted text-caption text-center mt-1">
        You can also copy it later from Settings → Identity, on this computer only.
      </p>
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

      <div role="tablist" className="flex border border-border mb-4 rounded-sm overflow-hidden">
        {(["nsec", "npub", "bunker"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setValue(""); }}
            className={`flex-1 py-2 text-ui transition-colors ${
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
        // A secret key is a password: never on screen in clear text. The in-app
        // login modal already masked it; this screen did not.
        type={mode === "nsec" ? "password" : "text"}
        autoComplete="off"
        spellCheck={false}
        placeholder={mode === "nsec" ? "nsec1…" : mode === "npub" ? "npub1…" : "bunker://…"}
        aria-label={mode === "nsec" ? "Secret key" : mode === "npub" ? "Public key" : "Bunker URI"}
        autoFocus
        className="w-full bg-bg border border-border-strong px-3 py-2 text-text text-ui font-mono focus:outline-none focus:border-accent placeholder:text-text-dim mb-2 rounded-lg"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
      />

      {mode === "nsec" && (
        <p className="text-text-dim text-caption mb-4">Stored in this computer's keychain. Never sent to any server.</p>
      )}
      {mode === "npub" && (
        <p className="text-text-dim text-caption mb-4">Read-only mode — you can browse but not post, react, or zap.</p>
      )}
      {mode === "bunker" && (
        <p className="text-text-dim text-caption mb-4">Connect to nsecBunker, Amber, or similar. Paste your bunker:// URI.</p>
      )}

      {loginError && <p className="text-danger text-caption mb-3">{loginError}</p>}

      <div className="space-y-2">
        <Button variant="primary" size="lg" className="w-full" onClick={handleLogin} disabled={!value.trim()} busy={loading}>
          {loading ? (mode === "bunker" ? "Connecting…" : "Logging in…") : "Log in"}
        </Button>
        <Button variant="ghost" size="lg" className="w-full" onClick={onBack}><ArrowLeft />Back</Button>
      </div>
    </Shell>
  );
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>("welcome");
  const setFeedTab = useUIStore((s) => s.setFeedTab);
  const [generatedSigner, setGeneratedSigner] = useState<NDKPrivateKeySigner | null>(null);

  if (step === "welcome") {
    return (
      <WelcomeStep
        onCreateNew={() => setStep("create")}
        onHaveKey={() => setStep("login")}
        onBrowse={() => {
          setBrowseOnly(true);
          // Following is empty without follows, and Global is a spam-adjacent
          // firehose — neither is a fair first impression for someone who just
          // wanted to look. Trending is the closest thing to a curated view.
          setFeedTab("trending", { remember: false });
          onComplete();
        }}
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
    return <BackupStep signer={generatedSigner} onComplete={() => setStep("interests")} />;
  }

  if (step === "interests") {
    return <InterestsStep onComplete={onComplete} />;
  }

  if (step === "login") {
    return <LoginStep onBack={() => setStep("welcome")} onComplete={onComplete} />;
  }

  return null;
}
