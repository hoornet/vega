import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useBookmarkStore } from "../../stores/bookmark";
import { getNDK, getStoredRelayUrls, addRelay, removeRelay, publishRelayList } from "../../lib/nostr";
import { useProfile } from "../../hooks/useProfile";
import { NWCWizard } from "./NWCWizard";
import { getNotificationSettings, saveNotificationSettings, ensurePermission } from "../../lib/notifications";

function MutedRow({ pubkey, onUnmute }: { pubkey: string; onUnmute: () => void }) {
  const profile = useProfile(pubkey);
  const name = profile?.displayName || profile?.name || pubkey.slice(0, 12) + "…";
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
  if (mutedPubkeys.length === 0) return null;
  return (
    <section>
      <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-2 text-text-dim">
        Muted accounts ({mutedPubkeys.length})
      </h2>
      <div className="space-y-1">
        {mutedPubkeys.map((pk) => (
          <MutedRow key={pk} pubkey={pk} onUnmute={() => unmute(pk)} />
        ))}
      </div>
    </section>
  );
}

function RelayRow({ url, onRemove }: { url: string; onRemove: () => void }) {
  const ndk = getNDK();
  const relay = ndk.pool?.relays.get(url);
  const connected = relay?.connected ?? false;

  return (
    <div className="flex items-center gap-3 px-3 py-2 border border-border text-[12px] group">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-success" : "bg-text-dim"}`} />
      <span className="text-text truncate flex-1 font-mono">{url}</span>
      <button
        onClick={onRemove}
        className="text-text-dim hover:text-danger text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      >
        remove
      </button>
    </div>
  );
}

function RelaySection() {
  const { loggedIn } = useUserStore();
  const [relays, setRelays] = useState<string[]>(() => getStoredRelayUrls());
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishedAt, setPublishedAt] = useState<number | null>(null);

  const handleAdd = () => {
    const url = input.trim();
    if (!url) return;
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      setError("URL must start with ws:// or wss://");
      return;
    }
    if (relays.includes(url)) {
      setError("Already in list");
      return;
    }
    addRelay(url);
    setRelays(getStoredRelayUrls());
    setInput("");
    setError(null);
  };

  const handleRemove = (url: string) => {
    removeRelay(url);
    setRelays(getStoredRelayUrls());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
    if (e.key === "Escape") setInput("");
  };

  const handlePublishRelayList = async () => {
    setPublishing(true);
    try {
      await publishRelayList(getStoredRelayUrls());
      setPublishedAt(Date.now());
    } catch {
      // ignore — publishing failure is non-critical
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section>
      <h2 className="text-text text-[11px] font-medium uppercase tracking-widest mb-2 text-text-dim">Relays</h2>
      <div className="space-y-1 mb-3">
        {relays.length === 0 && (
          <p className="text-text-dim text-[12px] px-1">No relays configured.</p>
        )}
        {relays.map((url) => (
          <RelayRow key={url} url={url} onRemove={() => handleRemove(url)} />
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          placeholder="wss://relay.example.com"
          className="flex-1 bg-bg border border-border px-3 py-1.5 text-text text-[12px] font-mono focus:outline-none focus:border-accent/50 placeholder:text-text-dim"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-[11px] border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors shrink-0"
        >
          add
        </button>
      </div>
      {error && <p className="text-danger text-[11px] mt-1">{error}</p>}
      {loggedIn && !!getNDK().signer && (
        <div className="mt-3">
          <button
            onClick={handlePublishRelayList}
            disabled={publishing}
            className="text-[11px] px-3 py-1.5 border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {publishing ? "publishing…" : publishedAt ? "published ✓" : "publish relay list to Nostr"}
          </button>
          <p className="text-text-dim text-[10px] mt-1">
            Saves your relay list as a kind 10002 event (NIP-65) so other clients can find your notes.
          </p>
        </div>
      )}
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
        defaultPath: `wrystr-export-${new Date().toISOString().slice(0, 10)}.json`,
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

  const toggle = (key: "mentions" | "dms" | "zaps") => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    saveNotificationSettings(next);
    // Request permission on first enable
    if (next[key]) ensurePermission().catch(() => {});
  };

  const items: Array<{ key: "mentions" | "dms" | "zaps"; label: string }> = [
    { key: "mentions", label: "Mentions" },
    { key: "dms", label: "Direct messages" },
    { key: "zaps", label: "Zaps received" },
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
          <label key={key} className="flex items-center gap-2 cursor-pointer group">
            <button
              onClick={() => toggle(key)}
              className={`w-8 h-4 rounded-full transition-colors relative ${
                settings[key] ? "bg-accent" : "bg-border"
              }`}
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  settings[key] ? "translate-x-4" : "translate-x-0.5"
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

export function SettingsView() {
  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-4 py-2.5 shrink-0">
        <h1 className="text-text text-sm font-medium tracking-wide">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-8">
        <WalletSection />
        <NotificationSection />
        <RelaySection />
        <ExportSection />
        <IdentitySection />
        <MuteSection />
      </div>
    </div>
  );
}
