import { useState, useEffect } from "react";
import { marked } from "marked";
import { publishArticle } from "../../lib/nostr";
import { useUIStore } from "../../stores/ui";

const DRAFT_KEY = "wrystr_article_draft";

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); }
  catch { return null; }
}

function saveDraft(data: object) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

export function ArticleEditor() {
  const { goBack } = useUIStore();
  const draft = loadDraft();

  const [title, setTitle] = useState(draft?.title || "");
  const [content, setContent] = useState(draft?.content || "");
  const [summary, setSummary] = useState(draft?.summary || "");
  const [image, setImage] = useState(draft?.image || "");
  const [tags, setTags] = useState(draft?.tags || "");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [showMeta, setShowMeta] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  // Auto-save draft
  useEffect(() => {
    const t = setTimeout(() => {
      saveDraft({ title, content, summary, image, tags });
    }, 1000);
    return () => clearTimeout(t);
  }, [title, content, summary, image, tags]);

  const renderedHtml = marked(content || "*Nothing to preview yet.*") as string;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const canPublish = title.trim().length > 0 && content.trim().length > 0;

  const handlePublish = async () => {
    if (!canPublish || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      await publishArticle({
        title: title.trim(),
        content: content.trim(),
        summary: summary.trim() || undefined,
        image: image.trim() || undefined,
        tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean),
      });
      clearDraft();
      setPublished(true);
      setTimeout(goBack, 1500);
    } catch (err) {
      setError(`Failed to publish: ${err}`);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="text-text-dim hover:text-text text-[11px] transition-colors">
            ← back
          </button>
          <span className="text-text-dim text-[10px]">{wordCount > 0 ? `${wordCount} words` : "New article"}</span>
          {draft && !published && (
            <span className="text-text-dim text-[10px]">· draft saved</span>
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
              <label className="text-text-dim text-[10px] block mb-1">Cover image URL</label>
              <input
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="https://…"
                className="w-full bg-bg border border-border px-2 py-1.5 text-text text-[12px] focus:outline-none focus:border-accent/50"
              />
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

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {mode === "write" ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
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
