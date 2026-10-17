import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import pkg from "../../../package.json";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUserStore, useCanSign, readSecretKey, type SecretKey } from "../../stores/user";
import { useLightningStore } from "../../stores/lightning";
import { RemoveAccountConfirm } from "../sidebar/AccountSwitcher";
import { useUIStore } from "../../stores/ui";
import { useWoTStore } from "../../stores/wot";
import { themes } from "../../lib/themes";
import { useMuteStore } from "../../stores/mute";
import { useBookmarkStore } from "../../stores/bookmark";
import { getStoredRelayUrls } from "../../lib/nostr";
import { isDiagLogEnabled, setDiagLogEnabled, getDiagLogPath } from "../../lib/feedDiagnostics";
import { useProfile } from "../../hooks/useProfile";
import { profileName, shortenPubkey } from "../../lib/utils";
import { refreshProxySettingsCache, type ProxySettings } from "../../lib/proxy";
import { NWCWizard } from "./NWCWizard";
import { getNotificationSettings, saveNotificationSettings, ensurePermission } from "../../lib/notifications";
import { ViewHeader } from "./ViewHeader";
import { Switch } from "./Switch";
import {
  isLocalRelayEnabled,
  setLocalRelayEnabled,
  connectLocalRelay,
  disconnectLocalRelay,
  getRelayPort,
  getRelayStats,
  type RelayStats,
} from "../../lib/localRelay";
import { Button } from "./Button";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { copyText } from "../../lib/clipboard";

function MutedRow({ pubkey, onUnmute }: { pubkey: string; onUnmute: () => void }) {
  const profile = useProfile(pubkey);
  const name = profileName(profile, pubkey.slice(0, 12) + "…");
  return (
    <div className="flex items-center gap-3 px-3 py-2 border border-border text-ui group rounded-lg">
      {profile?.picture && (
        <img src={profile.picture} alt={`${name}'s avatar`} className="w-5 h-5 rounded-full object-cover shrink-0" />
      )}
      <span className="text-text truncate flex-1">{name}</span>
      <button
        onClick={onUnmute}
        className="text-text-dim hover:text-accent text-caption opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
      >
        unmute
      </button>
    </div>
  );
}

const MUTED_SHOWN = 10;

function MuteSection() {
  const { mutedPubkeys, unmute } = useMuteStore();
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? mutedPubkeys : mutedPubkeys.slice(0, MUTED_SHOWN);
  // Always shown, with its count: hidden when empty, nobody learned where
  // muted people go. The first ten, then on request: a long list is a long
  // page and a profile lookup per row.
  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">
        Muted accounts ({mutedPubkeys.length})
      </h3>
      {mutedPubkeys.length === 0 ? (
        <p className="text-text-muted text-caption">People you mute appear here. Mute someone from the menu on one of their notes.</p>
      ) : (
        <div className="space-y-1">
          {shown.map((pk) => (
            <MutedRow key={pk} pubkey={pk} onUnmute={() => unmute(pk)} />
          ))}
          {!showAll && mutedPubkeys.length > MUTED_SHOWN && (
            <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>Show all {mutedPubkeys.length}</Button>
          )}
        </div>
      )}
    </section>
  );
}

function ArticlesSection() {
  const hideRss = useUIStore((s) => s.hideRssArticles);
  const setHideRss = useUIStore((s) => s.setHideRssArticles);

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">
        Articles
      </h3>
      <Switch
        checked={hideRss}
        onChange={() => setHideRss(!hideRss)}
        label="Hide automatic news reposts"
        hint={
          <>
            {hideRss
              ? "Leaves accounts that only republish news websites as articles out of the Latest tab."
              : "Accounts that only republish news websites as articles show in the Latest tab."}
            {" "}People you follow always show. Latest also leaves out accounts without a profile.
          </>
        }
      />
    </section>
  );
}

function MutedKeywordsSection() {
  const { mutedKeywords, addKeyword, removeKeyword } = useMuteStore();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmed = input.trim().toLowerCase();
    if (trimmed.length < 2) {
      setError("Minimum 2 characters");
      return;
    }
    if (mutedKeywords.includes(trimmed)) {
      setError("Already muted");
      return;
    }
    addKeyword(trimmed);
    setInput("");
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
    if (e.key === "Escape") setInput("");
  };

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">
        Muted keywords {mutedKeywords.length > 0 && `(${mutedKeywords.length})`}
      </h3>
      <p className="text-text-dim text-caption mb-3">
        Notes containing these words or phrases will be hidden from your feeds.
      </p>
      {mutedKeywords.length > 0 && (
        <div className="space-y-1 mb-3">
          {mutedKeywords.map((kw) => (
            <div key={kw} className="flex items-center gap-3 px-3 py-2 border border-border text-ui group rounded-lg">
              <span className="text-text truncate flex-1">{kw}</span>
              <button
                onClick={() => removeKeyword(kw)}
                className="text-text-dim hover:text-danger text-caption opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          placeholder="Word or phrase to mute"
          className="flex-1 bg-bg border border-border-strong px-3 py-1.5 text-text text-ui focus:outline-none focus:border-accent placeholder:text-text-dim rounded-lg"
        />
        <Button onClick={handleAdd}>Add</Button>
      </div>
      {error && <p className="text-danger text-caption mt-1">{error}</p>}
    </section>
  );
}

function WoTSection() {
  const { enabled, wotSet, loading, setEnabled, buildWoT } = useWoTStore();
  const { pubkey, follows, followsStatus } = useUserStore();
  // An empty list means "follows nobody" only once it has loaded. Until then
  // the switch cannot be used, and must not blame the user for it.
  const noFollows = follows.length === 0;
  const whyNot = !noFollows ? undefined
    : !pubkey ? "Sign in first."
    : followsStatus === "loaded" ? "Available once you follow someone."
    : followsStatus === "unknown" ? "Your follow list could not be loaded."
    : "Loading your follow list…";

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    if (next && pubkey && follows.length > 0 && wotSet.size === 0 && !loading) {
      buildWoT(pubkey, follows);
    }
  };

  const handleRebuild = () => {
    if (pubkey && follows.length > 0 && !loading) {
      buildWoT(pubkey, follows);
    }
  };

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">
        Hide strangers
      </h3>
      <Switch
        checked={enabled && !noFollows}
        onChange={() => toggle()}
        disabled={noFollows}
        label="Only show people connected to me"
        hint={<>{whyNot && <>{whyNot}{" "}</>}Shows posts, reactions and zaps only from people you follow and the people they follow. Good against spam; you also stop seeing everyone else.</>}
      />
      {enabled && !noFollows && (
        <div className="mt-2 ml-12 space-y-1">
          {loading ? (
            <p className="text-text-dim text-caption">Building…</p>
          ) : wotSet.size > 0 ? (
            <div className="flex items-center gap-3">
              <p className="text-text-dim text-caption">Trusted accounts: {wotSet.size}</p>
              <Button variant="ghost" size="sm" onClick={handleRebuild}>Rebuild</Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function IdentitySection() {
  const { npub, loggedIn, pubkey } = useUserStore();
  const [copied, setCopied] = useState(false);
  const [secret, setSecret] = useState<SecretKey | null>(null);
  const nsec = secret?.nsec ?? null;
  const [revealed, setRevealed] = useState(false);
  const [nsecCopied, setNsecCopied] = useState(false);

  // The secret key: from the OS keychain, or from this session when the
  // keychain has none. Null for read-only (npub) and remote-signer (bunker)
  // accounts — the nsec row is hidden then. Only the newest read counts: an
  // account switch must not leave the previous account's key in the row.
  useEffect(() => {
    setSecret(null);
    setRevealed(false);
    if (!pubkey) return;
    let current = true;
    readSecretKey(pubkey).then((key) => { if (current) setSecret(key); });
    return () => { current = false; };
  }, [pubkey]);

  if (!loggedIn || !npub) {
    return (
      <section>
        <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">Identity</h3>
        <p className="text-text-dim text-body">Not logged in.</p>
      </section>
    );
  }

  const handleCopy = async () => {
    if (!(await copyText(npub))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyNsec = async () => {
    if (!nsec || !(await copyText(nsec))) return;
    setNsecCopied(true);
    setTimeout(() => setNsecCopied(false), 2000);
  };

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">Identity</h3>
      <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg">
        <span className="text-text font-mono text-caption truncate flex-1">{npub}</span>
        <button
          onClick={handleCopy}
          className="text-caption text-text-dim hover:text-accent transition-colors shrink-0"
        >
          {copied ? "copied ✓" : "copy npub"}
        </button>
      </div>
      <p className="text-text-dim text-caption mt-1 px-1">Your public key. Safe to share.</p>

      {nsec && (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border border-danger/40 mt-3 rounded-lg">
            <span className={`font-mono text-caption truncate flex-1 ${revealed ? "text-text" : "text-text-dim"}`}>
              {revealed ? nsec : "•".repeat(48)}
            </span>
            <button
              onClick={() => setRevealed((v) => !v)}
              className="text-caption text-text-dim hover:text-text transition-colors shrink-0"
            >
              {revealed ? "hide" : "reveal"}
            </button>
            {revealed && (
              <button
                onClick={handleCopyNsec}
                className="text-caption text-text-dim hover:text-danger transition-colors shrink-0"
              >
                {nsecCopied ? "copied ✓" : "copy"}
              </button>
            )}
          </div>
          <p className="text-text-dim text-caption mt-1 px-1">
            Your secret key — the only way to recover this account. Never share it. Back it up somewhere safe.
          </p>
          {secret?.stored === false && (
            <p role="alert" className="text-danger text-caption mt-1 px-1">
              This key is not saved in this computer's keychain. It is gone when Vega closes, and you will be signed out. Copy it now and keep it somewhere safe.
            </p>
          )}
          {/* A locked keychain may well hold the key: "not saved" would be a guess. */}
          {secret?.stored === null && (
            <p role="alert" className="text-danger text-caption mt-1 px-1">
              Vega could not read this computer's keychain, so it cannot tell whether this key is saved there. If it is not, the key is gone when Vega closes. Copy it now and keep it somewhere safe.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function WalletSection() {
  const nwcUri = useLightningStore((s) => s.nwcUri);
  const { openView } = useUIStore();
  const canSign = useCanSign();
  const [connecting, setConnecting] = useState(false);
  // Once a wallet is connected (or disconnected again), the wizard's job is done and the one row comes back.
  useEffect(() => { setConnecting(false); }, [nwcUri]);
  // One row until asked: the wizard's four wallet cards took a third of the
  // first screen of Settings, before the account and everything daily.
  return (
    <section>
      {!nwcUri && (
        <p className="text-text-muted text-caption mb-3">
          Zaps are small Bitcoin tips. To send them, link a Lightning wallet. Pick yours and Vega shows the steps. Vega never holds your money; it asks your wallet to pay.
        </p>
      )}
      {nwcUri ? (
        <NWCWizard />
      ) : connecting ? (
        <>
          <NWCWizard />
          <Button variant="ghost" className="mt-2" onClick={() => setConnecting(false)}>Not now</Button>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-text text-body">No wallet connected</span>
          <Button onClick={() => setConnecting(true)}>Connect a wallet</Button>
        </div>
      )}
      {canSign && (
        <p className="text-text-muted text-caption mt-3">
          Streaming sats to podcasts while you listen has its own limits:{" "}
          <button type="button" onClick={() => openView("v4v")} className="text-accent underline underline-offset-2 hover:text-accent-hover transition-colors">Podcast streaming limits</button>
        </p>
      )}
    </section>
  );
}

/** Removing an account from this computer, from Settings as well as from the account menu. */
function RemoveAccountSection() {
  const { accounts, pubkey, removeAccount } = useUserStore();
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = accounts.find((a) => a.pubkey === pubkey) ?? null;
  if (!current) return null;
  const name = current.name || shortenPubkey(current.npub);
  // Cancel unmounts the confirmation: focus goes back to the button that opened it, not to the page.
  const cancel = () => { setAsking(false); requestAnimationFrame(() => trigger.current?.focus()); };
  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">This computer</h3>
      {asking ? (
        <div className="border border-border rounded-lg overflow-hidden [&>*]:border-b-0">
          <RemoveAccountConfirm account={current} name={name} onCancel={cancel} onConfirm={() => { setAsking(false); removeAccount(current.pubkey); }} />
        </div>
      ) : (
        <Button ref={trigger} variant="ghost" tone="danger" onClick={() => setAsking(true)}>Remove this account from this computer…</Button>
      )}
    </section>
  );
}

function ExportSection() {
  const { follows } = useUserStore();
  const { bookmarkedIds, bookmarkedArticleAddrs } = useBookmarkStore();
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleExport = async () => {
    setStatus("saving");
    setErrorMsg(null);
    try {
      const filePath = await save({
        defaultPath: `vega-export-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) {
        setStatus("idle");
        return;
      }

      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        bookmarks: {
          noteIds: bookmarkedIds,
          articleAddrs: bookmarkedArticleAddrs,
        },
        follows,
        relays: getStoredRelayUrls(),
      };

      await writeTextFile(filePath, JSON.stringify(exportData, null, 2));
      setStatus("done");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      setErrorMsg(String(err));
      setStatus("error");
    }
  };

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">Back up follows and bookmarks</h3>
      <p className="text-text-muted text-caption mb-3">
        Saves your follows, bookmarks and relay list to a file on this computer. It does not include your secret key; back that up separately.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleExport} busy={status === "saving"}>
          {status === "done" && <Check />}{status === "saving" ? "Saving…" : status === "done" ? "Saved" : "Save a backup file"}
        </Button>
        <span className="text-text-dim text-caption">
          {bookmarkedIds.length} notes · {bookmarkedArticleAddrs.length} articles · {follows.length} follows · {getStoredRelayUrls().length} relays
        </span>
      </div>
      {errorMsg && <p className="text-danger text-caption mt-1">{errorMsg}</p>}
    </section>
  );
}

function NotificationSection() {
  const [settings, setSettings] = useState(getNotificationSettings);

  const toggle = (key: "mentions" | "dms" | "zaps" | "followers") => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    saveNotificationSettings(next);
    // Request permission on first enable
    if (next[key]) ensurePermission().catch(() => {});
  };

  const items: Array<{ key: "mentions" | "dms" | "zaps" | "followers"; label: string }> = [
    { key: "mentions", label: "Mentions" },
    { key: "dms", label: "Direct messages" },
    { key: "zaps", label: "Zaps received" },
    { key: "followers", label: "New followers" },
  ];

  return (
    <section>
      <p className="text-text-muted text-caption mb-3">
        Show a desktop notification for the things switched on below. Your system may ask for permission the first time.
      </p>
      <div className="space-y-2">
        {items.map(({ key, label }) => (
          <Switch
            key={key}
            checked={settings[key]}
            onChange={() => toggle(key)}
            label={label}
          />
        ))}
      </div>
    </section>
  );
}

function validateProxyUrl(enabled: boolean, url: string): string | null {
  if (!enabled) return null;
  const trimmed = url.trim();
  if (!trimmed) return "Proxy URL is required";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "socks5:" && parsed.protocol !== "http:") {
      return "Use socks5:// or http://";
    }
    if (!parsed.hostname) return "Proxy URL must include a host";
    if (!parsed.port) return "Proxy URL must include a port";
  } catch {
    return "Proxy URL is invalid";
  }
  return null;
}

function ProxySection() {
  const [settings, setSettings] = useState<ProxySettings>({ enabled: false, url: "" });
  const [initial, setInitial] = useState<ProxySettings>({ enabled: false, url: "" });
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ProxySettings>("get_proxy_settings")
      .then((loaded) => {
        setSettings(loaded);
        setInitial(loaded);
        setStatus("idle");
      })
      .catch((err) => {
        setError(String(err));
        setStatus("error");
      });
  }, []);

  const validationError = validateProxyUrl(settings.enabled, settings.url);
  const dirty = settings.enabled !== initial.enabled || settings.url.trim() !== initial.url.trim();
  const savedNeedsRestart = status === "saved" && !dirty;

  const saveSettings = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setStatus("saving");
    setError(null);
    const next = { enabled: settings.enabled, url: settings.url.trim() };
    try {
      await invoke("save_proxy_settings", { settings: next });
      refreshProxySettingsCache();
      setSettings(next);
      setInitial(next);
      setStatus("saved");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  };

  const toggle = () => {
    setSettings((current) => ({ ...current, enabled: !current.enabled }));
    setError(null);
    if (status === "saved") setStatus("idle");
  };

  const updateUrl = (value: string) => {
    setSettings((current) => ({ ...current, url: value }));
    setError(null);
    if (status === "saved") setStatus("idle");
  };

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">
        Network proxy
      </h3>
      <p className="text-text-muted text-caption mb-3">
        Send Vega's traffic through a proxy such as Tor. Leave this off unless you know you need it.
      </p>
      <Switch
        checked={settings.enabled}
        onChange={() => toggle()}
        disabled={status === "loading"}
        label="Use proxy for connections"
        className="mb-3"
      />
      <div className="flex gap-2 ml-12">
        <input
          value={settings.url}
          onChange={(e) => updateUrl(e.target.value)}
          placeholder="socks5://127.0.0.1:9050"
          disabled={!settings.enabled || status === "loading"}
          className="flex-1 bg-bg border border-border-strong px-3 py-1.5 text-text text-ui focus:outline-none focus:border-accent placeholder:text-text-dim disabled:opacity-50 disabled:cursor-not-allowed font-mono rounded-lg"
        />
        <Button onClick={saveSettings} disabled={status === "loading" || !!validationError || !dirty} busy={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-text-dim text-caption mt-1.5 ml-12">
        Applies after restart. Example: socks5://127.0.0.1:9050
      </p>
      {/* The one safety sentence in Settings, in the warning colour and not in developer words. */}
      <p className="text-warning text-caption mt-1 ml-12 leading-relaxed">
        Not fully private yet. Your network provider may still see which relays you look up, even with the proxy on. Uploads, link previews and update checks are covered.
      </p>
      {(error || validationError) && (
        <p className="text-danger text-caption mt-1 ml-12">{error ?? validationError}</p>
      )}
      {savedNeedsRestart && (
        <div className="flex items-center gap-3 mt-2 ml-12">
          <p className="text-accent text-caption">Saved. Restart Vega to apply it to all connections.</p>
          <Button size="sm" onClick={() => relaunch()}>Restart now</Button>
        </div>
      )}
    </section>
  );
}

function ThemeSection() {
  const { themeId, setTheme } = useUIStore();

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-3 text-text-dim">
        Theme
      </h3>
      {/* A grid with room for the whole name: in a wrapping row of fixed-width buttons "Catppuccin Mocha" was cut to "Catppucci…". */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {themes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => setTheme(theme.id)}
            aria-pressed={themeId === theme.id}
            className={`flex flex-col items-center gap-1.5 p-2 border transition-colors rounded-sm ${
              themeId === theme.id
                ? "border-accent bg-bg-hover"
                : "border-border hover:border-accent/40"
            }`}
          >
            <div className="flex gap-0.5 w-full h-5 rounded-sm overflow-hidden">
              <div className="flex-1" style={{ background: theme.colors.bg }} />
              <div className="flex-1" style={{ background: theme.colors["bg-raised"] }} />
              <div className="flex-1" style={{ background: theme.colors.accent }} />
              <div className="flex-1" style={{ background: theme.colors.text }} />
            </div>
            <span className="text-caption text-text-muted text-center">
              {theme.name}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

const FONT_PRESETS = [
  { label: "Small", size: 12 },
  { label: "Normal", size: 14 },
  { label: "Large", size: 17 },
  { label: "Extra Large", size: 20 },
];

function FontSizeSection() {
  const { fontSize, setFontSize } = useUIStore();

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">
        Text size
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        {FONT_PRESETS.map(({ label, size }) => (
          <button
            key={size}
            onClick={() => setFontSize(size)}
            className={`px-3 py-1.5 text-ui border transition-colors ${
              fontSize === size
                ? "border-accent text-accent"
                : "border-border text-text-muted hover:text-text hover:border-accent/40"
            } rounded-sm`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-text-muted text-caption mt-2 px-1">
        Changes the text size in the main area; the sidebar stays as it is. Articles follow it on their own measure.
      </p>
    </section>
  );
}

function EasyReadFontSection() {
  const { easyReadFont, setEasyReadFont } = useUIStore();

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">
        Easy-read font
      </h3>
      <Switch
        checked={easyReadFont}
        onChange={setEasyReadFont}
        label="Easier-to-read font"
        hint="Uses Atkinson Hyperlegible, a font designed by the Braille Institute, with slightly looser spacing and taller lines. Helpful for dyslexia and long reading sessions."
      />
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ExperimentalSection() {
  const [enabled, setEnabled] = useState(isLocalRelayEnabled);
  const [port, setPort] = useState<number | null>(null);
  const [stats, setStats] = useState<RelayStats | null>(null);

  useEffect(() => {
    if (enabled) {
      getRelayPort().then(setPort);
      getRelayStats().then(setStats);
    }
  }, [enabled]);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    setLocalRelayEnabled(next);
    if (next) {
      connectLocalRelay().catch(() => {});
    } else {
      disconnectLocalRelay();
      setPort(null);
      setStats(null);
    }
  };

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">
        Personal relay
      </h3>
      <Switch
        checked={enabled}
        onChange={() => toggle()}
        label="Run a relay on this computer"
        hint="Keeps a copy of your notes and your follows' notes here, for offline reading and faster loads. Still under development."
      />
      {enabled && (port || stats) && (
        <div className="text-text-dim text-caption mt-2 ml-12 space-y-0.5">
          {port && <p>Running on port {port}</p>}
          {stats && (
            <p>
              {stats.event_count} events stored &middot; {formatBytes(stats.db_size_bytes)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function DiagnosticsSection() {
  const [enabled, setEnabledState] = useState(isDiagLogEnabled());
  const [logPath, setLogPath] = useState<string | null>(null);

  useEffect(() => {
    if (enabled) getDiagLogPath().then(setLogPath);
  }, [enabled]);

  const toggle = () => {
    const next = !enabled;
    setEnabledState(next);
    setDiagLogEnabled(next);
  };

  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">
        Diagnostics
      </h3>
      <Switch
        checked={enabled}
        onChange={() => toggle()}
        label="Write diagnostics log"
        hint={enabled
          ? "Recording relay and memory samples twice a second. Turn this off when you're done — it's only useful while reproducing a problem."
          : "Turn on only if asked to, while reproducing a bug — then send the file with your report."}
      />
      {enabled && logPath && (
        <p className="text-text-dim text-micro mt-1 ml-12 font-mono break-all">{logPath}</p>
      )}
    </section>
  );
}

const GROUPS = [
  { id: "appearance", title: "Appearance" },
  { id: "account", title: "Account" },
  { id: "wallet", title: "Wallet for zaps" },
  { id: "notifications", title: "Notifications" },
  { id: "what-you-see", title: "What you see" },
  { id: "advanced", title: "Advanced" },
] as const;

/** One group of settings: a title, and its sections. The id is what the jump row, and a link into Settings, scroll to. */
function Group({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="scroll-mt-4">
      {/* Focusable, so a jump moves the keyboard as well as the view. */}
      <h2 id={`settings-${id}-title`} tabIndex={-1} className="text-body font-semibold text-text mb-4 outline-none">{title}</h2>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

/**
 * The relay privacy settings live in Relays, which has the better wording and
 * the list they are about. One row here says where. They used to be here as
 * well, under other, more technical labels.
 */
function RelayPrivacyRow() {
  const { setView } = useUIStore();
  return (
    <section>
      <h3 className="text-micro font-medium uppercase tracking-widest mb-2 text-text-dim">Relay privacy</h3>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-text-muted text-caption flex-1 min-w-48">Which servers Vega talks to, and which ones it identifies you to.</p>
        <Button onClick={() => setView("relays")}>Open Relays</Button>
      </div>
    </section>
  );
}

/**
 * Settings, in six groups, after the October 2026 UI review. It was one flat
 * page of sixteen sections in build order, three screens long with no way to
 * jump: the wallet wizard took a third of the first screen, the secret key
 * was section twelve between Export and Muted keywords, and Proxy, Experimental
 * and Diagnostics sat above it. Daily preferences first, one-off setup after,
 * and what almost nobody needs behind Advanced.
 */
export function SettingsView() {
  const pubkey = useUserStore((s) => s.pubkey);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const jump = (id: string) => {
    // Advanced must be open and laid out before the scroll, or the scroll is
    // clamped to the closed page and the opened rows land under the fold.
    if (id === "advanced") flushSync(() => setAdvancedOpen(true));
    document.getElementById(`settings-${id}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    // And the keyboard goes with the view: the next Tab starts inside the group.
    document.getElementById(`settings-${id}-title`)?.focus({ preventScroll: true });
  };
  return (
    <div className="h-full flex flex-col">
      <ViewHeader title="Settings" />

      <div className="flex-1 overflow-y-auto content-column">
        <nav aria-label="Settings sections" className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-ui">
          {GROUPS.map((g) => (
            // Named "Go to …", so the jump and the Advanced group's own toggle are two different buttons to a screen reader.
            <button key={g.id} type="button" onClick={() => jump(g.id)} aria-label={`Go to ${g.title}`} className="text-text-muted hover:text-accent transition-colors">{g.title}</button>
          ))}
        </nav>

        <div className="p-4 space-y-10">
          <Group id="appearance" title="Appearance">
            <ThemeSection />
            <FontSizeSection />
            <EasyReadFontSection />
          </Group>
          <Group id="account" title="Account">
            <IdentitySection />
            <ExportSection />
            <RemoveAccountSection key={pubkey ?? "none"} />
          </Group>
          <Group id="wallet" title="Wallet for zaps">
            <WalletSection />
          </Group>
          <Group id="notifications" title="Notifications">
            <NotificationSection />
          </Group>
          <Group id="what-you-see" title="What you see">
            <MuteSection />
            <MutedKeywordsSection />
            <WoTSection />
            <ArticlesSection />
          </Group>

          {/* Advanced is closed until asked: proxy, local relay and diagnostics are for the few who know they need them. */}
          <section id="settings-advanced" aria-labelledby="settings-advanced-title" className="scroll-mt-4">
            {/* The heading holds the button, not the other way round: a heading inside a button is not a heading to a screen reader. */}
            <h2 id="settings-advanced-title" tabIndex={-1} className="text-body font-semibold text-text outline-none">
              <button type="button" onClick={() => setAdvancedOpen((v) => !v)} aria-expanded={advancedOpen} aria-controls="settings-advanced-body" className="flex items-center gap-2 text-left hover:text-accent transition-colors">
                {advancedOpen ? <ChevronDown size={16} className="text-text-muted" /> : <ChevronRight size={16} className="text-text-muted" />}
                Advanced
              </button>
            </h2>
            {advancedOpen ? (
              <div id="settings-advanced-body" className="space-y-6 mt-4">
                <ProxySection />
                <ExperimentalSection />
                <DiagnosticsSection />
                <RelayPrivacyRow />
              </div>
            ) : (
              <p className="text-text-muted text-caption mt-1 ml-6">Proxy, local relay, diagnostics. Most people never need these.</p>
            )}
          </section>

          {/* The build stamp, here and in Support, not in the sidebar's brand position. */}
          <p className="text-caption text-text-muted">Vega v{pkg.version}</p>
        </div>
      </div>
    </div>
  );
}
