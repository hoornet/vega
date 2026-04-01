import { useState, useEffect } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { themes } from "../../lib/themes";
import { useMuteStore } from "../../stores/mute";
import { useBookmarkStore } from "../../stores/bookmark";
import { getStoredRelayUrls } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { profileName } from "../../lib/utils";
import { NWCWizard } from "./NWCWizard";
import { getNotificationSettings, saveNotificationSettings, ensurePermission } from "../../lib/notifications";
import {
  isLocalRelayEnabled,
  setLocalRelayEnabled,
  connectLocalRelay,
  disconnectLocalRelay,
  getRelayPort,
  getRelayStats,
  type RelayStats,
} from "../../lib/localRelay";

function MutedRow({ pubkey, onUnmute }: { pubkey: string; onUnmute: () => void }) {
  const profile = useProfile(pubkey);
  const name = profileName(profile, pubkey.slice(0, 12) + "…");
  return (
    <div className="flex items-center gap-3 px-3 py-2 border border-border text-[12px] group">
      {profile?.picture && (
        <img src={profile.picture} alt="" className="w-5 h-5 rounded-sm object-cover shrink-0" />
      )}
      <span className="text-text truncate flex-1">{name}</span>
      <button
        onClick={onUnmute}
        className="text-text-dim hover:text-accent text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      >
        unmute
      </button>
    </div>
  );
}

function MuteSection() {
  const { mutedPubkeys, unmute } = useMuteStore();
  const [expanded, setExpanded] = useState(false);
  if (mutedPubkeys.length === 0) return null;
  return (
    <section>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <span className="text-text-dim text-[10px] transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>
          ▶
        </span>
        <h2 className="text-text text-[11px] font-medium uppercase tracking-widest text-text-dim group-hover:text-text transition-colors">
          Muted accounts ({mutedPubkeys.length})
        </h2>
      </button>
      {expanded && (
        <div className="space-y-1 mt-2">
          {mutedPubkeys.map((pk) => (
            <MutedRow key={pk} pubkey={pk} onUnmute={() => unmute(pk)} />
          ))}
        </div>
      )}
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
      <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-2 text-text-dim">
        Muted keywords {mutedKeywords.length > 0 && `(${mutedKeywords.length})`}
      </h2>
      <p className="text-text-dim text-[11px] mb-3">
        Notes containing these words or phrases will be hidden from your feeds.
      </p>
      {mutedKeywords.length > 0 && (
        <div className="space-y-1 mb-3">
          {mutedKeywords.map((kw) => (
            <div key={kw} className="flex items-center gap-3 px-3 py-2 border border-border text-[12px] group">
              <span className="text-text truncate flex-1">{kw}</span>
              <button
                onClick={() => removeKeyword(kw)}
                className="text-text-dim hover:text-danger text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                remove
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
          placeholder="word or phrase to mute"
          className="flex-1 bg-bg border border-border px-3 py-1.5 text-text text-[12px] focus:outline-none focus:border-accent/50 placeholder:text-text-dim"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors shrink-0"
        >
          add
        </button>
      </div>
      {error && <p className="text-danger text-[11px] mt-1">{error}</p>}
    </section>
  );
}

function IdentitySection() {
  const { npub, loggedIn } = useUserStore();
  const [copied, setCopied] = useState(false);

  if (!loggedIn || !npub) {
    return (
      <section>
        <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-2 text-text-dim">Identity</h2>
        <p className="text-text-dim text-[12px]">Not logged in.</p>
      </section>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(npub).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section>
      <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-2 text-text-dim">Identity</h2>
      <div className="flex items-center gap-2 px-3 py-2 border border-border">
        <span className="text-text font-mono text-[11px] truncate flex-1">{npub}</span>
        <button
          onClick={handleCopy}
          className="text-[10px] text-text-dim hover:text-accent transition-colors shrink-0"
        >
          {copied ? "copied ✓" : "copy npub"}
        </button>
      </div>
      <p className="text-text-dim text-[10px] mt-1 px-1">Your public key. Safe to share.</p>
    </section>
  );
}

function WalletSection() {
  return (
    <section>
      <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-2 text-text-dim">Lightning Wallet (NWC)</h2>
      <NWCWizard />
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
      <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-2 text-text-dim">Export Data</h2>
      <p className="text-text-dim text-[11px] mb-3">
        Save your bookmarks, follows, and relay list to a JSON file. Your keys, your data.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={handleExport}
          disabled={status === "saving"}
          className="px-3 py-1.5 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {status === "saving" ? "exporting…" : status === "done" ? "exported ✓" : "export data"}
        </button>
        <span className="text-text-dim text-[10px]">
          {bookmarkedIds.length} notes · {bookmarkedArticleAddrs.length} articles · {follows.length} follows · {getStoredRelayUrls().length} relays
        </span>
      </div>
      {errorMsg && <p className="text-danger text-[10px] mt-1">{errorMsg}</p>}
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
      <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-2 text-text-dim">
        Notifications
      </h2>
      <p className="text-text-dim text-[11px] mb-3">
        OS-level push notifications. Requires system permission.
      </p>
      <div className="space-y-2">
        {items.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-3 cursor-pointer group">
            <button
              onClick={() => toggle(key)}
              className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                settings[key] ? "bg-accent" : "bg-border"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  settings[key] ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-text text-[12px]">{label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function ThemeSection() {
  const { themeId, setTheme } = useUIStore();

  return (
    <section>
      <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-3 text-text-dim">
        Theme
      </h2>
      <div className="flex flex-wrap gap-2">
        {themes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => setTheme(theme.id)}
            className={`flex flex-col items-center gap-1.5 p-2 border transition-colors rounded-sm w-20 ${
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
            <span className="text-[10px] text-text-muted truncate w-full text-center">
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
  { label: "Large", size: 16 },
  { label: "Extra Large", size: 18 },
];

function FontSizeSection() {
  const { fontSize, setFontSize } = useUIStore();

  return (
    <section>
      <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-2 text-text-dim">
        Font Size
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {FONT_PRESETS.map(({ label, size }) => (
          <button
            key={size}
            onClick={() => setFontSize(size)}
            className={`px-3 py-1.5 text-[11px] border transition-colors ${
              fontSize === size
                ? "border-accent text-accent"
                : "border-border text-text-muted hover:text-text hover:border-accent/40"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-text-dim text-[10px] mt-2 px-1">
        Adjusts the base text size across the app. Articles use their own reading font.
      </p>
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
      <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-2 text-text-dim">
        Experimental
      </h2>
      <p className="text-text-dim text-[11px] mb-3">
        Features under development. May change or be removed.
      </p>
      <label className="flex items-center gap-3 cursor-pointer group">
        <button
          onClick={toggle}
          className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
            enabled ? "bg-accent" : "bg-border"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
        <span className="text-text text-[12px]">Personal relay</span>
      </label>
      <p className="text-text-dim text-[10px] mt-1.5 ml-12">
        Run a local Nostr relay for offline access and faster reads.
      </p>
      {enabled && (port || stats) && (
        <div className="text-text-dim text-[10px] mt-2 ml-12 space-y-0.5">
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

export function SettingsView() {
  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-4 py-2.5 shrink-0">
        <h1 className="text-text text-sm font-medium tracking-wide">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-8">
        <ThemeSection />
        <FontSizeSection />
        <WalletSection />
        <NotificationSection />
        <ExperimentalSection />
        <ExportSection />
        <IdentitySection />
        <MuteSection />
        <MutedKeywordsSection />
      </div>
    </div>
  );
}
