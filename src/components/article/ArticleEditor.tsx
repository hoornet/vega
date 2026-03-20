import { useState, useEffect, useRef, useCallback } from "react";
import { marked } from "marked";
import { publishArticle } from "../../lib/nostr";
import { useUIStore } from "../../stores/ui";
import { MarkdownToolbar, handleEditorKeyDown } from "./MarkdownToolbar";
import { useDraftStore, type ArticleDraft } from "../../stores/drafts";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { uploadBytes } from "../../lib/upload";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function ArticleEditor() {
  const { goBack } = useUIStore();
  const { activeDraftId, drafts, updateDraft, deleteDraft, setActiveDraft, createDraft } = useDraftStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // If no active draft, show draft list
  const activeDraft = activeDraftId ? drafts.find((d) => d.id === activeDraftId) : null;

  const [title, setTitle] = useState(activeDraft?.title || "");
  const [content, setContent] = useState(activeDraft?.content || "");
  const [summary, setSummary] = useState(activeDraft?.summary || "");
  const [image, setImage] = useState(activeDraft?.image || "");
  const [tags, setTags] = useState(activeDraft?.tags || "");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [showMeta, setShowMeta] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [publishedRelays, setPublishedRelays] = useState(0);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [zenMode, setZenMode] = useState(false);
  const [zenHint, setZenHint] = useState(false);
  const zenTextareaRef = useRef<HTMLTextAreaElement>(null);

  const toggleZen = useCallback(async () => {
    const win = getCurrentWindow();
    if (zenMode) {
      await win.setFullscreen(false);
      setZenMode(false);
    } else {
      await win.setFullscreen(true);
      setZenMode(true);
      setZenHint(true);
      setTimeout(() => setZenHint(false), 2500);
    }
  }, [zenMode]);

  // F11 to toggle zen mode, Esc to exit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggleZen();
      }
      if (e.key === "Escape" && zenMode) {
        toggleZen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleZen, zenMode]);

  // Exit fullscreen on unmount
  useEffect(() => {
    return () => {
      getCurrentWindow().setFullscreen(false).catch(() => {});
    };
  }, []);

  // Sync state when active draft changes
  useEffect(() => {
    if (activeDraft) {
      setTitle(activeDraft.title);
      setContent(activeDraft.content);
      setSummary(activeDraft.summary);
      setImage(activeDraft.image);
      setTags(activeDraft.tags);
      setPublished(false);
      setError(null);
    }
  }, [activeDraftId]);

  // Auto-save to draft store
  useEffect(() => {
    if (!activeDraftId) return;
    const t = setTimeout(() => {
      updateDraft(activeDraftId, { title, content, summary, image, tags });
      setLastSaved(Date.now());
    }, 1000);
    return () => clearTimeout(t);
  }, [title, content, summary, image, tags, activeDraftId]);

  // Update "saved Xs ago" display every 10s
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSaved) return;
    const iv = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(iv);
  }, [lastSaved]);

  const renderedHtml = marked(content || "*Nothing to preview yet.*") as string;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const canPublish = title.trim().length > 0 && content.trim().length > 0;

  const handlePublish = async () => {
    if (!canPublish || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const result = await publishArticle({
        title: title.trim(),
        content: content.trim(),
        summary: summary.trim() || undefined,
        image: image.trim() || undefined,
        tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean),
      });
      if (activeDraftId) deleteDraft(activeDraftId);
      setPublished(true);
      setPublishedRelays(result.relayCount);
      if (result.relayCount === 0) {
        setError("Warning: no relays confirmed — your article may not have been published.");
      }
      setTimeout(goBack, 2000);
    } catch (err) {
      setError(`Failed to publish: ${err}`);
    } finally {
      setPublishing(false);
    }
  };

  const handleNewDraft = () => {
    const id = createDraft();
    setActiveDraft(id);
  };

  const handleCoverImagePick = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }],
      });
      if (!selected) return;
      setUploading(true);
      setError(null);
      try {
        const filePath = typeof selected === "string" ? selected : selected;
        const bytes = await readFile(filePath);
        const fileName = filePath.split(/[\\/]/).pop() || "cover.jpg";
        const ext = fileName.split(".").pop()?.toLowerCase() || "jpg";
        const mimeMap: Record<string, string> = {
          jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
        };
        const url = await uploadBytes(new Uint8Array(bytes), fileName, mimeMap[ext] || "image/jpeg");
        setImage(url);
      } finally {
        setUploading(false);
      }
    } catch (err) {
      setError(`Cover upload failed: ${err}`);
    }
  };

  // If no active draft, show the draft list
  if (!activeDraftId) {
    return <DraftListView onNewDraft={handleNewDraft} />;
  }

  // Zen mode — fullscreen distraction-free writing
  if (zenMode) {
    return (
      <div className="fixed inset-0 z-50 bg-bg flex flex-col items-center">
        {/* Exit hint — fades after 2.5s */}
        <div
          className={`absolute top-3 left-1/2 -translate-x-1/2 text-text-dim text-[10px] transition-opacity duration-700 ${
            zenHint ? "opacity-100" : "opacity-0"
          }`}
        >
          Esc or F11 to exit
        </div>

        <div className="w-full max-w-2xl flex-1 flex flex-col px-6 py-12">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full bg-transparent text-text text-3xl font-bold placeholder:text-text-dim focus:outline-none mb-6"
            style={{ fontFamily: "var(--font-reading)" }}
          />
          <textarea
            ref={zenTextareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => handleEditorKeyDown(e, zenTextareaRef, content, setContent)}
            placeholder="Write…"
            className="w-full flex-1 bg-transparent text-text text-[17px] leading-relaxed placeholder:text-text-dim resize-none focus:outline-none"
            style={{ fontFamily: "var(--font-reading)" }}
            autoFocus
          />
          <div className="text-text-dim text-[10px] pt-3 text-center">
            {wordCount > 0 ? `${wordCount} words` : ""}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveDraft(null)} className="text-text-dim hover:text-text text-[11px] transition-colors">
            ← drafts
          </button>
          <span className="text-text-dim text-[10px]">{wordCount > 0 ? `${wordCount} words` : "New article"}</span>
          {activeDraft && !published && lastSaved && (
            <span className="text-text-dim text-[10px]">
              · saved {Math.floor((Date.now() - lastSaved) / 1000) < 5 ? "just now" : `${Math.floor((Date.now() - lastSaved) / 1000)}s ago`}
            </span>
          )}
          {published && publishedRelays > 0 && (
            <span className="text-success text-[10px]">· published to {publishedRelays} {publishedRelays === 1 ? "relay" : "relays"}</span>
          )}
          {uploading && (
            <span className="inline-flex items-center gap-1 text-text-dim text-[10px]">
              <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
              uploading…
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Write / Preview toggle */}
          <div className="flex border border-border text-[11px]">
            <button
              onClick={() => setMode("write")}
              className={`px-3 py-1 transition-colors ${mode === "write" ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text"}`}
            >
              write
            </button>
            <button
              onClick={() => setMode("preview")}
              className={`px-3 py-1 transition-colors ${mode === "preview" ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text"}`}
            >
              preview
            </button>
          </div>

          <button
            onClick={toggleZen}
            className="px-3 py-1 text-[11px] border border-border text-text-muted hover:text-text transition-colors"
            title="Focus mode (F11)"
          >
            zen
          </button>

          <button
            onClick={() => setShowMeta((v) => !v)}
            className={`px-3 py-1 text-[11px] border border-border transition-colors ${showMeta ? "text-accent border-accent/40" : "text-text-muted hover:text-text"}`}
          >
            meta
          </button>

          <button
            onClick={handlePublish}
            disabled={!canPublish || publishing || published}
            className="px-4 py-1 text-[11px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {published ? "published ✓" : publishing ? "publishing…" : "publish"}
          </button>
        </div>
      </header>

      {/* Meta panel */}
      {showMeta && (
        <div className="border-b border-border px-6 py-3 bg-bg-raised grid grid-cols-2 gap-3 shrink-0">
          <div>
            <label className="text-text-dim text-[10px] block mb-1">Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="A short description…"
              rows={2}
              className="w-full bg-bg border border-border px-2 py-1.5 text-text text-[12px] resize-none focus:outline-none focus:border-accent/50"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-text-dim text-[10px] block mb-1">Cover image</label>
              <div className="flex gap-1">
                <input
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="https://…"
                  className="flex-1 bg-bg border border-border px-2 py-1.5 text-text text-[12px] focus:outline-none focus:border-accent/50"
                />
                <button
                  onClick={handleCoverImagePick}
                  disabled={uploading}
                  title="Upload cover image"
                  className="px-2 py-1.5 text-[11px] border border-border text-text-muted hover:text-text hover:bg-bg-hover transition-colors disabled:opacity-30"
                >
                  {uploading ? "…" : "↑"}
                </button>
              </div>
            </div>
            <div>
              <label className="text-text-dim text-[10px] block mb-1">Tags (comma-separated)</label>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="bitcoin, nostr, essay"
                className="w-full bg-bg border border-border px-2 py-1.5 text-text text-[12px] focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="px-6 py-2 text-danger text-[12px] bg-danger/5 border-b border-border shrink-0">
          {error}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden flex flex-col article-editor">
        {/* Title */}
        <div className="px-6 pt-6 pb-2 shrink-0">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full bg-transparent text-text text-2xl font-bold placeholder:text-text-dim focus:outline-none"
          />
        </div>

        {/* Markdown toolbar */}
        {mode === "write" && (
          <MarkdownToolbar
            textareaRef={textareaRef}
            content={content}
            setContent={setContent}
            setUploading={setUploading}
            setError={setError}
          />
        )}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {mode === "write" ? (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => handleEditorKeyDown(e, textareaRef, content, setContent)}
              placeholder="Write your article in Markdown…"
              className="w-full h-full min-h-[400px] bg-transparent text-text text-[14px] leading-relaxed placeholder:text-text-dim resize-none focus:outline-none font-mono"
            />
          ) : (
            <div
              className="article-preview text-[14px]"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Draft list view — shown when no active draft is selected */
function DraftListView({ onNewDraft }: { onNewDraft: () => void }) {
  const { goBack } = useUIStore();
  const { drafts, deleteDraft, setActiveDraft } = useDraftStore();

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="text-text-dim hover:text-text text-[11px] transition-colors">
            ← back
          </button>
          <h2 className="text-text text-[13px] font-medium">Drafts</h2>
          <span className="text-text-dim text-[11px]">{drafts.length} {drafts.length === 1 ? "draft" : "drafts"}</span>
        </div>
        <button
          onClick={onNewDraft}
          className="px-3 py-1 text-[11px] bg-accent hover:bg-accent-hover text-white transition-colors"
        >
          new draft
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {drafts.length === 0 && (
          <div className="px-4 py-12 text-center space-y-2">
            <p className="text-text-dim text-[13px]">No drafts yet.</p>
            <p className="text-text-dim text-[11px] opacity-60">
              Click "new draft" to start writing an article.
            </p>
          </div>
        )}

        {drafts.map((draft: ArticleDraft) => {
          const wordCount = draft.content.trim() ? draft.content.trim().split(/\s+/).length : 0;
          const updated = new Date(draft.updatedAt).toLocaleDateString(undefined, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          });
          return (
            <div
              key={draft.id}
              className="border-b border-border px-4 py-3 hover:bg-bg-hover transition-colors cursor-pointer flex items-center justify-between"
              onClick={() => setActiveDraft(draft.id)}
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-text text-[13px] font-medium truncate">
                  {draft.title || "Untitled"}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-text-dim text-[11px]">{wordCount} words</span>
                  <span className="text-text-dim text-[10px]">{updated}</span>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteDraft(draft.id); }}
                className="text-text-dim hover:text-danger text-[11px] transition-colors px-2"
                title="Delete draft"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
