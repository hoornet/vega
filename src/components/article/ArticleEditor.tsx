import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import { publishArticle, previewArticleEvent, type ArticleFields } from "../../lib/nostr";
import { useUIStore } from "../../stores/ui";
import { useToastStore } from "../../stores/toast";
import { explainPublishError } from "../../lib/publishErrors";
import { useCanSign, useUserStore } from "../../stores/user";
import { MarkdownToolbar, handleEditorKeyDown, insertAtCaret } from "./MarkdownToolbar";
import { useDraftStore, isEmptyDraft, type ArticleDraft, type DraftFields } from "../../stores/drafts";
import { LoginModal } from "../shared/LoginModal";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { uploadBytes, uploadImage } from "../../lib/upload";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ViewHeader } from "../shared/ViewHeader";
import { Button } from "../shared/Button";
import { Dialog } from "../shared/Dialog";
import { ArrowLeft, Trash2, Upload } from "lucide-react";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import { MODAL_SELECTOR } from "../../lib/escapeKey";
import { ArticleBody } from "./ArticleBody";
import { ArticleCard } from "./ArticleCard";
import { articleNaddr, cardSummary, plainWords, readingMinutes } from "../../lib/article";
import { timeAgo } from "../../lib/utils";

// The article editor, rebuilt after the October 2026 UI review. It was a form:
// 14px monospace across the full window, a toolbar strip between the title
// and the body, summary and cover behind a button called "Meta", and Publish
// that fired on one click with no review and no visible confirmation (the
// draft was deleted, which swapped the editor for the drafts list). It is now
// a page on the reader's own surface (index.css `.reader-page` / `.reader`),
// the toolbar above the title, Preview through the reader's component, and a
// publish sheet with the card as readers will see it.

const MONO_KEY = "wrystr_editor_mono";

function formatSavedAgo(elapsedMs: number): string {
  const s = Math.floor(elapsedMs / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

const EMPTY: DraftFields = { title: "", content: "", summary: "", image: "", tags: "" };
const splitTags = (tags: string) => tags.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean);

export function ArticleEditor() {
  const { activeDraftId, drafts, createDraft, setActiveDraft, pruneEmptyDrafts } = useDraftStore();
  const activeDraft = activeDraftId ? drafts.find((d) => d.id === activeDraftId) ?? null : null;
  // With nothing written yet there is no list to show: a first-time writer
  // got "No drafts yet." with the action in the far corner. The page comes
  // first, and a draft exists once something is typed into it.
  const [wantList, setWantList] = useState(() => !activeDraftId && drafts.length > 0);

  // Empty drafts are dropped when the editor is left: "New draft" used to
  // persist one at once, so the sidebar counted a draft before a word was typed.
  useEffect(() => () => pruneEmptyDrafts(), [pruneEmptyDrafts]);

  if (!activeDraft && wantList && drafts.length > 0) {
    return <DraftListView onNewDraft={() => { createDraft(); setWantList(false); }} onOpen={(id) => { setActiveDraft(id); setWantList(false); }} />;
  }
  // "Drafts" leads to the list, so it is offered only when the list would have something in it.
  const hasDrafts = drafts.some((d) => !isEmptyDraft(d));
  return <DraftEditor draft={activeDraft} onDrafts={hasDrafts ? () => { pruneEmptyDrafts(); setActiveDraft(null); setWantList(true); } : undefined} />;
}

function DraftEditor({ draft, onDrafts }: { draft: ArticleDraft | null; onDrafts?: () => void }) {
  const canSign = useCanSign();
  const own = useUserStore((s) => s.pubkey) ?? "";
  const { openArticle } = useUIStore();
  const { deleteDraft } = useDraftStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [fields, setFields] = useState<DraftFields>(() => (draft ? { title: draft.title, content: draft.content, summary: draft.summary, image: draft.image, tags: draft.tags } : EMPTY));
  const { title, content, summary, image, tags } = fields;
  const setField = (name: keyof DraftFields) => (value: string) => setFields((f) => ({ ...f, [name]: value }));
  const setContent = useCallback((value: string) => setFields((f) => ({ ...f, content: value })), []);

  const [mode, setMode] = useState<"write" | "preview">("write");
  const [mono, setMono] = useState(() => localStorage.getItem(MONO_KEY) === "true");
  const [sheet, setSheet] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [zenMode, setZenMode] = useState(false);
  const [zenHint, setZenHint] = useState(false);

  const toggleMono = () => { setMono((m) => { localStorage.setItem(MONO_KEY, String(!m)); return !m; }); };

  // Full screen is the window's to give; outside Tauri (the browser dev build) there is no window, and Zen only hides the chrome.
  const fullscreen = (on: boolean) => { try { return getCurrentWindow().setFullscreen(on).catch(() => {}); } catch { return Promise.resolve(); } };
  const toggleZen = useCallback(async () => {
    if (zenMode) {
      await fullscreen(false);
      setZenMode(false);
    } else {
      await fullscreen(true);
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
      // Not while a dialog (the publish sheet, sign-in) is open over the editor.
      if (e.key === "F11" && !document.querySelector(MODAL_SELECTOR)) { e.preventDefault(); void toggleZen(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleZen]);
  useEscapeToClose(toggleZen, zenMode);
  useEffect(() => () => { void fullscreen(false); }, []);

  // The draft this editor writes to. None until something is typed; then one
  // is made and kept, so switching to it must not reload the fields. When the
  // draft is gone (pruned, deleted from the list) the id goes with it, or
  // every save would update a draft that no longer exists while the status
  // said "saved just now".
  const draftId = useRef<string | null>(draft?.id ?? null);
  useEffect(() => {
    if (!draft) { draftId.current = null; return; }
    if (draft.id === draftId.current) return;
    draftId.current = draft.id;
    setFields({ title: draft.title, content: draft.content, summary: draft.summary, image: draft.image, tags: draft.tags });
    setError(null);
  }, [draft]);

  // Save what is in the fields now: to the draft if it still exists, else as a
  // new draft when there is anything to keep. Not after a publish: the draft
  // was deleted on purpose, and the article is on the relays.
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const finished = useRef(false);
  const save = useCallback(() => {
    if (finished.current) return;
    const f = fieldsRef.current;
    const store = useDraftStore.getState();
    const id = draftId.current;
    if (id && store.drafts.some((d) => d.id === id)) store.updateDraft(id, f);
    else if (!isEmptyDraft(f)) draftId.current = store.createDraft(f);
    else { draftId.current = null; return; }
    setLastSaved(Date.now());
  }, []);
  // A second after the last change, and when the editor is left, so the last
  // second of typing is not lost to Drafts, Back or the sidebar.
  useEffect(() => {
    const t = setTimeout(save, 1000);
    return () => clearTimeout(t);
  }, [fields, save]);
  useEffect(() => () => save(), [save]);

  // Update "saved Xs ago" every 10s
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSaved) return;
    const iv = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(iv);
  }, [lastSaved]);

  // The title and the body grow with their text; the page scrolls, as the
  // reader does. Measuring means collapsing the box first, which lets the
  // pane's scroll position fall: a writer at the end of a long article was
  // thrown to the top on every keystroke. The position is put back.
  const grow = useCallback(() => {
    const ta = textareaRef.current;
    const pane = ta?.closest(".overflow-y-auto") as HTMLElement | null;
    const top = pane?.scrollTop ?? 0;
    for (const [el, min] of [[titleRef.current, 0], [ta, 384]] as const) {
      if (!el) continue;
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, min)}px`;
    }
    if (pane) pane.scrollTop = top;
  }, []);
  useEffect(grow, [grow, title, content, mode, mono, zenMode]);
  // And again when the column changes width or the reading face arrives: the measure is fluid.
  useEffect(() => {
    const el = textareaRef.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => grow());
    ro.observe(el);
    document.fonts?.ready.then(grow).catch(() => {});
    return () => ro.disconnect();
  }, [grow, mode]);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const canPublish = title.trim().length > 0 && content.trim().length > 0;
  const editing = !!draft?.dTag;

  // The summary is what the card shows, so an article never goes out without
  // one: the start of the body stands in when the writer gave none. Shown in
  // the sheet as the field's placeholder, not written into it.
  const derivedSummary = cardSummary("", content, title);
  const publishFields = (): ArticleFields => ({
    title: title.trim(), content: content.trim(), summary: summary.trim() || derivedSummary || undefined, image: image.trim() || undefined,
    tags: splitTags(tags), dTag: draft?.dTag, publishedAt: draft?.publishedAt,
  });

  const handlePublish = async () => {
    if (!canPublish || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const result = await publishArticle(publishFields());
      // The article is open before the draft goes: deleting the draft first
      // swapped the editor for the drafts list, and "Published" was never seen.
      useToastStore.getState().addToast(
        `${editing ? "Update" : "Article"} published to ${result.relayCount} ${result.relayCount === 1 ? "relay" : "relays"}.`,
        "success",
        6000,
      );
      finished.current = true;
      setSheet(false);
      openArticle(articleNaddr(result.event), result.event);
      if (draftId.current) deleteDraft(draftId.current);
    } catch (err) {
      setError(explainPublishError(err, "Your draft is safe."));
    } finally {
      setPublishing(false);
    }
  };

  const insertImage = (url: string) => {
    const ta = textareaRef.current;
    if (ta) insertAtCaret(ta, `![image](${url})`, setContent);
    else setFields((f) => ({ ...f, content: `${f.content}\n\n![image](${url})` }));
  };
  const uploadAndInsert = async (file: File) => {
    setUploading(true);
    setError(null);
    try { insertImage(await uploadImage(file)); }
    catch (err) { setError(`Image upload failed: ${err}`); }
    finally { setUploading(false); }
  };

  const handleCoverImagePick = async () => {
    try {
      const selected = await open({ multiple: false, filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }] });
      if (!selected) return;
      setUploading(true);
      setError(null);
      try {
        const filePath = typeof selected === "string" ? selected : selected;
        const bytes = await readFile(filePath);
        const fileName = filePath.split(/[\\/]/).pop() || "cover.jpg";
        const ext = fileName.split(".").pop()?.toLowerCase() || "jpg";
        const mime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
        setField("image")(await uploadBytes(new Uint8Array(bytes), fileName, mime[ext] || "image/jpeg"));
      } finally {
        setUploading(false);
      }
    } catch (err) {
      setError(`Cover upload failed: ${err}`);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"))
      ?? Array.from(e.clipboardData.items ?? []).find((item) => item.type.startsWith("image/"))?.getAsFile();
    if (!file) return;
    e.preventDefault();
    void uploadAndInsert(file);
  };
  const handleDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    void uploadAndInsert(file);
  };

  const openSheet = () => { setError(null); setSheet(true); };
  const toDrafts = () => { save(); onDrafts?.(); };

  const status = (
    <span className="text-text-muted text-caption">
      {editing ? "Editing a published article" : wordCount > 0 ? `${wordCount} words` : "New article"}
      {lastSaved && <> · saved {formatSavedAgo(Date.now() - lastSaved)}</>}
      {uploading && <> · <span className="inline-block w-3 h-3 align-middle border border-accent border-t-transparent rounded-full animate-spin" /> uploading…</>}
    </span>
  );

  return (
    <div className={zenMode ? "fixed inset-0 z-50 bg-bg flex flex-col" : "h-full flex flex-col"}>
      {zenMode ? (
        <div className={`absolute top-3 left-1/2 -translate-x-1/2 text-text-muted text-caption transition-opacity duration-700 ${zenHint ? "opacity-100" : "opacity-0"}`}>
          Esc or F11 to exit
        </div>
      ) : (
        // Wraps: at Extra Large text in a small window the right-hand group ran off the edge.
        <header className="border-b border-border-subtle px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 shrink-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {onDrafts && <Button variant="ghost" className="-ml-3" onClick={toDrafts}><ArrowLeft />Drafts</Button>}
            {status}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
            <div className="flex border border-border text-ui rounded-sm overflow-hidden" role="group" aria-label="Write or preview">
              <button type="button" onClick={() => setMode("write")} aria-pressed={mode === "write"} className={`px-3 py-1 transition-colors ${mode === "write" ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text"}`}>Write</button>
              <button type="button" onClick={() => setMode("preview")} aria-pressed={mode === "preview"} className={`px-3 py-1 transition-colors ${mode === "preview" ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text"}`}>Preview</button>
            </div>
            {mode === "write" && <Button variant="ghost" pressed={mono} onClick={toggleMono} title="Write in a monospace face">Mono</Button>}
            <Button variant="ghost" onClick={() => void toggleZen()} title="Focus mode (F11)">Zen</Button>
            <Button variant="ghost" onClick={openSheet}>Details</Button>
            {canSign ? (
              <Button variant="primary" onClick={openSheet} disabled={!canPublish}>{editing ? "Publish update" : "Publish"}</Button>
            ) : (
              <Button variant="primary" onClick={() => setShowLoginModal(true)}>Sign in to publish</Button>
            )}
          </div>
        </header>
      )}

      {error && !sheet && (
        <div role="alert" className="px-6 py-2 text-danger text-body bg-danger/5 border-b border-border-subtle shrink-0">{error}</div>
      )}

      {/* The page: the reader's surface, for writing */}
      <div className="flex-1 overflow-y-auto article-editor">
        <div className="reader-page">
          {mode === "write" ? (
            <div className="reader">
              <MarkdownToolbar textareaRef={textareaRef} setContent={setContent} setUploading={setUploading} setError={setError} />
              <textarea
                ref={titleRef}
                value={title}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setField("title")(e.target.value.replace(/\r?\n/g, " "))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); textareaRef.current?.focus(); } }}
                placeholder="Title"
                aria-label="Title"
                rows={1}
                className="reader-title w-full bg-transparent placeholder:text-text-dim focus:outline-none resize-none overflow-hidden mt-4"
              />
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => handleEditorKeyDown(e, textareaRef, setContent)}
                onPaste={handlePaste}
                onDrop={handleDrop}
                onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); }}
                placeholder="Tell your story…"
                aria-label="Body"
                className={`reader-field w-full min-h-96 mt-6 bg-transparent text-text placeholder:text-text-dim resize-none focus:outline-none overflow-hidden ${mono ? "font-mono text-ui" : "font-reading"}`}
              />
              {zenMode && <div className="text-text-muted text-caption pt-3 text-center">{wordCount > 0 ? `${wordCount} words` : ""}</div>}
            </div>
          ) : (
            // Inert: the byline and the pictures are the reader's controls, and a click on your own name would leave the editor.
            <article className="reader" inert>
              <ArticleBody title={title} summary={summary} image={image} pubkey={own} publishedAt={draft?.publishedAt ?? Math.floor(Date.now() / 1000)} content={content || "*Nothing to preview yet.*"} />
            </article>
          )}
        </div>
      </div>

      {sheet && (
        <PublishSheet
          fields={fields}
          derivedSummary={derivedSummary}
          own={own}
          editing={editing}
          canSign={canSign}
          canPublish={canPublish}
          publishing={publishing}
          uploading={uploading}
          error={error}
          onChange={(name, value) => setField(name)(value)}
          onPickCover={() => void handleCoverImagePick()}
          onPublish={() => void handlePublish()}
          onSignIn={() => { setSheet(false); setShowLoginModal(true); }}
          onClose={() => setSheet(false)}
        />
      )}
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
    </div>
  );
}

interface SheetProps {
  fields: DraftFields;
  /** The summary the body gives when the writer gave none. */
  derivedSummary: string;
  own: string;
  editing: boolean;
  canSign: boolean;
  canPublish: boolean;
  publishing: boolean;
  uploading: boolean;
  error: string | null;
  onChange: (name: keyof DraftFields, value: string) => void;
  onPickCover: () => void;
  onPublish: () => void;
  onSignIn: () => void;
  onClose: () => void;
}

/**
 * The step before publishing: the card as readers will see it, live, over the
 * fields that make it (summary, cover, tags), and one button. Publish used to
 * fire on a single click, with these fields behind a button called "Meta", so
 * first articles went out with no summary and no cover.
 */
/** A cover address worth asking for: typing one feeds "h", "ht", "htt" to the card otherwise. */
const looksLikeUrl = (s: string) => /^https?:\/\/[^\s/]+\.[^\s]+$/.test(s.trim());

function PublishSheet({ fields, derivedSummary, own, editing, canSign, canPublish, publishing, uploading, error, onChange, onPickCover, onPublish, onSignIn, onClose }: SheetProps) {
  const preview = useMemo(() => previewArticleEvent({
    title: fields.title.trim() || "Untitled", content: fields.content, summary: fields.summary.trim() || undefined,
    image: looksLikeUrl(fields.image) ? fields.image.trim() : undefined, tags: splitTags(fields.tags),
  }, own), [fields, own]);
  const chips = splitTags(fields.tags);
  // Read-only while the article is on its way: an edit made then was lost with the draft.
  const field = `w-full bg-bg border border-border-strong px-3 py-2 text-text text-ui rounded-lg focus:outline-none focus:border-accent placeholder:text-text-dim ${publishing ? "opacity-70" : ""}`;

  return (
    <Dialog title={editing ? "Publish update" : "Publish"} size="lg" onClose={onClose} closeOnBackdrop={!publishing}>
      <div className="p-4 space-y-4">
        <div>
          <p className="text-caption text-text-muted mb-1">How it will look in Articles</p>
          <div className="rounded-lg border border-border bg-bg overflow-hidden" inert>
            <ArticleCard event={preview} showAuthor={false} preview />
          </div>
        </div>
        <div>
          <label htmlFor="publish-summary" className="text-ui text-text block mb-1">Summary</label>
          <textarea id="publish-summary" value={fields.summary} onChange={(e) => onChange("summary", e.target.value)} rows={3} placeholder={derivedSummary || "Two lines that say what this is."} disabled={publishing} className={`${field} resize-none`} />
          {!fields.summary.trim() && derivedSummary && <p className="text-caption text-text-muted mt-1">Left empty, the start of the body is used.</p>}
        </div>
        <div>
          <label htmlFor="publish-cover" className="text-ui text-text block mb-1">Cover image</label>
          <div className="flex gap-2">
            <input id="publish-cover" value={fields.image} onChange={(e) => onChange("image", e.target.value)} placeholder="https://…" disabled={publishing} className={field} />
            <Button onClick={onPickCover} busy={uploading} disabled={publishing} aria-label="Upload a cover image" title="Upload"><Upload />Upload</Button>
          </div>
        </div>
        <div>
          <label htmlFor="publish-tags" className="text-ui text-text block mb-1">Tags</label>
          <input id="publish-tags" value={fields.tags} onChange={(e) => onChange("tags", e.target.value)} placeholder="bitcoin, nostr, essay" disabled={publishing} className={field} />
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-caption text-text-muted" aria-hidden>
              {chips.map((t) => <span key={t}>#{t}</span>)}
            </div>
          )}
        </div>
        {error && <div role="alert" className="text-danger text-body">{error}</div>}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Save details</Button>
          {canSign ? (
            <Button variant="primary" onClick={onPublish} disabled={!canPublish && !publishing} busy={publishing}>{editing ? "Publish update" : "Publish now"}</Button>
          ) : (
            <Button variant="primary" onClick={onSignIn}>Sign in to publish</Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** The drafts, when there are any and none is open. */
function DraftListView({ onNewDraft, onOpen }: { onNewDraft: () => void; onOpen: (id: string) => void }) {
  const { drafts, deleteDraft, restoreDraft } = useDraftStore();

  const remove = (draft: ArticleDraft) => {
    deleteDraft(draft.id);
    // No confirmation, but a way back: an 11px × used to delete at once, for
    // good. Keyed per draft: two deletions in a row are two toasts, each with
    // its own Undo, not one toast whose Undo brings back only the last.
    useToastStore.getState().addToast("Draft deleted.", "info", { key: `draft-deleted:${draft.id}`, action: { label: "Undo", run: () => restoreDraft(draft) } });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Opened from the sidebar's "Write Article": that is its title, and
          a view opened from the sidebar has no Back. */}
      <ViewHeader
        title="Write Article"
        meta={`${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"}`}
        actions={<Button variant="primary" onClick={onNewDraft}>New draft</Button>}
      />
      <div className="flex-1 overflow-y-auto content-column">
        {drafts.map((draft) => {
          const excerpt = cardSummary("", draft.content, draft.title) || plainWords(draft.content).slice(0, 160);
          return (
            <div
              key={draft.id}
              className="border-b border-border-subtle px-4 py-3 hover:bg-bg-hover transition-colors cursor-pointer flex items-start justify-between gap-3"
              onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; onOpen(draft.id); }}
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-text text-body font-medium truncate">
                  <button type="button" className="text-left truncate max-w-full" onClick={() => onOpen(draft.id)}>{draft.title || "Untitled"}</button>
                  {draft.dTag && <span className="ml-2 text-caption text-text-muted font-normal">edit of a published article</span>}
                </h3>
                {excerpt && <p className="text-text-muted text-caption line-clamp-1 mt-0.5">{excerpt}</p>}
                <p className="text-text-muted text-caption mt-0.5">{readingMinutes(draft.content)} min read · {timeAgo(Math.floor(draft.updatedAt / 1000))} ago</p>
              </div>
              <Button square size="sm" variant="ghost" tone="danger" onClick={() => remove(draft)} aria-label={`Delete draft ${draft.title || "Untitled"}`} title="Delete draft"><Trash2 /></Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
