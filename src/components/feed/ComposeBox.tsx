import { useState, useRef, useEffect } from "react";
import { publishNote, publishPoll } from "../../lib/nostr";
import { uploadImage, uploadBytes } from "../../lib/upload";
import { PollCompose } from "../poll/PollCompose";
import { useAutoResize } from "../../hooks/useAutoResize";
import { useUserStore } from "../../stores/user";
import { useFeedStore } from "../../stores/feed";
import { shortenPubkey, profileName } from "../../lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { EmojiPicker } from "../shared/EmojiPicker";

const COMPOSE_DRAFT_KEY = "wrystr_compose_draft";

export function ComposeBox({ onPublished, onNoteInjected }: { onPublished?: () => void; onNoteInjected?: (event: import("@nostr-dev-kit/ndk").NDKEvent) => void }) {
  const [text, setText] = useState(() => {
    try { return localStorage.getItem(COMPOSE_DRAFT_KEY) || ""; }
    catch { return ""; }
  });
  const [attachments, setAttachments] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [isPoll, setIsPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const autoResize = useAutoResize(3, 12);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { profile, npub } = useUserStore();
  const avatar = typeof profile?.picture === "string" ? profile.picture : undefined;
  const name = profileName(profile, npub ? shortenPubkey(npub) : "");

  // Auto-save draft with debounce
  useEffect(() => {
    const t = setTimeout(() => {
      if (text.trim()) {
        localStorage.setItem(COMPOSE_DRAFT_KEY, text);
      } else {
        localStorage.removeItem(COMPOSE_DRAFT_KEY);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [text]);

  const charCount = text.length;
  const warnLimit = charCount > 3500;
  const overLimit = charCount > 4000;
  const pollValid = !isPoll || pollOptions.filter((o) => o.trim()).length >= 2;
  const canPost = (text.trim().length > 0 || attachments.length > 0) && !publishing && !uploading && pollValid;

  // Insert text at the current cursor position in the textarea
  const insertAtCursor = (str: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart ?? text.length;
      const end = ta.selectionEnd ?? text.length;
      const next = text.slice(0, start) + str + text.slice(end);
      setText(next);
      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + str.length;
        ta.focus();
      }, 0);
    } else {
      setText((t) => t + str);
    }
  };

  // Add uploaded URL to attachments instead of inserting into text
  const addAttachment = (url: string) => {
    setAttachments((prev) => [...prev, url]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Upload a web File object (from clipboard/drag-drop)
  const handleImageUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const url = await uploadImage(file);
      addAttachment(url);
    } catch (err) {
      setError(`Image upload failed: ${err}`);
    } finally {
      setUploading(false);
    }
  };

  // Upload a file by path using TS upload with NIP-98 auth
  const handleNativeUpload = async (filePath: string) => {
    setUploading(true);
    setError(null);
    try {
      const bytes = await readFile(filePath);
      const fileName = filePath.split(/[\\/]/).pop() || "file";
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
        webp: "image/webp", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm",
        mov: "video/quicktime", ogg: "video/ogg", m4v: "video/mp4",
      };
      const mimeType = mimeMap[ext] || "application/octet-stream";
      const url = await uploadBytes(new Uint8Array(bytes), fileName, mimeType);
      addAttachment(url);
    } catch (err) {
      setError(`Upload failed: ${err}`);
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Try clipboardData.files first (works on Windows, some Linux DEs)
    const fileFromFiles = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (fileFromFiles) {
      e.preventDefault();
      handleImageUpload(fileFromFiles);
      return;
    }

    // Try clipboardData.items (needed for Linux/Wayland screenshot paste)
    const items = Array.from(e.clipboardData.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        e.preventDefault();
        handleImageUpload(file);
        return;
      }
    }

    // If pasted text looks like a local file path to a media file, upload it directly
    const pastedText = e.clipboardData.getData("text/plain");
    if (pastedText && /\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mov)$/i.test(pastedText.trim()) && /^(\/|[A-Z]:\\)/.test(pastedText.trim())) {
      e.preventDefault();
      handleNativeUpload(pastedText.trim());
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    handleImageUpload(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
    }
  };

  const handleFilePicker = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Media", extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg", "mp4", "webm", "mov", "ogg", "m4v"] },
        ],
      });
      if (!selected) return;
      const path = typeof selected === "string" ? selected : selected;
      handleNativeUpload(path);
    } catch (err) {
      setError(`File picker failed: ${err}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (canPost) handlePublish();
    }
  };

  const handlePublish = async () => {
    if (!canPost) return;
    setPublishing(true);
    setError(null);
    try {
      let event;
      if (isPoll) {
        const validOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
        event = await publishPoll(text.trim(), validOptions);
      } else {
        // Build final content: text + attachment URLs on separate lines
        const parts = [text.trim(), ...attachments].filter(Boolean);
        const content = parts.join("\n");
        event = await publishNote(content);
      }
      // Inject into feed immediately so the user sees their post
      if (onNoteInjected) {
        onNoteInjected(event);
      } else {
        const { notes } = useFeedStore.getState();
        useFeedStore.setState({
          notes: [event, ...notes],
        });
      }
      setText("");
      setAttachments([]);
      setIsPoll(false);
      setPollOptions(["", ""]);
      localStorage.removeItem(COMPOSE_DRAFT_KEY);
      textareaRef.current?.focus();
      onPublished?.();
    } catch (err) {
      setError(`Failed to publish: ${err}`);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="shrink-0">
          {avatar ? (
            <img
              src={avatar}
              alt="Your avatar"
              className="w-9 h-9 rounded-sm object-cover bg-bg-raised"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-9 h-9 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            data-compose
            value={text}
            onChange={(e) => { setText(e.target.value); autoResize(e); }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            placeholder="What's on your mind?"
            rows={3}
            className="w-full bg-transparent text-text text-[13px] placeholder:text-text-dim resize-none focus:outline-none leading-relaxed"
          />

          {/* Attachment thumbnails */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map((url, i) => (
                <div key={i} className="relative group">
                  {/\.(mp4|webm|mov|ogg|m4v)(\?|$)/i.test(url) ? (
                    <div className="h-16 w-20 rounded-sm border border-border bg-bg-raised flex items-center justify-center text-text-dim text-[10px]">
                      video
                    </div>
                  ) : (
                    <img
                      src={url}
                      alt="Attachment preview"
                      className="h-16 w-auto rounded-sm border border-border object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).className = "h-16 w-20 rounded-sm border border-border bg-bg-raised"; }}
                    />
                  )}
                  <button
                    onClick={() => removeAttachment(i)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-danger text-white text-[10px] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove"
                    aria-label="Remove attachment"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Poll option inputs */}
          {isPoll && (
            <PollCompose options={pollOptions} onChange={setPollOptions} />
          )}

          {error && (
            <p className="text-danger text-[11px] mb-2">{error}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-y-1 mt-1">
            <span className={`text-[10px] ${overLimit ? "text-danger" : warnLimit ? "text-warning" : "text-text-dim"}`}>
              {uploading ? (
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
                  uploading…
                </span>
              ) : charCount > 3000 ? `${charCount}` : ""}
              {!uploading && charCount > 0 && localStorage.getItem(COMPOSE_DRAFT_KEY) && (
                <span className="ml-1 text-text-dim">(draft)</span>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <button
                  onClick={() => setShowEmoji((v) => !v)}
                  title="Insert emoji"
                  aria-label="Insert emoji"
                  className="text-text-dim hover:text-text text-[16px] transition-colors"
                >
                  ☺
                </button>
                {showEmoji && (
                  <EmojiPicker
                    onSelect={(emoji) => insertAtCursor(emoji)}
                    onClose={() => setShowEmoji(false)}
                  />
                )}
              </div>
              <button
                onClick={handleFilePicker}
                disabled={uploading || isPoll}
                title="Attach image or video"
                aria-label="Attach image or video"
                className="text-text-dim hover:text-text text-[16px] transition-colors disabled:opacity-30"
              >
                +
              </button>
              <button
                onClick={() => setIsPoll((v) => !v)}
                title={isPoll ? "Cancel poll" : "Create poll"}
                aria-label={isPoll ? "Cancel poll" : "Create poll"}
                className={`text-[16px] transition-colors ${isPoll ? "text-accent" : "text-text-dim hover:text-text"}`}
              >
                &#9634;&#9634;
              </button>
              <button
                onClick={handlePublish}
                disabled={!canPost}
                className="px-3 py-1 text-[11px] bg-accent hover:bg-accent-hover text-accent-text rounded-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {publishing ? "Posting…" : isPoll ? "Post poll" : "Post"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
