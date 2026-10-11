import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { renderMarkdown } from "../../lib/markdown";
import { publishArticle } from "../../lib/nostr";
import { useUIStore } from "../../stores/ui";
import { useToastStore } from "../../stores/toast";
import { explainPublishError } from "../../lib/publishErrors";
import { useCanSign } from "../../stores/user";
import { MarkdownToolbar, handleEditorKeyDown } from "./MarkdownToolbar";
import { useDraftStore, type ArticleDraft } from "../../stores/drafts";
import { LoginModal } from "../shared/LoginModal";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { uploadBytes, uploadImage } from "../../lib/upload";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ViewHeader } from "../shared/ViewHeader";
import { Button } from "../shared/Button";
import { ArrowLeft, Check, Upload } from "lucide-react";
import { ImageLightbox } from "../shared/ImageLightbox";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";

/** Extract image URLs from markdown ![alt](url) patterns */
function extractImages(md: string): { alt: string; url: string }[] {
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images: { alt: string; url: string }[] = [];
  let m;
  while ((m = re.exec(md))) {
    images.push({ alt: m[1], url: m[2] });
  }
  return images;
}

function formatSavedAgo(elapsedMs: number): string {
  const s = Math.floor(elapsedMs / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function ArticleEditor() {
  const canSign = useCanSign();
  const { goBack } = useUIStore();
  const { activeDraftId, drafts, updateDraft, deleteDraft, setActiveDraft, createDraft } = useDraftStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

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

  // F11 toggles zen mode. Escape leaves it, through the same rule as
  // everything else that covers the window: if something is open over the
  // editor, that closes first, and the press never also goes back a view.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggleZen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleZen]);
  useEscapeToClose(toggleZen, zenMode);

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

  const renderedHtml = renderMarkdown(content || "*Nothing to preview yet.*");
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const canPublish = title.trim().length > 0 && content.trim().length > 0;
  const inlineImages = useMemo(() => extractImages(content), [content]);

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
      // Deleting the draft unmounts this editor (the drafts list takes its
      // place), so a confirmation rendered here is never seen. Say it in a
      // toast, which outlives the view. A publish that no relay accepted
      // does not reach this point: NDK throws, and the catch below keeps the
      // draft and shows why.
      useToastStore.getState().addToast(
        `Article published to ${result.relayCount} ${result.relayCount === 1 ? "relay" : "relays"}.`,
        "success",
        6000,
      );
      setPublished(true);
      setPublishedRelays(result.relayCount);
      if (activeDraftId) deleteDraft(activeDraftId);
      goBack();
    } catch (err) {
      setError(explainPublishError(err, "Your draft is safe."));
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

  const handleArticlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fileFromFiles = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (fileFromFiles) {
      e.preventDefault();
      setUploading(true);
      setError(null);
      try {
        const url = await uploadImage(fileFromFiles);
        const ta = textareaRef.current;
        if (ta) {
          const start = ta.selectionStart ?? content.length;
          const end = ta.selectionEnd ?? content.length;
          const md = `![image](${url})`;
          setContent(content.slice(0, start) + md + content.slice(end));
          setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + md.length; ta.focus(); }, 0);
        }
      } catch (err) {
        setError(`Image upload failed: ${err}`);
      } finally {
        setUploading(false);
      }
      return;
    }
    const items = Array.from(e.clipboardData.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        e.preventDefault();
        setUploading(true);
        setError(null);
        try {
          const url = await uploadImage(file);
          const ta = textareaRef.current;
          if (ta) {
            const start = ta.selectionStart ?? content.length;
            const end = ta.selectionEnd ?? content.length;
            const md = `![image](${url})`;
            setContent(content.slice(0, start) + md + content.slice(end));
            setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + md.length; ta.focus(); }, 0);
          }
        } catch (err) {
          setError(`Image upload failed: ${err}`);
        } finally {
          setUploading(false);
        }
      }
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
          className={`absolute top-3 left-1/2 -translate-x-1/2 text-text-dim text-caption transition-opacity duration-700 ${
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
            className="w-full bg-transparent text-text text-display font-bold placeholder:text-text-dim focus:outline-none mb-6"
            style={{ fontFamily: "var(--font-reading)" }}
          />
          <textarea
            ref={zenTextareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => handleEditorKeyDown(e, zenTextareaRef, content, setContent)}
            placeholder="Write…"
            className="w-full flex-1 bg-transparent text-text text-title leading-relaxed placeholder:text-text-dim resize-none focus:outline-none"
            style={{ fontFamily: "var(--font-reading)" }}
            autoFocus
          />
          <div className="text-text-dim text-caption pt-3 text-center">
            {wordCount > 0 ? `${wordCount} words` : ""}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      {/* Wraps: at Extra Large text in a small window the right-hand group ran off the edge. */}
      <header className="border-b border-border-subtle px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 shrink-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button variant="ghost" className="-ml-3" onClick={() => setActiveDraft(null)}><ArrowLeft />Drafts</Button>
          <span className="text-text-dim text-caption">{wordCount > 0 ? `${wordCount} words` : "New article"}</span>
          {activeDraft && !published && lastSaved && (
            <span className="text-text-dim text-caption">
              · saved {formatSavedAgo(Date.now() - lastSaved)}
            </span>
          )}
          {published && publishedRelays > 0 && (
            <span className="text-success text-caption">· published to {publishedRelays} {publishedRelays === 1 ? "relay" : "relays"}</span>
          )}
          {uploading && (
            <span className="inline-flex items-center gap-1 text-text-dim text-caption">
              <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
              uploading…
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
          {/* Write / Preview toggle */}
          <div className="flex border border-border text-ui rounded-sm overflow-hidden">
            <button
              onClick={() => setMode("write")}
              className={`px-3 py-1 transition-colors ${mode === "write" ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text"}`}
            >
              Write
            </button>
            <button
              onClick={() => setMode("preview")}
              className={`px-3 py-1 transition-colors ${mode === "preview" ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text"}`}
            >
              Preview
            </button>
          </div>

          <Button variant="ghost" onClick={toggleZen} title="Focus mode (F11)">Zen</Button>

          <Button variant="ghost" pressed={showMeta} onClick={() => setShowMeta((v) => !v)}>Meta</Button>

          {canSign ? (
            <Button variant="primary" onClick={handlePublish} disabled={!canPublish || published} busy={publishing}>
              {published && <Check />}{published ? "Published" : publishing ? "Publishing…" : "Publish"}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setShowLoginModal(true)}>Sign in to publish</Button>
          )}
        </div>
      </header>

      {/* Meta panel */}
      {showMeta && (
        <div className="border-b border-border-subtle px-6 py-3 bg-bg-raised grid grid-cols-2 gap-3 shrink-0">
          <div>
            <label className="text-text-dim text-caption block mb-1">Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="A short description…"
              rows={2}
              className="w-full bg-bg border border-border-strong px-2 py-1.5 text-text text-ui resize-none focus:outline-none focus:border-accent rounded-lg"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-text-dim text-caption block mb-1">Cover image</label>
              <div className="flex gap-1">
                <input
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="https://…"
                  className="flex-1 bg-bg border border-border-strong px-2 py-1.5 text-text text-ui focus:outline-none focus:border-accent rounded-lg"
                />
                <Button onClick={handleCoverImagePick} busy={uploading} title="Upload cover image" aria-label="Upload cover image"><Upload /></Button>
              </div>
            </div>
            <div>
              <label className="text-text-dim text-caption block mb-1">Tags (comma-separated)</label>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="bitcoin, nostr, essay"
                className="w-full bg-bg border border-border-strong px-2 py-1.5 text-text text-ui focus:outline-none focus:border-accent rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="px-6 py-2 text-danger text-body bg-danger/5 border-b border-border-subtle shrink-0">
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
            className="w-full bg-transparent text-text text-display font-bold placeholder:text-text-dim focus:outline-none focus:border-b focus:border-accent"
            style={{ fontFamily: "var(--font-reading)" }}
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

        {/* Inline image previews (write mode only) */}
        {mode === "write" && inlineImages.length > 0 && (
          <div className="flex items-center gap-2 px-6 py-2 border-b border-border-subtle bg-bg-raised/50 overflow-x-auto shrink-0">
            <span className="text-text-dim text-caption shrink-0">{inlineImages.length} {inlineImages.length === 1 ? "image" : "images"}</span>
            {inlineImages.map((img, i) => (
              <div key={i} className="relative shrink-0 group cursor-zoom-in" onClick={() => setLightboxUrl(img.url)}>
                <img
                  src={img.url}
                  alt={img.alt}
                  className="h-12 w-auto rounded-sm border border-border object-cover group-hover:border-accent transition-colors"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Lightbox */}
        {lightboxUrl && <ImageLightbox images={[lightboxUrl]} index={0} onClose={() => setLightboxUrl(null)} onNavigate={() => {}} />}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {mode === "write" ? (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => handleEditorKeyDown(e, textareaRef, content, setContent)}
              onPaste={handleArticlePaste}
              onDrop={async (e) => {
                const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
                if (!file) return;
                e.preventDefault();
                e.stopPropagation();
                setUploading(true);
                setError(null);
                try {
                  const url = await uploadImage(file);
                  const ta = textareaRef.current;
                  if (ta) {
                    const start = ta.selectionStart ?? content.length;
                    const end = ta.selectionEnd ?? content.length;
                    const md = `![image](${url})`;
                    setContent(content.slice(0, start) + md + content.slice(end));
                  }
                } catch (err) {
                  setError(`Image upload failed: ${err}`);
                } finally {
                  setUploading(false);
                }
              }}
              onDragOver={(e) => {
                if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
              }}
              placeholder="Write your article in Markdown… (paste or drop images)"
              className="w-full h-full min-h-[400px] bg-transparent text-text text-body leading-relaxed placeholder:text-text-dim resize-none focus:outline-none focus:border-b focus:border-accent font-mono"
            />
          ) : (
            <div
              className="article-preview"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          )}
        </div>
      </div>
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
    </div>
  );
}

/** Draft list view — shown when no active draft is selected */
function DraftListView({ onNewDraft }: { onNewDraft: () => void }) {
  const { drafts, deleteDraft, setActiveDraft } = useDraftStore();

  return (
    <div className="h-full flex flex-col">
      {/* Opened from the sidebar's "Write Article": that is its title, and
          a view opened from the sidebar has no Back. */}
      <ViewHeader
        title="Write Article"
        meta={`${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"}`}
        actions={
          <Button variant="primary" onClick={onNewDraft}>New draft</Button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {drafts.length === 0 && (
          <div className="px-4 py-12 text-center space-y-2">
            <p className="text-text-dim text-body">No drafts yet.</p>
            <p className="text-text-dim text-caption">
              Click "New draft" to start writing an article.
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
              className="border-b border-border-subtle px-4 py-3 hover:bg-bg-hover transition-colors cursor-pointer flex items-center justify-between"
              onClick={() => setActiveDraft(draft.id)}
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-text text-body font-medium truncate">
                  {draft.title || "Untitled"}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-text-dim text-caption">{wordCount} words</span>
                  <span className="text-text-dim text-caption">{updated}</span>
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
