import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import pkg from "../../../package.json";
import { useUpdater } from "../../hooks/useUpdater";
import { renderMarkdown } from "../../lib/markdown";
import { copyText } from "../../lib/clipboard";
import { fetchNotesSince, panelBody, type ReleaseNotes } from "../../lib/releaseNotes";

type Notes =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; releases: ReleaseNotes[] }
  | { status: "failed" };

function plain(version: string): string {
  return version.replace(/^v/i, "");
}

export function UpdateBanner() {
  const { available, version, body, installing, error, canSelfUpdate, kind, install, dismiss } = useUpdater();
  const [copied, setCopied] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [notes, setNotes] = useState<Notes>({ status: "idle" });
  if (!available) return null;

  const aurCmd = "yay -S vega-nostr-git";
  const installed = pkg.version;

  // The notes are read from GitHub the first time the panel is opened, not at every start.
  const toggleChangelog = () => {
    setShowChangelog((v) => !v);
    if (notes.status !== "idle" || !version) return;
    setNotes({ status: "loading" });
    fetchNotesSince(installed, version).then((releases) => {
      setNotes(releases && releases.length > 0 ? { status: "loaded", releases } : { status: "failed" });
    });
  };

  // When GitHub cannot be read: the updater's own notes, if they have a section for the offered version.
  // They are the workflow's fixed text, whose newest section is v0.14.0, so that is rarely the case.
  const fallback = notes.status === "failed" && body && version ? panelBody(body, plain(version)) : "";

  return (
    <div className="bg-accent/10 border-b border-accent/30 text-ui shrink-0">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-text">
          Vega {version} is available.
          {!canSelfUpdate && kind === "pacman" && (
            <> Update with <code className="text-accent bg-bg-raised px-1 rounded-sm">{aurCmd}</code></>
          )}
          {error && <span className="text-danger ml-1">{error}</span>}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleChangelog}
            aria-expanded={showChangelog}
            className="text-accent hover:text-accent-hover transition-colors"
          >
            {showChangelog ? "Hide changes" : "What's new"}
          </button>
          {canSelfUpdate ? (
            <button
              onClick={install}
              disabled={installing}
              className="text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
            >
              {installing ? "Installing…" : "Update & restart"}
            </button>
          ) : kind === "pacman" ? (
            <button
              onClick={async () => { if (await copyText(aurCmd)) setCopied(true); }}
              className="text-accent hover:text-accent-hover transition-colors"
            >
              {copied ? "Copied" : "Copy command"}
            </button>
          ) : (
            <button
              onClick={() => openUrl("https://github.com/hoornet/vega/releases/latest").catch(() => {})}
              className="text-accent hover:text-accent-hover transition-colors"
            >
              View release
            </button>
          )}
          <button onClick={dismiss} aria-label="Dismiss update" className="text-text-dim hover:text-text transition-colors">×</button>
        </div>
      </div>

      {/* What's-new panel: the notes of every release since the installed one, newest first */}
      {showChangelog && (
        <div
          aria-busy={notes.status === "idle" || notes.status === "loading"}
          className="px-4 pb-3 pt-1 max-h-[calc(var(--window-h)*0.4)] overflow-y-auto border-t border-accent/20"
        >
          {notes.status === "idle" || notes.status === "loading" ? (
            <p className="text-text-muted mt-2">Loading what's new…</p>
          ) : notes.status === "loaded" ? (
            <>
              {notes.releases.length > 1 && (
                <p className="text-text-muted mt-2">
                  Everything since {installed}: {notes.releases.length} releases.
                </p>
              )}
              {notes.releases.map((release) => (
                <section key={release.version} className="mt-3">
                  <h2 className="text-body font-semibold text-text">
                    v{release.version}
                    {release.title && <span className="font-normal text-text-muted">: {release.title}</span>}
                  </h2>
                  {release.body ? (
                    <div className="prose-compact text-ui" dangerouslySetInnerHTML={{ __html: renderMarkdown(release.body) }} />
                  ) : (
                    <p className="text-text-muted mt-1">No notes for this version yet.</p>
                  )}
                </section>
              ))}
            </>
          ) : fallback ? (
            <div className="prose-compact text-ui" dangerouslySetInnerHTML={{ __html: renderMarkdown(fallback) }} />
          ) : (
            <p className="text-text-muted mt-2">The notes could not be loaded.</p>
          )}
          <button
            onClick={() => openUrl("https://github.com/hoornet/vega/releases").catch(() => {})}
            className="mt-3 text-accent hover:text-accent-hover transition-colors text-ui"
          >
            Full changelog on GitHub →
          </button>
        </div>
      )}
    </div>
  );
}
