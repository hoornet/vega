import { useState, useEffect, useRef, createContext, useContext } from "react";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { useBackupStore } from "../../stores/backup";
import { markFirstRun } from "../../stores/firstRun";
import { saveInterests } from "../../lib/interests";
import { useToastStore } from "../../stores/toast";
import { setBrowseOnly } from "../../lib/browseOnly";
import { ensureConnected } from "../../lib/nostr";
import { Button } from "../shared/Button";
import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import { copyText } from "../../lib/clipboard";
import { publishFailureReason } from "../../lib/publishErrors";
import { shortNpub, endSentence } from "../../lib/utils";

type Step = "welcome" | "create" | "backup" | "interests" | "login";

/**
 * The account being made, kept for the session while the flow is closed.
 *
 * Opened over the app, the flow can be closed at any step. Closed at the
 * backup step, the key may already be in a password manager; a new flow
 * that made a new key would leave the user with a saved key that opens
 * nothing. So the key and the name survive the flow, and the next "Create
 * account" takes them up again. Let go of once the account is made.
 */
let draft: { signer: NDKPrivateKeySigner; name: string } | null = null;
export function discardSignupDraft(): void { draft = null; }

interface OnboardingFlowProps {
  onComplete: () => void;
  /**
   * Where to begin. "welcome" is the first launch. The other two open the
   * same flow over the running app (`SignupOverlay`): "create" from "Create
   * account" in the banner or the account menu, "login" from "I have a key".
   * Opened that way the flow has a way out (`onCancel`; the overlay closes
   * on Escape) and skips the interests step, which belongs to the first
   * launch. What was typed, and the key made, survive a closed flow for the
   * session (see `draft`).
   */
  start?: "welcome" | "create" | "login";
  onCancel?: () => void;
}

// ─── Shared layout ───────────────────────────────────────────────────────────

/**
 * True when the flow is opened over the running app (`SignupOverlay`), inside
 * the text-size zoom, where a box sized in `vh`/`vw` is the window times the
 * zoom on Chromium. There the shell fills its container instead.
 */
export const EmbeddedOnboarding = createContext(false);

function Shell({
  children,
  step,
  totalSteps,
}: {
  children: React.ReactNode;
  step?: number;
  totalSteps?: number;
}) {
  const embedded = useContext(EmbeddedOnboarding);
  return (
    <div className={`${embedded ? "min-h-full w-full" : "h-screen w-screen"} bg-bg flex items-center justify-center`}>
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

// `text-muted`, not `text-dim`: these are sentences a new user has to read.
function Body({ children }: { children: React.ReactNode }) {
  return <p className="text-text-muted text-body leading-relaxed mb-6">{children}</p>;
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

function InterestsStep({ notice, onComplete }: { notice: string | null; onComplete: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (tag: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });

  const handleConfirm = () => {
    saveInterests(useUserStore.getState().pubkey, [...selected]);
    onComplete();
  };

  return (
    <Shell step={2} totalSteps={3}>
      <Heading>What are you into?</Heading>
      <Body>Pick a few topics — we'll suggest them as hashtags to explore.</Body>

      {/* What the step before could not do. Said here and not in a toast: a
          toast sits over this step's buttons, and is gone before it is read. */}
      {notice && <p role="alert" className="text-danger text-caption leading-relaxed mb-5">{notice}</p>}

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
        A desktop home for Nostr, the open social network. Read and write notes and
        long-form articles, follow podcasts, and tip people directly.
      </Body>
      <Body>
        No company sits in the middle. Your account is a key that only you hold, and
        Vega creates one for you in a few seconds.
      </Body>
      <div className="space-y-3">
        <Button variant="primary" size="lg" className="w-full" onClick={onCreateNew}>Create my account</Button>
        <Button size="lg" className="w-full" onClick={onHaveKey}>I already have a Nostr key</Button>
        {/* Deliberately quieter than the two above: creating or restoring an
            account stays the main path, this is the escape hatch. */}
        <Button variant="ghost" size="lg" className="w-full" onClick={onBrowse}>Look around first</Button>
      </div>
      <p className="text-text-muted text-caption mt-3 text-center">
        You can read without an account. You'll need one to post, reply, or follow.
      </p>
      <p className="text-text-dim text-caption mt-1 text-center">
        Free and open source. Your key stays on this computer.
      </p>
    </Shell>
  );
}

// ─── Step: Name ──────────────────────────────────────────────────────────────

/** Longer than any name, short enough that a paste of the wrong thing is cut. */
const NAME_MAX = 50;

// This step used to show the new account's public key: 63 characters the
// user could do nothing with, on a screen of its own, while no step asked
// what to be called. The account then went out as "npub1ksj…" and its first
// note was published under a key. Now the step asks for a name, and the
// public address is one quiet line.
function NameStep({ signer, name, steps, onName, onNext, onBack }: {
  signer: NDKPrivateKeySigner;
  name: string;
  /** How many steps the dots show: three on a first launch, two over the app. */
  steps: number;
  onName: (name: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // A head start. Nothing has connected to a relay yet, and a publish gives
  // each relay two and a half seconds to connect and accept: enough for most,
  // and with this the slower ones are up too by the time the name goes out
  // two steps on. `ensureConnected` gives up by itself and does nothing when
  // a relay is already up, so coming back to this step does not dial again.
  useEffect(() => {
    void ensureConnected().catch(() => { /* publishing connects again, and says so if it cannot */ });
  }, []);

  const handleCopy = async () => {
    if (!(await copyText(signer.npub))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Shell step={0} totalSteps={steps}>
      <Heading>What should people call you?</Heading>
      <Body>
        Your name is shown next to everything you write. A nickname is fine, and you
        can change it whenever you like.
      </Body>

      <label htmlFor="onboarding-name" className="block text-text-muted text-caption mb-1.5">Name</label>
      <input
        id="onboarding-name"
        value={name}
        onChange={(e) => onName(e.target.value)}
        // Not while a name is being composed (Japanese, Chinese, Korean and
        // more): there Enter picks a candidate, it does not finish the field.
        // WebKit ends the composition before it sends this key, so there it
        // is told by the key code alone.
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) onNext(); }}
        maxLength={NAME_MAX}
        autoComplete="off"
        spellCheck={false}
        placeholder="Your name"
        aria-describedby="onboarding-name-hint"
        autoFocus
        className="w-full bg-bg border border-border-strong px-3 py-2 text-text text-body focus:outline-none focus:border-accent placeholder:text-text-dim mb-1.5 rounded-lg"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
      />
      <p id="onboarding-name-hint" className="text-text-dim text-caption mb-6">
        You can leave it empty and add a name later.
      </p>

      <div className="flex items-center gap-2 mb-1">
        <span className="text-text-muted text-caption">Your public address:</span>
        <span title={signer.npub} className="text-text-muted font-mono text-caption">{shortNpub(signer.npub)}</span>
        <Button variant="ghost" size="sm" onClick={handleCopy} aria-label="Copy public address">
          {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-text-dim text-caption mb-6">This is how people find you. It is safe to share.</p>

      <div className="space-y-2">
        <Button variant="primary" size="lg" className="w-full" onClick={onNext}>Next: save your secret key<ArrowRight /></Button>
        <Button variant="ghost" size="lg" className="w-full" onClick={onBack}><ArrowLeft />Back</Button>
      </div>
    </Shell>
  );
}

/**
 * Publish the new account's name as its first profile. Returns what to tell
 * the user when it could not be, or null when the name is out.
 *
 * Only ever for a key made in this flow a moment ago: a profile replaces the
 * whole one before it, and this one holds nothing but a name.
 *
 * When no relay takes it, the account still works and the name is added from
 * the profile. There is deliberately no "Try again" that would publish it
 * later: by then the account may have a fuller profile, and this would
 * replace it with a name alone.
 */
async function publishName(name: string, pubkey: string): Promise<string | null> {
  try {
    // No time limit of its own: with a key on this computer the publish
    // settles within the two and a half seconds each relay is given.
    await useUserStore.getState().saveProfile({ name, display_name: name }, pubkey);
    return null;
  } catch (err) {
    const why = publishFailureReason(err);
    return `${endSentence(`Your name was not published${why ? `: ${why}` : ""}`)} Your account works without it, and you can add your name from your profile.`;
  }
}

// ─── Step: Backup nsec ───────────────────────────────────────────────────────

function BackupStep({ signer, name, steps, onComplete }: {
  signer: NDKPrivateKeySigner;
  name: string;
  steps: number;
  /** Called once signed in, with what could not be done on the way, if anything. */
  onComplete: (notice: string | null) => void;
}) {
  const { loginWithNsec, loginError } = useUserStore();
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  // Sticky: the box below may only be ticked once the key has been copied or
  // seen. Before, both easy ways through this step ended with no backup at
  // all: tick the box and go, or "later".
  const [everCopied, setEverCopied] = useState(false);
  // The same, read when the sign-in comes back: a copy made while "later"
  // was signing in means no reminder is needed.
  const copiedByNow = useRef(false);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const canConfirm = everCopied || revealed;

  const handleCopy = async () => {
    if (!(await copyText(signer.nsec))) return;
    setCopied(true);
    setEverCopied(true);
    copiedByNow.current = true;
    setTimeout(() => setCopied(false), 3000);
  };

  // Hidden again without a copy: the box was ticked on the strength of the
  // key being on screen, and it is not any more.
  const toggleReveal = () => {
    if (revealed && !everCopied) setConfirmed(false);
    setRevealed(!revealed);
  };

  // Sign in with the new key, then give the account its name. Both ways out
  // of this step end here. `later`: the user did not say the key is saved,
  // so the account is remembered as not backed up once it exists, unless
  // the key was copied by then.
  const finish = async (later: boolean) => {
    setSaving(true);
    await loginWithNsec(signer.nsec);
    // Not signed in: stay, with the reason shown above the button. This used
    // to go on to the next step regardless.
    if (useUserStore.getState().loginError) { setSaving(false); return; }
    // The key was made a moment ago: it follows nobody, and no relay has to be asked. Asked, "nobody"
    // needs every relay to answer, and one quiet relay among many left a new account with "Couldn't
    // reach your relays" and no way to follow anyone.
    useUserStore.getState().adoptEmptyContactList(signer.pubkey);
    markFirstRun(signer.pubkey);
    if (later && !copiedByNow.current) useBackupStore.getState().markPending(signer.pubkey);
    const notice = name ? await publishName(name, signer.pubkey) : null;
    setSaving(false);
    onComplete(notice);
  };

  const handleStart = () => {
    if (!confirmed) return;
    void finish(false);
  };

  // "Back up later" escape hatch — runs the SAME login as confirming (this is
  // what saves the key to the keychain and signs in); it only skips the
  // checkbox gate. The account is remembered as not backed up, and a banner
  // asks until the key has been copied once, from there or from Settings →
  // Account (which also falls back to this session when the keychain did
  // not take the key; `loginWithNsec` says so).
  const handleSkipBackup = () => void finish(true);

  return (
    <Shell step={1} totalSteps={steps}>
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
            onClick={toggleReveal}
            className="text-caption text-text-dim hover:text-text transition-colors shrink-0"
          >
            {revealed ? "hide" : "reveal"}
          </button>
        </div>
      </div>
      {/* The one thing this step is for, as a button and not a 10px link. */}
      <Button wrap className="w-full mb-2" onClick={handleCopy} aria-label="Copy secret key">
        {copied ? <Check /> : <Copy />}{copied ? "Copied. Paste it into your password manager now." : "Copy secret key"}
      </Button>
      <p className="text-text-dim text-caption mb-6">
        Never share this with anyone. Anyone who has it controls your account.
      </p>

      <label className={`flex items-start gap-3 mb-5 group ${canConfirm ? "cursor-pointer" : "cursor-not-allowed"}`}>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={!canConfirm}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 accent-accent w-4 h-4 shrink-0"
        />
        <span className={`text-body transition-colors ${canConfirm ? "text-text-dim group-hover:text-text" : "text-text-dim"}`}>
          I've saved my secret key in a safe place and understand that losing it means losing access to my account.
          {!canConfirm && <span className="block text-caption mt-0.5">Copy or reveal the key first.</span>}
        </span>
      </label>

      {loginError && <p className="text-danger text-caption mb-3">{loginError}</p>}

      <Button variant="primary" size="lg" className="w-full" onClick={handleStart} disabled={!confirmed} busy={saving}>
        {saving ? "Setting up…" : "Start using Vega"}
      </Button>
      <Button variant="ghost" size="lg" className="w-full mt-1" onClick={handleSkipBackup} busy={saving}>I'll back up my key later</Button>
      <p className="text-text-muted text-caption text-center mt-1">
        Vega will remind you until you have copied it. You can also copy it later from Settings → Account, on this computer only.
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
      <Heading>Sign in with your key.</Heading>

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
        <p className="text-text-dim text-caption mb-4">Browse as that account. You can read, but not post, reply or zap.</p>
      )}
      {mode === "bunker" && (
        <p className="text-text-dim text-caption mb-4">Connect to nsecBunker, Amber, or similar. Paste your bunker:// URI.</p>
      )}

      {loginError && <p className="text-danger text-caption mb-3">{loginError}</p>}

      <div className="space-y-2">
        <Button variant="primary" size="lg" className="w-full" onClick={handleLogin} disabled={!value.trim()} busy={loading}>
          {loading ? (mode === "bunker" ? "Connecting…" : "Signing in…") : "Sign in"}
        </Button>
        <Button variant="ghost" size="lg" className="w-full" onClick={onBack}><ArrowLeft />Back</Button>
      </div>
    </Shell>
  );
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export function OnboardingFlow({ onComplete, start = "welcome", onCancel }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>(start);
  const setFeedTab = useUIStore((s) => s.setFeedTab);
  const firstLaunch = start === "welcome";
  const steps = firstLaunch ? 3 : 2;
  // A failed sign-in, or a remote signer that did not answer at startup,
  // left its error in the store; it must not be drawn on a new account's
  // backup step.
  useEffect(() => { if (!firstLaunch) useUserStore.setState({ loginError: null }); }, [firstLaunch]);
  // The key and the name live here, not in a step: going back and forward
  // must not make a second key. From the backup step on, the first may
  // already be saved in a password manager.
  const [generatedSigner, setGeneratedSigner] = useState<NDKPrivateKeySigner | null>(() => (start === "create" ? (draft?.signer ?? NDKPrivateKeySigner.generate()) : null));
  const [name, setName] = useState(() => draft?.name ?? "");
  // Kept for the session, so a flow closed at the backup step comes back
  // with the key that may already be in a password manager.
  useEffect(() => { if (generatedSigner) draft = { signer: generatedSigner, name }; }, [generatedSigner, name]);
  const done = () => { draft = null; onComplete(); };
  /** Back from the first step of a flow opened over the app leaves the flow. */
  const leave = onCancel ?? (() => setStep("welcome"));
  const [notice, setNotice] = useState<string | null>(null);

  if (step === "welcome") {
    return (
      <WelcomeStep
        onCreateNew={() => {
          setGeneratedSigner((made) => made ?? draft?.signer ?? NDKPrivateKeySigner.generate());
          setStep("create");
        }}
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

  if (step === "create" && generatedSigner) {
    return (
      <NameStep
        signer={generatedSigner}
        name={name}
        steps={steps}
        onName={setName}
        onNext={() => setStep("backup")}
        onBack={firstLaunch ? () => setStep("welcome") : leave}
      />
    );
  }

  if (step === "backup" && generatedSigner) {
    return (
      <BackupStep
        signer={generatedSigner}
        name={name.trim()}
        steps={steps}
        onComplete={(problem) => {
          if (!firstLaunch) {
            // No next step to say it on: a toast is what is left.
            if (problem) useToastStore.getState().addToast(problem, "error");
            done();
            return;
          }
          setNotice(problem);
          setStep("interests");
        }}
      />
    );
  }

  if (step === "interests") {
    return <InterestsStep notice={notice} onComplete={done} />;
  }

  if (step === "login") {
    return (
      <LoginStep
        onBack={() => {
          // A failed try here must not be shown on the backup step of a new account.
          useUserStore.setState({ loginError: null });
          leave();
        }}
        onComplete={done}
      />
    );
  }

  return null;
}
