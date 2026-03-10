import { useState, useRef, useEffect } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { publishQuote } from "../../lib/nostr";

interface QuoteModalProps {
  event: NDKEvent;
  authorName: string;
  authorAvatar?: string;
  onClose: () => void;
  onPublished?: () => void;
}

export function QuoteModal({ event, authorName, authorAvatar, onClose, onPublished }: QuoteModalProps) {
  const [text, setText] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canPublish = text.trim().length > 0 && !publishing;

  const handlePublish = async () => {
    if (!canPublish) return;
    setPublishing(true);
    setError(null);
    try {
      await publishQuote(text.trim(), event);
      onPublished?.();
      onClose();
    } catch (err) {
      setError(`Failed to publish: ${err}`);
      setPublishing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handlePublish();
    if (e.key === "Escape") onClose();
  };

  const preview = event.content.slice(0, 140) + (event.content.length > 140 ? "…" : "");

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bg border border-border w-full max-w-md mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-text text-sm font-medium">Quote note</h2>
          <button onClick={onClose} className="text-text-dim hover:text-text text-lg leading-none">×</button>
        </div>

        {/* Compose */}
        <div className="p-4">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add your comment…"
            rows={3}
            className="w-full bg-transparent text-text text-[13px] placeholder:text-text-dim resize-none focus:outline-none mb-3"
            style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
          />

          {/* Quoted note preview */}
          <div className="border border-border px-3 py-2.5 bg-bg-raised rounded-sm">
            <div className="flex items-center gap-2 mb-1.5">
              {authorAvatar ? (
                <img src={authorAvatar} alt="" className="w-4 h-4 rounded-sm object-cover" />
              ) : (
                <div className="w-4 h-4 rounded-sm bg-accent/20 flex items-center justify-center text-accent text-[8px]">
                  {authorName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-text-muted text-[11px] font-medium">{authorName}</span>
            </div>
            <p className="text-text-dim text-[12px] leading-relaxed whitespace-pre-wrap break-words">{preview}</p>
          </div>

          {error && <p className="text-danger text-[11px] mt-2">{error}</p>}

          <div className="flex items-center justify-between mt-3">
            <span className="text-text-dim text-[10px]">Ctrl+Enter to post</span>
            <button
              onClick={handlePublish}
              disabled={!canPublish}
              className="px-4 py-1.5 text-[11px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {publishing ? "posting…" : "quote & post"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
