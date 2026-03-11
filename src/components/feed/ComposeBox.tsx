import { useState, useRef } from "react";
import { publishNote } from "../../lib/nostr";
import { uploadImage } from "../../lib/upload";
import { useUserStore } from "../../stores/user";
import { shortenPubkey } from "../../lib/utils";

export function ComposeBox({ onPublished }: { onPublished?: () => void }) {
  const [text, setText] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { profile, npub } = useUserStore();
  const avatar = profile?.picture;
  const name = profile?.displayName || profile?.name || (npub ? shortenPubkey(npub) : "");

  const charCount = text.length;
  const overLimit = charCount > 280;
  const canPost = text.trim().length > 0 && !overLimit && !publishing && !uploading;

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    setUploading(true);
    setError(null);
    try {
      const url = await uploadImage(file);
      const ta = textareaRef.current;
      if (ta) {
        const start = ta.selectionStart ?? text.length;
        const end = ta.selectionEnd ?? text.length;
        const next = text.slice(0, start) + url + text.slice(end);
        setText(next);
        setTimeout(() => {
          ta.selectionStart = ta.selectionEnd = start + url.length;
          ta.focus();
        }, 0);
      } else {
        setText((t) => t + url);
      }
    } catch (err) {
      setError(`Image upload failed: ${err}`);
    } finally {
      setUploading(false);
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
      await publishNote(text.trim());
      setText("");
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
              alt=""
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
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="What's on your mind?"
            rows={3}
            className="w-full bg-transparent text-text text-[13px] placeholder:text-text-dim resize-none focus:outline-none"
          />

          {error && (
            <p className="text-danger text-[11px] mb-2">{error}</p>
          )}

          <div className="flex items-center justify-between mt-1">
            <span className={`text-[10px] ${overLimit ? "text-danger" : "text-text-dim"}`}>
              {uploading ? "uploading image…" : charCount > 0 ? `${charCount}/280` : ""}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-text-dim text-[10px]">Ctrl+Enter to post</span>
              <button
                onClick={handlePublish}
                disabled={!canPost}
                className="px-3 py-1 text-[11px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {publishing ? "posting…" : "post"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
