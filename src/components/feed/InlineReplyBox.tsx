import { useState, useRef } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { publishReply } from "../../lib/nostr";
import { uploadImage, uploadBytes } from "../../lib/upload";
import { useAutoResize } from "../../hooks/useAutoResize";
import { useReplyCount } from "../../hooks/useReplyCount";
import { EmojiPicker } from "../shared/EmojiPicker";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

interface InlineReplyBoxProps {
  event: NDKEvent;
  name: string;
  rootEvent?: { id: string; pubkey: string };
}

export function InlineReplyBox({ event, name, rootEvent }: InlineReplyBoxProps) {
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySent, setReplySent] = useState(false);
  const [showReplyEmoji, setShowReplyEmoji] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const autoResize = useAutoResize(2, 8);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [, adjustReplyCount] = useReplyCount(event.id);

  const insertAtCursor = (str: string) => {
    const ta = replyRef.current;
    if (ta) {
      const start = ta.selectionStart ?? replyText.length;
      const end = ta.selectionEnd ?? replyText.length;
      setReplyText(replyText.slice(0, start) + str + replyText.slice(end));
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + str.length; ta.focus(); }, 0);
    } else {
      setReplyText((t) => t + str);
    }
  };

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const url = await uploadImage(file);
      insertAtCursor(url);
    } catch (err) {
      setUploadError(`Upload failed: ${err}`);
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fileFromFiles = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (fileFromFiles) {
      e.preventDefault();
      handleImageUpload(fileFromFiles);
      return;
    }
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
    const pastedText = e.clipboardData.getData("text/plain");
    if (pastedText && /\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mov)$/i.test(pastedText.trim()) && /^(\/|[A-Z]:\\)/.test(pastedText.trim())) {
      e.preventDefault();
      setUploading(true);
      setUploadError(null);
      try {
        const bytes = await readFile(pastedText.trim());
        const fileName = pastedText.trim().split(/[\\/]/).pop() || "file";
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
        const url = await uploadBytes(new Uint8Array(bytes), fileName, mimeMap[ext] || "application/octet-stream");
        insertAtCursor(url);
      } catch (err) {
        setUploadError(`Upload failed: ${err}`);
      } finally {
        setUploading(false);
      }
    }
  };

  const handleFilePicker = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Media", extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg", "mp4", "webm", "mov"] }],
      });
      if (!selected) return;
      setUploading(true);
      setUploadError(null);
      const bytes = await readFile(selected);
      const fileName = selected.split(/[\\/]/).pop() || "file";
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
      const url = await uploadBytes(new Uint8Array(bytes), fileName, mimeMap[ext] || "application/octet-stream");
      insertAtCursor(url);
    } catch (err) {
      setUploadError(`Upload failed: ${err}`);
    } finally {
      setUploading(false);
    }
  };

  const handleReplySubmit = async () => {
    if (!replyText.trim() || replying) return;
    setReplying(true);
    setReplyError(null);
    try {
      await publishReply(replyText.trim(), { id: event.id, pubkey: event.pubkey }, rootEvent);
      setReplyText("");
      setReplySent(true);
      adjustReplyCount(1);
      setTimeout(() => { setReplySent(false); }, 1500);
    } catch (err) {
      setReplyError(`Failed: ${err}`);
    } finally {
      setReplying(false);
    }
  };

  const handleReplyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleReplySubmit();
    if (e.key === "Escape") {
      // Parent controls visibility — just blur
      replyRef.current?.blur();
    }
  };

  return (
    <div className="mt-2 border-l-2 border-border pl-3">
      <textarea
        ref={replyRef}
        value={replyText}
        onChange={(e) => { setReplyText(e.target.value); autoResize(e); }}
        onKeyDown={handleReplyKeyDown}
        onPaste={handlePaste}
        placeholder={`Reply to ${name}…`}
        rows={2}
        className="w-full bg-transparent text-text text-[12px] placeholder:text-text-dim resize-none focus:outline-none leading-relaxed"
        autoFocus
      />
      {replyError && <p className="text-danger text-[10px] mb-1">{replyError}</p>}
      {uploadError && <p className="text-danger text-[10px] mb-1">{uploadError}</p>}
      <div className="flex items-center justify-end gap-2 mt-1">
        {uploading && (
          <span className="inline-flex items-center gap-1 text-text-dim text-[10px]">
            <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
            uploading…
          </span>
        )}
        <button
          onClick={handleFilePicker}
          disabled={uploading}
          title="Attach image or video"
          className="text-text-dim hover:text-text text-[16px] transition-colors disabled:opacity-30"
        >
          +
        </button>
        <div className="relative">
          <button
            onClick={() => setShowReplyEmoji((v) => !v)}
            title="Insert emoji"
            className="text-text-dim hover:text-text text-[16px] transition-colors"
          >
            ☺
          </button>
          {showReplyEmoji && (
            <EmojiPicker
              onSelect={(emoji) => {
                const ta = replyRef.current;
                if (ta) {
                  const start = ta.selectionStart ?? replyText.length;
                  const end = ta.selectionEnd ?? replyText.length;
                  setReplyText(replyText.slice(0, start) + emoji + replyText.slice(end));
                  setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + emoji.length; ta.focus(); }, 0);
                } else {
                  setReplyText((t) => t + emoji);
                }
              }}
              onClose={() => setShowReplyEmoji(false)}
            />
          )}
        </div>
        <span className="text-text-dim text-[10px]">Ctrl+Enter</span>
        <button
          onClick={handleReplySubmit}
          disabled={!replyText.trim() || replying || uploading}
          className="px-2 py-0.5 text-[10px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {replySent ? "replied ✓" : replying ? "posting…" : "reply"}
        </button>
      </div>
    </div>
  );
}
